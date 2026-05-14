import { Agent, run } from "@openai/agents";
import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  humanReviewQueue,
  pipelineConfidenceHistory,
  pipelineEvidence,
  pipelineHandoffs,
  pipelineRuns,
  pipelineSteps,
} from "@shared/schema";
import {
  EDITORIAL_DEFAULT_MODEL,
  buildHandoffChain,
  buildHandoffPayload,
  buildStepOutput,
  type PipelineAgentName,
  type TriageItem,
} from "./contracts";
import { triageRange } from "./triage";
import { executeAgent } from "./executors";
import { getModelForAgent } from "./model-config";

const controllers = new Map<string, AbortController>();
const EDITORIAL_PIPELINE_ENABLED = process.env.EDITORIAL_PIPELINE_ENABLED !== "0";

type StartOpts = {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
  requestedBy?: string;
  resumedFromRunId?: string;
};

const RETRYABLE_STATUSES = new Set(["rejected", "error"]);

async function createStep(opts: {
  runId: string;
  stepIndex: number;
  agentName: PipelineAgentName;
  status: string;
  confidence?: number;
  input: unknown;
  output: unknown;
  evidence?: unknown;
  rejectionReason?: string | null;
  suggestedAction?: string | null;
}) {
  const [step] = await db
    .insert(pipelineSteps)
    .values({
      runId: opts.runId,
      stepIndex: opts.stepIndex,
      agentName: opts.agentName,
      status: opts.status,
      confidence: opts.confidence != null ? String(Math.round(opts.confidence * 100)) : null,
      input: opts.input,
      output: opts.output,
      evidence: opts.evidence,
      rejectionReason: opts.rejectionReason ?? null,
      suggestedAction: opts.suggestedAction ?? null,
    })
    .returning({ id: pipelineSteps.id });
  return step.id;
}

async function recordConfidence(runId: string, stepId: string, agentName: string, score?: number, reason?: string) {
  if (score == null) return;
  await db.insert(pipelineConfidenceHistory).values({
    runId,
    stepId,
    agentName,
    score: String(Math.round(score * 100)),
    reason: reason || null,
  });
}

async function runAgentWithRetry(
  runId: string,
  triageItem: TriageItem,
  agentName: PipelineAgentName,
  stepIndexStart: number
): Promise<{ nextStepIndex: number; lastStepId: string | null }> {
  const maxAttempts = 2;
  let stepIndex = stepIndexStart;
  let lastStepId: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await executeAgent(agentName, { runId, triageItem });
    const stepId = await createStep({
      runId,
      stepIndex,
      agentName,
      status: result.status,
      confidence: result.confidence,
      input: { triageItem, attempt, model: getModelForAgent(agentName) },
      output: result.output,
      evidence: result.evidence || null,
      rejectionReason: result.output.rejection?.reason ?? null,
      suggestedAction: result.output.rejection?.suggestedAction ?? null,
    });
    await recordConfidence(runId, stepId, agentName, result.confidence, result.output.rejection?.reason);

    if (result.evidence) {
      await db.insert(pipelineEvidence).values({
        runId,
        stepId,
        sourceType: "agent-executor",
        title: `${agentName} evidence`,
        metadata: result.evidence,
      });
    }

    lastStepId = stepId;
    stepIndex += 1;
    if (!RETRYABLE_STATUSES.has(result.status) || attempt === maxAttempts) break;
  }

  return { nextStepIndex: stepIndex, lastStepId };
}

async function generateManagerNarrative(triage: TriageItem[], signal?: AbortSignal): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const counts = triage.reduce<Record<string, number>>((acc, item) => {
    acc[item.route] = (acc[item.route] || 0) + 1;
    return acc;
  }, {});
  const planner = new Agent({
    name: "NewsManager",
    model: EDITORIAL_DEFAULT_MODEL,
    instructions:
      "You are NewsManager for The Origins editorial pipeline. Summarize triage outcome in 2 concise sentences. No markdown.",
  });
  const result = await run(
    planner,
    `Triage route counts: ${JSON.stringify(counts)}. Give a short operator summary.`,
    { maxTurns: 2, signal }
  );
  return String(result.finalOutput ?? "").trim() || null;
}

async function executeRun(runId: string, opts: StartOpts, signal?: AbortSignal): Promise<void> {
  await db
    .update(pipelineRuns)
    .set({
      stats: {
        phase: "triaging",
        heartbeatIso: new Date().toISOString(),
      },
    })
    .where(eq(pipelineRuns.id, runId));

  const triage = await triageRange({
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    maxDaysToConsider: Math.max(1, Math.min(opts.maxDaysToConsider, 365)),
  });

  let stepIndex = 1;
  for (const item of triage) {
    // NewsManager triage step
    const triageStepId = await createStep({
      runId,
      stepIndex,
      agentName: "NewsManager",
      status: "completed",
      confidence: item.confidence,
      input: { date: item.date, analysisId: item.analysisId },
      output: buildStepOutput({
        summary: `Triage route ${item.route} selected for ${item.date}`,
        findings: item.reasons,
      }),
      evidence: { triageRuleVersion: "v1", requiredAgents: item.requiredAgents },
    });
    await recordConfidence(runId, triageStepId, "NewsManager", item.confidence, item.reasons.join("; "));
    stepIndex += 1;

    const handoffChain = buildHandoffChain({
      fromAgent: "NewsManager",
      toAgents: item.requiredAgents,
      analysisId: item.analysisId,
      date: item.date,
      confidence: item.confidence,
      reasons: item.reasons,
      route: item.route,
      sourceStepId: triageStepId,
    });

    for (const handoff of handoffChain) {
      const toAgent = handoff.toAgent;
      await db.insert(pipelineHandoffs).values({
        runId,
        fromAgent: handoff.fromAgent,
        toAgent: handoff.toAgent,
        payload: handoff.payload,
      });
      const out = await runAgentWithRetry(runId, item, toAgent, stepIndex);
      stepIndex = out.nextStepIndex;
      if (out.lastStepId) {
        await db.insert(pipelineHandoffs).values({
          runId,
          fromAgent: toAgent,
          toAgent: "NewsManager",
          payload: buildHandoffPayload({
            analysisId: item.analysisId,
            date: item.date,
            status: "needs_review",
            confidence: 0.8,
            reason: `${toAgent} completed`,
            nextAgent: "NewsManager",
            metadata: { sourceStepId: out.lastStepId },
          }),
        });
      }
    }

    await db.insert(humanReviewQueue).values({
      runId,
      stepId: triageStepId,
      status: "pending",
      priority:
        item.route === "missing_day" ? 95 : item.route === "empty_day" ? 90 : item.route === "existing_needs_correction" ? 75 : 50,
      eventDate: item.date,
      package: {
        triage: item,
        note: "Generated by NewsManager + stage executors. Existing search and summary flows are preserved.",
      },
    });
  }

  const managerNarrative = await generateManagerNarrative(triage, signal);
  const [pendingReview] = await db
    .select({ c: count() })
    .from(humanReviewQueue)
    .where(eq(humanReviewQueue.runId, runId));

  await db
    .update(pipelineRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      stats: {
        phase: "completed",
        triageCount: triage.length,
        routeCounts: triage.reduce<Record<string, number>>((acc, item) => {
          acc[item.route] = (acc[item.route] || 0) + 1;
          return acc;
        }, {}),
        managerNarrative,
        humanReviewQueued: Number(pendingReview?.c ?? 0),
      },
    })
    .where(eq(pipelineRuns.id, runId));
}

export async function startEditorialPipelineRun(opts: StartOpts): Promise<{ runId: string }> {
  if (!EDITORIAL_PIPELINE_ENABLED) {
    throw new Error("Editorial pipeline is disabled by feature flag (EDITORIAL_PIPELINE_ENABLED=0).");
  }
  const [created] = await db
    .insert(pipelineRuns)
    .values({
      status: "running",
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      model: EDITORIAL_DEFAULT_MODEL,
      requestedBy: opts.requestedBy || "admin-ui",
      config: {
        maxDaysToConsider: opts.maxDaysToConsider,
        mode: "triage-first",
        preserveExistingSearchAndSummary: true,
        resumedFromRunId: opts.resumedFromRunId || null,
      },
      stats: { phase: "queued" },
    })
    .returning({ id: pipelineRuns.id });

  const runId = created.id;
  const controller = new AbortController();
  controllers.set(runId, controller);

  void executeRun(runId, opts, controller.signal)
    .catch(async (error) => {
      await db
        .update(pipelineRuns)
        .set({
          status: /abort|cancel/i.test(String(error)) ? "stopped" : "error",
          completedAt: new Date(),
          stats: {
            phase: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .where(eq(pipelineRuns.id, runId));
    })
    .finally(() => {
      controllers.delete(runId);
    });

  return { runId };
}

export function stopEditorialPipelineRun(runId: string): boolean {
  const c = controllers.get(runId);
  if (!c) return false;
  c.abort();
  return true;
}

export function pauseEditorialPipelineRun(runId: string): boolean {
  const c = controllers.get(runId);
  if (!c) return false;
  c.abort();
  void db
    .update(pipelineRuns)
    .set({ status: "paused", completedAt: new Date(), stats: { phase: "paused" } })
    .where(eq(pipelineRuns.id, runId));
  return true;
}

export async function resumeEditorialPipelineRun(runId: string): Promise<{ runId: string }> {
  const [runRow] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!runRow) throw new Error("Run not found");
  return startEditorialPipelineRun({
    dateFrom: runRow.dateFrom,
    dateTo: runRow.dateTo,
    maxDaysToConsider: Number((runRow.config as any)?.maxDaysToConsider || 60),
    requestedBy: "admin-ui",
    resumedFromRunId: runId,
  });
}

export function isEditorialPipelineRunActive(runId: string): boolean {
  return controllers.has(runId);
}

export async function getEditorialPipelineRun(runId: string): Promise<{
  run: unknown;
  steps: unknown[];
  handoffs: unknown[];
  live: { activeInThisRuntime: boolean };
} | null> {
  const [runRow] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!runRow) return null;
  const steps = await db
    .select()
    .from(pipelineSteps)
    .where(eq(pipelineSteps.runId, runId))
    .orderBy(asc(pipelineSteps.stepIndex));
  const handoffs = await db
    .select()
    .from(pipelineHandoffs)
    .where(eq(pipelineHandoffs.runId, runId))
    .orderBy(desc(pipelineHandoffs.createdAt));
  return {
    run: runRow,
    steps,
    handoffs,
    live: {
      activeInThisRuntime: isEditorialPipelineRunActive(runId),
    },
  };
}

export async function shadowValidatePipelineWindow(opts: {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
}): Promise<{
  triageCount: number;
  routeCounts: Record<string, number>;
  reviewQueueCreated: number;
}> {
  const triage = await triageRange(opts);
  const routeCounts = triage.reduce<Record<string, number>>((acc, item) => {
    acc[item.route] = (acc[item.route] || 0) + 1;
    return acc;
  }, {});
  return {
    triageCount: triage.length,
    routeCounts,
    reviewQueueCreated: triage.length,
  };
}

export function getEditorialCutoverStatus() {
  return {
    featureFlagEnabled: EDITORIAL_PIPELINE_ENABLED,
    requiredHumanApproval: true,
    defaultModel: EDITORIAL_DEFAULT_MODEL,
    cutoverReadyChecks: {
      featureFlagEnabled: EDITORIAL_PIPELINE_ENABLED,
      humanApprovalGatePresent: true,
      parallelModeOnly: true,
    },
  };
}

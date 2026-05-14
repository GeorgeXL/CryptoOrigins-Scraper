import { Agent, run } from "@openai/agents";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { pipelineHandoffs, pipelineRuns, pipelineSteps } from "@shared/schema";
import { EDITORIAL_DEFAULT_MODEL, type TriageItem } from "./contracts";
import { triageRange } from "./triage";

const controllers = new Map<string, AbortController>();

type StartOpts = {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
  requestedBy?: string;
};

async function writeTriageTrace(runId: string, triage: TriageItem[]): Promise<void> {
  let stepIndex = 1;
  for (const item of triage) {
    const [step] = await db
      .insert(pipelineSteps)
      .values({
        runId,
        stepIndex,
        agentName: "NewsManager",
        status: "completed",
        confidence: String(Math.round(item.confidence * 100)),
        input: { date: item.date, analysisId: item.analysisId },
        output: {
          route: item.route,
          reasons: item.reasons,
          requiredAgents: item.requiredAgents,
        },
        evidence: { triageRuleVersion: "v1" },
      })
      .returning({ id: pipelineSteps.id });
    stepIndex += 1;

    // Only create handoffs for work items. existing_ok goes to final editorial check only.
    for (const toAgent of item.requiredAgents) {
      if (toAgent === "NewsManager") continue;
      await db.insert(pipelineHandoffs).values({
        runId,
        fromAgent: "NewsManager",
        toAgent,
        payload: {
          date: item.date,
          analysisId: item.analysisId,
          route: item.route,
          reasons: item.reasons,
          sourceStepId: step.id,
        },
      });
    }
  }
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

  await writeTriageTrace(runId, triage);
  const managerNarrative = await generateManagerNarrative(triage, signal);

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
      },
    })
    .where(eq(pipelineRuns.id, runId));
}

export async function startEditorialPipelineRun(opts: StartOpts): Promise<{ runId: string }> {
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

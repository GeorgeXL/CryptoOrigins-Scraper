import { buildStepOutput, type PipelineAgentName, type TriageItem } from "./contracts";
import { getExistingDay, getExistingVerificationSignals, runExistingSearchAndSummaryForDate } from "./tools";
import { detectMilestoneGapsInWindow } from "./milestones";

export type ExecutorContext = {
  runId: string;
  triageItem: TriageItem;
};

export type ExecutorResult = {
  status: "completed" | "rejected" | "skipped" | "error";
  confidence?: number;
  output: ReturnType<typeof buildStepOutput>;
  evidence?: Record<string, unknown>;
};

type AgentExecutor = (ctx: ExecutorContext) => Promise<ExecutorResult>;

const noop: AgentExecutor = async (ctx) => ({
  status: "completed",
  confidence: ctx.triageItem.confidence,
  output: buildStepOutput({
    summary: `${ctx.triageItem.date}: no-op placeholder executor`,
    findings: ["Executor scaffolding active"],
  }),
});

const milestoneAgent: AgentExecutor = async (ctx) => {
  const gaps = await detectMilestoneGapsInWindow(ctx.triageItem.date, ctx.triageItem.date);
  const critical = gaps.length > 0 || ctx.triageItem.route === "missing_day" || ctx.triageItem.route === "empty_day";
  return {
    status: "completed",
    confidence: critical ? 0.9 : 0.7,
    output: buildStepOutput({
      summary: "Milestone integrity check complete",
      findings: critical
        ? [
            "Potential milestone gap, prioritize review",
            ...gaps.map((g) => `${g.slug}:${g.issue}`),
          ]
        : ["No critical milestone gap signal"],
    }),
  };
};

const sourceFinderAgent: AgentExecutor = async (ctx) => {
  if (ctx.triageItem.route === "existing_ok") {
    return {
      status: "skipped",
      confidence: 1,
      output: buildStepOutput({
        summary: "Skipped source discovery for healthy day",
        findings: ["Route existing_ok"],
      }),
    };
  }

  const discovered = await runExistingSearchAndSummaryForDate(ctx.triageItem.date);
  return {
    status: "completed",
    confidence: Math.min(0.99, Math.max(0.4, discovered.confidenceScore / 100)),
    output: buildStepOutput({
      summary: "Used existing search/summarization pipeline",
      findings: [
        `Fetched articles: ${discovered.totalArticlesFetched}`,
        `Summary chars: ${discovered.summary.length}`,
      ],
    }),
    evidence: {
      sourceType: "existing-news-analyzer",
      totalArticlesFetched: discovered.totalArticlesFetched,
    },
  };
};

const verificationAgent: AgentExecutor = async (ctx) => {
  const signals = await getExistingVerificationSignals(ctx.triageItem.date);
  if (!signals) {
    return {
      status: "rejected",
      confidence: 0.65,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "VerificationAgent",
          reason: "No verification signals found for date",
          confidence: 0.65,
          suggestedAction: "retry_with_new_source",
          returnTo: "NewsManager",
        },
      }),
    };
  }
  return {
    status: "completed",
    confidence: Number(signals.agreementScore ?? 70) / 100,
    output: buildStepOutput({
      summary: "Verification pass completed from existing verification signals",
      findings: [
        `verificationStatus=${signals.verificationStatus ?? "unknown"}`,
        `factCheckVerdict=${signals.factCheckVerdict ?? "unknown"}`,
      ],
    }),
  };
};

const summaryAgent: AgentExecutor = async (ctx) => {
  const existing = await getExistingDay(ctx.triageItem.date);
  if (!existing) {
    return {
      status: "rejected",
      confidence: 0.7,
      output: buildStepOutput({
        rejection: {
          status: "rejected",
          agent: "SummaryAgent",
          reason: "No day exists to summarize",
          confidence: 0.7,
          suggestedAction: "retry_with_new_source",
          returnTo: "NewsManager",
        },
      }),
    };
  }
  return {
    status: "completed",
    confidence: 0.82,
    output: buildStepOutput({
      summary: "Summary agent validated existing summary flow",
      findings: [
        `Existing summary length=${existing.summary.length}`,
      ],
    }),
  };
};

const finalEditorAgent: AgentExecutor = async (ctx) => ({
  status: "completed",
  confidence: 0.88,
  output: buildStepOutput({
    summary: "Final editor assembled package for human review queue",
    findings: [`Route=${ctx.triageItem.route}`, "Human approval required before write"],
    handoff: {
      analysisId: ctx.triageItem.analysisId,
      date: ctx.triageItem.date,
      status: "needs_review",
      confidence: 0.88,
      nextAgent: "NewsManager",
      reason: "Mandatory human gate",
    },
  }),
});

export const executorRegistry: Record<PipelineAgentName, AgentExecutor> = {
  NewsManager: noop,
  MilestoneAgent: milestoneAgent,
  SourceFinderAgent: sourceFinderAgent,
  RelevanceCheckerAgent: noop,
  VerificationAgent: verificationAgent,
  TopicManagerAgent: noop,
  TagManagerAgent: noop,
  TopicApplierAgent: noop,
  TagApplierAgent: noop,
  DuplicateCheckerAgent: noop,
  SummaryAgent: summaryAgent,
  FinalEditorAgent: finalEditorAgent,
};

export async function executeAgent(agent: PipelineAgentName, ctx: ExecutorContext): Promise<ExecutorResult> {
  return executorRegistry[agent](ctx);
}

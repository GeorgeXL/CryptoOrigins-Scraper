import { z } from "zod";

export const EDITORIAL_DEFAULT_MODEL =
  process.env.EDITORIAL_AGENT_MODEL?.trim() ||
  process.env.WIKI_OVERSEER_MODEL?.trim() ||
  process.env.AGENT_OPENAI_MODEL?.trim() ||
  "gpt-5.4-mini";

export const triageRouteSchema = z.enum([
  "existing_ok",
  "existing_needs_correction",
  "missing_day",
  "empty_day",
]);

export const pipelineAgentSchema = z.enum([
  "NewsManager",
  "MilestoneAgent",
  "SourceFinderAgent",
  "RelevanceCheckerAgent",
  "VerificationAgent",
  "TopicManagerAgent",
  "TagManagerAgent",
  "TopicApplierAgent",
  "TagApplierAgent",
  "DuplicateCheckerAgent",
  "SummaryAgent",
  "DateConsistencyAgent",
  "TagConsistencyAgent",
  "FinalEditorAgent",
]);

export const pipelineCheckScopeSchema = z.enum([
  "relevance",
  "summary",
  "topics",
  "tags",
  "duplicates",
  "date",
]);

export const ALL_PIPELINE_CHECK_SCOPES = pipelineCheckScopeSchema.options;

export const triageItemSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  analysisId: z.string().uuid().nullable(),
  route: triageRouteSchema,
  reasons: z.array(z.string()).min(1),
  requiredAgents: z.array(pipelineAgentSchema).min(1),
  confidence: z.number().min(0).max(1),
});

export const rejectionSchema = z.object({
  status: z.literal("rejected"),
  agent: pipelineAgentSchema,
  reason: z.string().min(5),
  confidence: z.number().min(0).max(1),
  suggestedAction: z.enum(["retry_with_new_source", "manual_review", "discard", "merge_existing"]),
  returnTo: pipelineAgentSchema,
});

export const handoffPayloadSchema = z.object({
  articleId: z.string().min(1).optional(),
  analysisId: z.string().uuid().nullable(),
  date: z.string(), // YYYY-MM-DD
  status: z.enum(["accepted", "rejected", "needs_review"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
  nextAgent: pipelineAgentSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const stepOutputSchema = z.object({
  summary: z.string().optional(),
  findings: z.array(z.string()).default([]),
  handoff: handoffPayloadSchema.optional(),
  rejection: rejectionSchema.optional(),
});

export function buildHandoffPayload(input: z.input<typeof handoffPayloadSchema>) {
  return handoffPayloadSchema.parse(input);
}

export function buildStepOutput(input: z.input<typeof stepOutputSchema>) {
  return stepOutputSchema.parse(input);
}

export function buildHandoffChain(args: {
  fromAgent: PipelineAgentName;
  toAgents: PipelineAgentName[];
  analysisId: string | null;
  date: string;
  confidence: number;
  reasons: string[];
  route: TriageRoute;
  sourceStepId?: string;
}): Array<{ fromAgent: PipelineAgentName; toAgent: PipelineAgentName; payload: PipelineHandoffPayload }> {
  const uniqueToAgents = Array.from(new Set(args.toAgents)).filter((to) => to !== args.fromAgent);
  return uniqueToAgents.map((toAgent) => ({
    fromAgent: args.fromAgent,
    toAgent,
    payload: buildHandoffPayload({
      analysisId: args.analysisId,
      date: args.date,
      status: "needs_review",
      confidence: args.confidence,
      reason: args.reasons.join("; "),
      nextAgent: toAgent,
      metadata: {
        route: args.route,
        sourceStepId: args.sourceStepId ?? null,
      },
    }),
  }));
}

export type PipelineAgentName = z.infer<typeof pipelineAgentSchema>;
export type PipelineCheckScope = z.infer<typeof pipelineCheckScopeSchema>;
export type TriageRoute = z.infer<typeof triageRouteSchema>;
export type TriageItem = z.infer<typeof triageItemSchema>;
export type PipelineRejection = z.infer<typeof rejectionSchema>;
export type PipelineHandoffPayload = z.infer<typeof handoffPayloadSchema>;
export type PipelineStepOutput = z.infer<typeof stepOutputSchema>;

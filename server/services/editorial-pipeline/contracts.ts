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
  "FinalEditorAgent",
]);

export const triageItemSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  analysisId: z.string().uuid().nullable(),
  route: triageRouteSchema,
  reasons: z.array(z.string()).min(1),
  requiredAgents: z.array(pipelineAgentSchema).min(1),
  confidence: z.number().min(0).max(1),
});

export type PipelineAgentName = z.infer<typeof pipelineAgentSchema>;
export type TriageRoute = z.infer<typeof triageRouteSchema>;
export type TriageItem = z.infer<typeof triageItemSchema>;

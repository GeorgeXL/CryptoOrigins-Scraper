import type { PipelineAgentName } from "./contracts";

export const FALLBACK_MODEL_CHAIN = [
  process.env.EDITORIAL_AGENT_MODEL?.trim(),
  process.env.WIKI_OVERSEER_MODEL?.trim(),
  process.env.AGENT_OPENAI_MODEL?.trim(),
  "gpt-5.4-mini",
  "gpt-4o-mini",
].filter(Boolean) as string[];

const DEFAULT_MODEL = FALLBACK_MODEL_CHAIN[0] || "gpt-5.4-mini";

export const agentModelOverrides: Partial<Record<PipelineAgentName, string>> = {
  NewsManager: process.env.NEWS_MANAGER_MODEL?.trim(),
  MilestoneAgent: process.env.MILESTONE_AGENT_MODEL?.trim(),
  SourceFinderAgent: process.env.SOURCE_FINDER_AGENT_MODEL?.trim(),
  RelevanceCheckerAgent: process.env.RELEVANCE_CHECKER_AGENT_MODEL?.trim(),
  VerificationAgent: process.env.VERIFICATION_AGENT_MODEL?.trim(),
  TopicValidatorAgent: process.env.TOPIC_VALIDATOR_AGENT_MODEL?.trim() ?? process.env.TOPIC_MANAGER_AGENT_MODEL?.trim(),
  TopicManagerAgent: process.env.TOPIC_MANAGER_AGENT_MODEL?.trim(),
  TagManagerAgent: process.env.TAG_MANAGER_AGENT_MODEL?.trim(),
  TopicApplierAgent: process.env.TOPIC_APPLIER_AGENT_MODEL?.trim(),
  TagApplierAgent: process.env.TAG_APPLIER_AGENT_MODEL?.trim(),
  DuplicateCheckerAgent: process.env.DUPLICATE_CHECKER_AGENT_MODEL?.trim(),
  SummaryAgent: process.env.SUMMARY_AGENT_MODEL?.trim(),
  DateConsistencyAgent: process.env.DATE_CONSISTENCY_AGENT_MODEL?.trim(),
  TagConsistencyAgent: process.env.TAG_CONSISTENCY_AGENT_MODEL?.trim(),
  FinalEditorAgent: process.env.FINAL_EDITOR_AGENT_MODEL?.trim(),
};

export function getModelForAgent(agent: PipelineAgentName): string {
  return agentModelOverrides[agent] || DEFAULT_MODEL;
}

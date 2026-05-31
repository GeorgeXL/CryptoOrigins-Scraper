import type { PipelineAgentName } from "./contracts";

/** Agents that are valid “slice start” points when re-running a suffix of the triage chain. */
const RESUME_ANCHORS: ReadonlySet<PipelineAgentName> = new Set([
  "VerificationAgent",
  "TopicValidatorAgent",
  "TopicManagerAgent",
  "TagManagerAgent",
  "SummaryAgent",
  "DuplicateCheckerAgent",
  "DateConsistencyAgent",
  "TagConsistencyAgent",
  "FinalEditorAgent",
]);

/**
 * Returns `fullChain.slice(firstIndexOf(startAgent))`.
 * @throws if `startAgent` is not present in `fullChain`
 */
export function agentsTailFromStart(fullChain: PipelineAgentName[], startAgent: PipelineAgentName): PipelineAgentName[] {
  const idx = fullChain.indexOf(startAgent);
  if (idx === -1) {
    throw new Error(
      `Cannot resume from ${startAgent}: not in triage chain (${fullChain.join(" → ")})`,
    );
  }
  return fullChain.slice(idx);
}

/** Anchors that appear in this route’s chain, in pipeline order (subset of `fullChain`). */
export function validResumeStarts(fullChain: PipelineAgentName[]): PipelineAgentName[] {
  return fullChain.filter((a) => RESUME_ANCHORS.has(a));
}

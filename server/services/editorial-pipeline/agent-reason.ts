/** Max chars for LLM `reason` fields — not shown to operators; decisions use structured output. */
export const AGENT_REASON_MAX = 48;

export function trimAgentReason(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, AGENT_REASON_MAX);
}

export function formatRelevanceQueueNote(classification: string): string {
  const label = classification.replace(/_/g, " ");
  return `Pick a stronger article (${label}).`;
}

export function formatDuplicateQueueNote(neighborDate: string): string {
  return `Possible duplicate of ${neighborDate} — pick another event or keep both.`;
}

export function formatTagDropRationale(tags: string[], max = 4): string {
  if (!tags.length) return "Drop ungrounded tags.";
  const shown = tags.slice(0, max).join(", ");
  return tags.length > max ? `Drop: ${shown}…` : `Drop: ${shown}`;
}

export function formatTagAddRationale(tags: string[], max = 4): string {
  if (!tags.length) return "Add grounded tags.";
  const shown = tags.slice(0, max).join(", ");
  return tags.length > max ? `Add: ${shown}…` : `Add: ${shown}`;
}

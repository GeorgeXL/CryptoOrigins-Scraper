/**
 * Shared checklist definitions + row status derivation for Admin Agents V2 → System graph.
 */

export type ChecklistAgent = "sanity" | "news" | "taxonomy";

export type RowStatus = "pending" | "running" | "pass" | "fail";

export const AGENT_CHECK_ROWS: Record<
  ChecklistAgent,
  readonly { key: string; label: string }[]
> = {
  sanity: [
    { key: "length", label: "Summary 100-110 chars" },
    { key: "structure", label: "Existing/manual day state" },
    { key: "plausibility", label: "Can this happen on this date?" },
    { key: "calendar", label: "Retrospective vs actual event date" },
  ],
  news: [
    { key: "corpus", label: "Known event or article pool" },
    { key: "hosts", label: "Candidate relevance ranking" },
    { key: "recency", label: "Article date vs event date" },
    { key: "corroboration", label: "Best candidate recommendation" },
    { key: "emptyWeak", label: "Human pick or mark empty" },
  ],
  taxonomy: [
    { key: "tags", label: "Concrete grounded tags" },
    { key: "topics", label: "Homepage storyline mapping" },
    { key: "reconcile", label: "Summary ↔ tags ↔ storyline" },
    { key: "dup", label: "Duplicate storyline neighbor" },
  ],
};

export type StepCheckFields = {
  checkRun?: { agent: ChecklistAgent; key: string };
  checkPassAll?: ChecklistAgent;
  checkFail?: { agent: ChecklistAgent; key: string };
  /** Clear this agent’s checklist rows (pending) — use on each new dispatch to that agent. */
  checkReset?: ChecklistAgent;
};

export function computeRowStatuses(
  agent: ChecklistAgent,
  steps: StepCheckFields[],
  safeIndex: number,
): Record<string, RowStatus> {
  const rows = AGENT_CHECK_ROWS[agent];
  const out: Record<string, RowStatus> = {};
  for (const r of rows) out[r.key] = "pending";

  if (steps.length === 0) {
    return out;
  }

  const cap = Math.min(Math.max(0, safeIndex), steps.length - 1);

  let windowStart = -1;
  for (let i = 0; i <= cap; i++) {
    if (steps[i].checkReset === agent) windowStart = i;
  }

  for (let i = windowStart + 1; i <= cap; i++) {
    const s = steps[i];
    if (s.checkFail?.agent === agent) {
      out[s.checkFail.key] = "fail";
    }
    if (s.checkPassAll === agent) {
      for (const r of rows) {
        if (out[r.key] !== "fail") out[r.key] = "pass";
      }
    }
  }

  for (let i = windowStart + 1; i < cap; i++) {
    const s = steps[i];
    if (s.checkRun?.agent === agent) {
      const k = s.checkRun.key;
      if (out[k] !== "fail") out[k] = "pass";
    }
  }

  const cur = steps[cap];
  if (cur?.checkRun?.agent === agent) {
    const k = cur.checkRun.key;
    if (out[k] !== "fail") out[k] = "running";
  }

  return out;
}

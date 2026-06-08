export type QualityCheckPipelineScope =
  | "relevance"
  | "summary"
  | "topics"
  | "tags"
  | "duplicates"
  | "date";

export type QualityCheckAgentKind = "pipeline" | "remove-periods";

export type QualityCheckAgentAction = {
  buttonLabel: string;
  confirmTitle: string;
  confirmDescription: string;
  kind: QualityCheckAgentKind;
  checkScopes?: QualityCheckPipelineScope[];
};

/** Quality-check sidebar tab id → bulk agent launcher (existing pipeline or deterministic fix). */
export const QUALITY_CHECK_AGENT_ACTIONS: Record<string, QualityCheckAgentAction> = {
  "empty-summary": {
    buttonLabel: "Run agent: fill days",
    confirmTitle: "Fill empty days with the editorial pipeline?",
    confirmDescription:
      "Runs the existing gated article-pick path for selected dates. New items land in the Agents review queue for approval.",
    kind: "pipeline",
    checkScopes: ["relevance"],
  },
  untagged: {
    buttonLabel: "Run agent: extract tags",
    confirmTitle: "Extract tags with the Tag Agent?",
    confirmDescription:
      "Runs the editorial pipeline (tags scope) on selected days. Tag proposals queue for human approval when needed.",
    kind: "pipeline",
    checkScopes: ["tags"],
  },
  flagged: {
    buttonLabel: "Run agent: review flagged",
    confirmTitle: "Review flagged days with the editorial pipeline?",
    confirmDescription:
      "Runs a full editorial check pass on manually flagged days. Corrections and clear-flag proposals queue for approval.",
    kind: "pipeline",
    checkScopes: ["relevance", "summary", "topics", "tags", "duplicates", "date"],
  },
  "no-topic": {
    buttonLabel: "Run agent: assign topic",
    confirmTitle: "Assign topics with the Topic Agent?",
    confirmDescription:
      "Runs the editorial pipeline (topics scope) to propose exactly one homepage topic leaf per selected day.",
    kind: "pipeline",
    checkScopes: ["topics"],
  },
  "multi-topic": {
    buttonLabel: "Run agent: consolidate topic",
    confirmTitle: "Consolidate topics with the Topic Agent?",
    confirmDescription:
      "Runs the editorial pipeline (topics scope) to collapse multiple topic leaves down to one per day.",
    kind: "pipeline",
    checkScopes: ["topics"],
  },
  "missing-months": {
    buttonLabel: "Run agent: fill month gaps",
    confirmTitle: "Fill incomplete months with the editorial pipeline?",
    confirmDescription:
      "Expands each selected month to its calendar range and runs the relevance/article-pick path for missing coverage.",
    kind: "pipeline",
    checkScopes: ["relevance"],
  },
  "too-short": {
    buttonLabel: "Run agent: expand summaries",
    confirmTitle: "Expand short summaries with the Summary Agent?",
    confirmDescription:
      "Runs the editorial pipeline (summary scope) to rewrite summaries into the 100–110 character window.",
    kind: "pipeline",
    checkScopes: ["summary"],
  },
  "too-long": {
    buttonLabel: "Run agent: trim summaries",
    confirmTitle: "Trim long summaries with the Summary Agent?",
    confirmDescription:
      "Runs the editorial pipeline (summary scope) to rewrite summaries into the 100–110 character window.",
    kind: "pipeline",
    checkScopes: ["summary"],
  },
  "ends-period": {
    buttonLabel: "Fix trailing periods",
    confirmTitle: "Remove trailing periods from selected summaries?",
    confirmDescription:
      "Deterministic fix — strips a trailing full stop. Does not run the LLM pipeline.",
    kind: "remove-periods",
  },
  "has-hyphen": {
    buttonLabel: "Run agent: rewrite summary",
    confirmTitle: "Rewrite summaries with unusual symbols?",
    confirmDescription:
      "Runs the Summary Agent via the editorial pipeline to produce clean one-event prose without disallowed punctuation.",
    kind: "pipeline",
    checkScopes: ["summary"],
  },
  truncated: {
    buttonLabel: "Run agent: finish summary",
    confirmTitle: "Finish truncated summaries?",
    confirmDescription:
      "Runs the Summary Agent to complete cut-off summaries from the stored article context.",
    kind: "pipeline",
    checkScopes: ["summary"],
  },
  "excessive-dots": {
    buttonLabel: "Run agent: rewrite summary",
    confirmTitle: "Rewrite summaries with excessive dots?",
    confirmDescription: "Runs the Summary Agent to replace placeholder-style dot runs with proper prose.",
    kind: "pipeline",
    checkScopes: ["summary"],
  },
  "generic-fallback": {
    buttonLabel: "Run agent: replace generic copy",
    confirmTitle: "Replace generic fallback summaries?",
    confirmDescription:
      "Runs relevance + summary agents to swap boilerplate for a concrete dated event when possible.",
    kind: "pipeline",
    checkScopes: ["relevance", "summary"],
  },
  "repeated-words": {
    buttonLabel: "Run agent: rewrite summary",
    confirmTitle: "Rewrite summaries with repeated words?",
    confirmDescription: "Runs the Summary Agent to produce tighter prose without repetitive wording.",
    kind: "pipeline",
    checkScopes: ["summary"],
  },
  "placeholder-text": {
    buttonLabel: "Run agent: pick real event",
    confirmTitle: "Replace placeholder summaries?",
    confirmDescription:
      "Runs the relevance path to find a real dated event (article pick when needed) instead of placeholder text.",
    kind: "pipeline",
    checkScopes: ["relevance"],
  },
  "duplicate-summary": {
    buttonLabel: "Run agent: resolve duplicates",
    confirmTitle: "Resolve duplicate summaries?",
    confirmDescription:
      "Runs duplicate detection (and summary rewrite when needed). Duplicate decisions queue for human approval.",
    kind: "pipeline",
    checkScopes: ["duplicates", "summary"],
  },
};

export const QUALITY_CHECK_AGENT_TAB_IDS = Object.keys(QUALITY_CHECK_AGENT_ACTIONS);

export type QualityCheckDateInput = {
  date: string;
  year?: number;
  month?: number;
};

export type PipelineRunWindow = {
  dateFrom: string;
  dateTo: string;
  maxDays: number;
  totalDays: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** First/last ISO dates for a calendar month (respects Bitcoin timeline start on 2009-01-03). */
export function monthPipelineWindow(year: number, month: number): PipelineRunWindow {
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const dateFrom = year === 2009 && month === 1 ? "2009-01-03" : `${monthPrefix}-01`;
  const dateTo = `${monthPrefix}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const totalDays =
    Math.floor((Date.parse(`${dateTo}T12:00:00Z`) - Date.parse(`${dateFrom}T12:00:00Z`)) / 86_400_000) + 1;
  return { dateFrom, dateTo, maxDays: Math.max(totalDays, 1), totalDays: Math.max(totalDays, 1) };
}

function parseIsoUtc(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

function addDaysIso(date: string, delta: number): string {
  const next = new Date(parseIsoUtc(date));
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

/** Cluster sorted ISO dates into contiguous inclusive ranges. */
export function clusterIsoDatesIntoWindows(dates: string[]): PipelineRunWindow[] {
  const sorted = [...new Set(dates.filter(isIsoDate))].sort();
  if (sorted.length === 0) return [];

  const windows: PipelineRunWindow[] = [];
  let start = sorted[0]!;
  let end = start;

  for (let i = 1; i < sorted.length; i += 1) {
    const date = sorted[i]!;
    const gapDays = Math.round((parseIsoUtc(date) - parseIsoUtc(end)) / 86_400_000);
    if (gapDays === 1) {
      end = date;
      continue;
    }
    const totalDays = Math.round((parseIsoUtc(end) - parseIsoUtc(start)) / 86_400_000) + 1;
    windows.push({ dateFrom: start, dateTo: end, maxDays: totalDays, totalDays });
    start = date;
    end = date;
  }

  const totalDays = Math.round((parseIsoUtc(end) - parseIsoUtc(start)) / 86_400_000) + 1;
  windows.push({ dateFrom: start, dateTo: end, maxDays: totalDays, totalDays });
  return windows;
}

/** Split a long inclusive window into ≤31-day pipeline slices (matches Agents v2 panel). */
export function slicePipelineWindow(window: PipelineRunWindow, sliceSize = 31): PipelineRunWindow[] {
  if (window.totalDays <= sliceSize) {
    return [{ ...window, maxDays: Math.min(window.totalDays, sliceSize) }];
  }

  const slices: PipelineRunWindow[] = [];
  let cursor = window.dateFrom;
  while (cursor <= window.dateTo) {
    const sliceEnd = addDaysIso(cursor, sliceSize - 1);
    const dateTo = sliceEnd > window.dateTo ? window.dateTo : sliceEnd;
    const totalDays = Math.round((parseIsoUtc(dateTo) - parseIsoUtc(cursor)) / 86_400_000) + 1;
    slices.push({
      dateFrom: cursor,
      dateTo,
      maxDays: totalDays,
      totalDays,
    });
    cursor = addDaysIso(dateTo, 1);
  }
  return slices;
}

export function resolveQualityCheckRunWindows(
  checkId: string,
  rows: QualityCheckDateInput[],
  selectedDates: Set<string>,
): PipelineRunWindow[] {
  const action = QUALITY_CHECK_AGENT_ACTIONS[checkId];
  if (!action || action.kind !== "pipeline") return [];

  const pickRows =
    selectedDates.size > 0 ? rows.filter((row) => selectedDates.has(row.date)) : rows;

  if (checkId === "missing-months") {
    const monthWindows = pickRows
      .filter((row) => typeof row.year === "number" && typeof row.month === "number")
      .map((row) => monthPipelineWindow(row.year!, row.month!));
    return monthWindows.flatMap((window) => slicePipelineWindow(window));
  }

  const dates = pickRows.map((row) => row.date).filter(isIsoDate);
  return clusterIsoDatesIntoWindows(dates).flatMap((window) => slicePipelineWindow(window));
}

export function getQualityCheckAgentAction(checkId: string | null | undefined): QualityCheckAgentAction | null {
  if (!checkId) return null;
  return QUALITY_CHECK_AGENT_ACTIONS[checkId] ?? null;
}

import type { EditorialReviewItem } from "@/lib/editorial-pipeline";
import { parseOperatorSnapshot, type OperatorSnapshot } from "@/pages/agents-v2/parse-operator-snapshot";

export type AgentsV2PipelinePhase =
  | "triage"
  | "awaiting_article_pick"
  | "awaiting_summary_approval"
  | "awaiting_correction_approval"
  | "awaiting_calendar_decision"
  | "awaiting_duplicate_decision";

export type AgentsV2QueueRow = {
  id: string;
  date: string;
  title: string;
  subtitle?: string;
  pipelinePhase: AgentsV2PipelinePhase;
  timelineStepOverride?: number;
  status: "pending" | "approved" | "rejected";
  outcomePreview?: { kind: "approve" | "reject"; line: string };
  operatorSnapshot: OperatorSnapshot | null;
  item: EditorialReviewItem;
  /** When multiple calendar queue items share a date, they render as one merged row. */
  calendarGroup?: {
    key: string;
    dates: string[];
    sharedDates: string[];
    rows: AgentsV2QueueRow[];
  };
};

function candidateCountFromItem(item: EditorialReviewItem): number {
  if (item.candidates?.length) return item.candidates.length;
  const raw = (item.package as { candidates?: unknown })?.candidates;
  return Array.isArray(raw) ? raw.length : 0;
}

function readPackagePhase(pkg: unknown): string | undefined {
  if (!pkg || typeof pkg !== "object") return undefined;
  const p = (pkg as { phase?: unknown }).phase;
  return typeof p === "string" ? p : undefined;
}

/** Prefer API `reviewPhase`; fall back to `package.phase` so UI matches stored JSON. */
export function effectiveReviewItemPhase(item: EditorialReviewItem): string | null {
  const rp = item.reviewPhase;
  if (rp && rp !== "legacy") return rp;
  const fromPkg = readPackagePhase(item.package);
  if (fromPkg && fromPkg !== "legacy") return fromPkg;
  return rp ?? null;
}

function mapReviewPhase(phase: string | null | undefined): AgentsV2PipelinePhase {
  switch (phase) {
    case "awaiting_article_pick":
    case "awaiting_summary_approval":
    case "awaiting_correction_approval":
    case "awaiting_calendar_decision":
    case "awaiting_duplicate_decision":
      return phase;
    default:
      return "triage";
  }
}

function phaseTitle(phase: AgentsV2PipelinePhase, item: EditorialReviewItem): string {
  if (phase === "awaiting_correction_approval" && item.proposals?.length) {
    return "Review suggested fixes";
  }
  if (item.actionPlan?.headline) return item.actionPlan.headline;
  switch (phase) {
    case "awaiting_article_pick":
      return item.hasCandidates === false && candidateCountFromItem(item) === 0 ?
          "No Exa candidates — confirm empty or rerun"
        : "Pick the winning article";
    case "awaiting_summary_approval":
      return "Approve generated summary";
    case "awaiting_correction_approval":
      return "Review suggested fixes";
    case "awaiting_calendar_decision":
      if (item.calendarReciprocalPair) {
        return `Calendar pair — ${item.calendarReciprocalPair.sideA.date} vs ${item.calendarReciprocalPair.sideB.date}`;
      }
      return "Calendar mismatch — choose action";
    case "awaiting_duplicate_decision":
      return "Possible duplicate — choose action";
    default:
      return "Editorial review";
  }
}

function phaseSubtitle(phase: AgentsV2PipelinePhase, item: EditorialReviewItem): string | undefined {
  const reasons = (item.package as { triage?: { reasons?: string[] } } | null)?.triage?.reasons;
  const firstReason = Array.isArray(reasons) ? reasons[0] : undefined;
  switch (phase) {
    case "awaiting_article_pick":
      if (item.hasCandidates === false && candidateCountFromItem(item) === 0) {
        return "Exa returned zero URLs across tiers.";
      }
      if (candidateCountFromItem(item)) {
        return `${candidateCountFromItem(item)} ranked candidate(s); summary after your pick.`;
      }
      return firstReason;
    case "awaiting_summary_approval":
      return item.summaryApproval?.winningArticle.title;
    case "awaiting_correction_approval":
      return item.proposals?.length ?
          `${item.proposals.length} proposal(s) ready`
        : "No automatic proposals";
    case "awaiting_calendar_decision":
      if (item.calendarReciprocalPair?.chronology) {
        return item.calendarReciprocalPair.chronology.rationale.length > 110
          ? `${item.calendarReciprocalPair.chronology.rationale.slice(0, 107).trim()}…`
          : item.calendarReciprocalPair.chronology.rationale;
      }
      if (item.calendarDecision) {
        const reason = item.calendarDecision.reason?.trim();
        const clipped =
          reason && reason.length > 100 ? `${reason.slice(0, 97).trim()}…` : reason;
        return clipped
          ? `${item.calendarDecision.expectedDate} — ${clipped}`
          : `Story may belong on ${item.calendarDecision.expectedDate}`;
      }
      return undefined;
    case "awaiting_duplicate_decision":
      return item.duplicateDecision ?
          `${item.duplicateDecision.neighbors.length} neighbor(s) flagged`
        : undefined;
    default:
      return firstReason ?? item.actionPlan?.approveSummary;
  }
}

export type ExpectedOperatorExperienceV3 = {
  headline: string;
  bullets: string[];
};

/** Design-reference copy aligned with `docs/TEST_JAN_2026_EDITORIAL_SCENARIOS.md` (V3 gated fetch on). */
export function expectedFirstOperatorExperienceV3(row: AgentsV2QueueRow): ExpectedOperatorExperienceV3 {
  const route = (row.item.package as { triage?: { route?: string } } | null)?.triage?.route;
  const phase = row.pipelinePhase;

  const correctionFamilyBullets: string[] = [
    "Per test matrix (C-*): triage route existing_needs_correction — V3 checks → correction / calendar / duplicate package, not article pick.",
    "Operator sees structured fixes (corrections / action plan), not gated article pick.",
  ];

  const scenario = (row.item.package as { scenario?: string } | null)?.scenario;

  if (phase === "awaiting_article_pick" && route === "existing_needs_correction" && scenario !== "better_storyline") {
    return {
      headline: "Unexpected: article pick with a correction-route day",
      bullets: [
        "TEST_JAN_2026 expects C-* days on existing_needs_correction to reach corrections / action plan, not article pick.",
        "If this is real data, capture package.phase + triage for debugging; rerun triage or pipeline after code fixes.",
      ],
    };
  }

  if (phase === "awaiting_article_pick") {
    if (scenario === "better_storyline") {
      return {
        headline: "Pick a stronger stored article",
        bullets: [
          "The current summary passes basic checks but is too generic for the Bitcoin-history timeline.",
          "Choose from articles already fetched for this day; summary, tags, and topics regenerate after your pick.",
          "Reject this review only if you want to keep the current storyline.",
        ],
      };
    }
    if (route === "missing_day") {
      return {
        headline: "Article pick (or confirm empty after Exa)",
        bullets: [
          "Per test matrix (M): triage route missing_day — baseline green-field day (no historical_news_analyses row).",
          "Exa fetch → ranked pool; you pick the winning article or confirm the day is genuinely empty.",
          "Summary and tags follow only after this gate (gated fetch / V3 on).",
        ],
      };
    }
    if (route === "empty_day") {
      return {
        headline: "Gated fetch → article pick",
        bullets: [
          "Per test matrix (E-SUM / E-FETCH): triage route empty_day — row exists but triage still needs Exa refetch / article pick (e.g. zero corpus, unusable top article, missing taxonomy, or weak summary without enough context to redo in place).",
          "If the day is manually curated with a real article + tags but only a short blurb, expect existing_needs_correction + redo_summary (100–110 chars), not this gate.",
          "Same operator gate as missing_day: choose an article from the pool or confirm empty before the long write path.",
        ],
      };
    }
    return {
      headline: "Article pick (or confirm empty after Exa)",
      bullets: [
        "Review ranked candidates from the latest Exa fetch.",
        "Approve a winner or reject — downstream summary work runs after this decision.",
      ],
    };
  }

  if (phase === "awaiting_summary_approval") {
    return {
      headline: "Post-pick summary approval",
      bullets: [
        "Per optional matrix in TEST_JAN_2026: phase awaiting_summary_approval — after article pick approval path.",
        "An article is already chosen; the model drafted a summary and proposed tags/topics — edit or approve before persistence.",
      ],
    };
  }

  if (phase === "awaiting_correction_approval") {
    return {
      headline: "Corrections / action plan",
      bullets: [
        ...correctionFamilyBullets,
        "Deterministic proposals: opt in per item — nothing applies until you approve.",
      ],
    };
  }

  if (phase === "awaiting_calendar_decision") {
    return {
      headline: item.calendarReciprocalPair ? "Unified calendar pair conflict" : "Calendar mismatch decision",
      bullets: item.calendarReciprocalPair
        ? [
            "Both dates flagged each other — resolve them in one view instead of two separate queue items.",
            "When the agent detects the same legislative passage, it prefers the earlier vote date.",
            "Apply recommendation keeps the bill on the earlier date and deletes duplicate coverage on the later date.",
          ]
        : [
            "Optional matrix: summary text triggers canonical date mismatch (detectCanonicalDateMismatch + data rules).",
            "Choose move, keep as-is, or delete — the writer applies the outcome.",
          ],
    };
  }

  if (phase === "awaiting_duplicate_decision") {
    return {
      headline: "Strong duplicate neighbor review",
      bullets: [
        "Optional matrix: neighbor summaries/tags in a window flagged a possible duplicate.",
        "You dedupe or differentiate explicitly — no silent merges.",
      ],
    };
  }

  if (phase === "triage" && row.operatorSnapshot?.shortCircuited) {
    return {
      headline: "Agent chain needs follow-up",
      bullets: [
        "This run stopped before it produced a final review package.",
        "Use resume slices for the specific failed step, or reject and rerun the day.",
        "Open the day if manual editing is clearer.",
      ],
    };
  }

  if (phase === "triage") {
    if (route === "existing_ok") {
      return {
        headline: "V3 clean path → often auto-approved",
        bullets: [
          "Per test matrix (O): triage route existing_ok — healthy row; queue entry is often auto-closed / audit with no pending work unless auto-approve is disabled.",
          "If this row is still pending, you are in an explicit audit or override path — use the panel actions as usual.",
        ],
      };
    }
    if (route === "missing_day") {
      return {
        headline: "Article pick (or confirm empty after Exa)",
        bullets: [
          "Triage route missing_day — next step in V3 is normally awaiting_article_pick after the run attaches the package.",
          "If you stay stuck here, confirm EDITORIAL_PIPELINE_V3_GATED_FETCH=1 and re-run the day.",
        ],
      };
    }
    if (route === "empty_day") {
      return {
        headline: "Gated fetch → article pick",
        bullets: [
          "Triage route empty_day — matrix expects the queue to move to article pick once the gated package is ready.",
          "If you stay stuck here, confirm gated fetch env and pipeline logs for this date.",
        ],
      };
    }
    if (route === "existing_needs_correction") {
      return {
        headline: "Corrections / action plan",
        bullets: [
          ...correctionFamilyBullets,
          "Queue should advance to correction / calendar / duplicate phases — read triage reasons and the action plan on the right.",
        ],
      };
    }
    return {
      headline: "General triage review",
      bullets: [
        "Read triage reasons and the action plan on the right when present.",
        "If this is missing_day / empty_day and you still see legacy blockers, confirm the server has EDITORIAL_PIPELINE_V3_GATED_FETCH=1 and rerun.",
      ],
    };
  }

  return {
    headline: "Operator gate",
    bullets: ["Work through the controls below — this phase did not map to a canned V3 storyboard line."],
  };
}

export function mapReviewItemToQueueRow(item: EditorialReviewItem): AgentsV2QueueRow {
  const operatorSnapshot = parseOperatorSnapshot(item.package);
  const phase = mapReviewPhase(effectiveReviewItemPhase(item));
  const status =
    item.status === "approved" || item.status === "rejected" || item.status === "pending" ?
      item.status
    : "pending";

  const outcomePreview =
    status === "pending" && item.actionPlan?.approveEnabled && item.actionPlan.approveSummary ?
      {
        kind: "approve" as const,
        line: item.actionPlan.approveSummary,
      }
    : undefined;

  return {
    id: item.id,
    date: item.eventDate ?? "????-??-??",
    title: phaseTitle(phase, item),
    subtitle: phaseSubtitle(phase, item),
    pipelinePhase: phase,
    status,
    outcomePreview,
    operatorSnapshot,
    item,
  };
}

export function calendarDatesInRow(row: AgentsV2QueueRow): string[] {
  if (row.pipelinePhase !== "awaiting_calendar_decision") return [row.date];
  const pair = row.item.calendarReciprocalPair;
  if (pair) return [pair.sideA.date, pair.sideB.date];
  const cd = row.item.calendarDecision;
  if (cd) return [cd.currentDate, cd.expectedDate];
  return [row.date];
}

function dedupeReciprocalCalendarRows(rows: AgentsV2QueueRow[]): AgentsV2QueueRow[] {
  const seen = new Set<string>();
  const out: AgentsV2QueueRow[] = [];
  for (const row of rows) {
    const key = row.item.calendarReciprocalPair?.pairKey;
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const pair = row.item.calendarReciprocalPair!;
    const primary =
      rows.find(
        (candidate) =>
          candidate.item.calendarReciprocalPair?.pairKey === key &&
          candidate.date === pair.chronology.keepDate,
      ) ?? row;
    out.push(primary);
  }
  return out;
}

function buildCalendarGroupDisplayRow(groupRows: AgentsV2QueueRow[]): AgentsV2QueueRow {
  const dates = [...new Set(groupRows.flatMap(calendarDatesInRow))].sort();
  const dateCounts = new Map<string, number>();
  for (const row of groupRows) {
    for (const date of calendarDatesInRow(row)) {
      dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
    }
  }
  const sharedDates = [...dateCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([date]) => date)
    .sort();
  const primary = [...groupRows].sort((a, b) => a.date.localeCompare(b.date))[0];
  const key = `calendar-group:${dates.join("|")}`;

  const subtitle =
    sharedDates.length > 0
      ? `${sharedDates.join(", ")} ${sharedDates.length === 1 ? "is" : "are"} in multiple calendar flags`
      : `${groupRows.length} related calendar flags — review together`;

  return {
    ...primary,
    id: key,
    date: sharedDates[0] ?? dates[0] ?? primary.date,
    title: "Linked calendar conflicts",
    subtitle,
    calendarGroup: {
      key,
      dates,
      sharedDates,
      rows: groupRows,
    },
  };
}

/** Merge calendar queue rows that share any date so operators see linked conflicts once. */
export function groupCalendarQueueRows(rows: AgentsV2QueueRow[]): AgentsV2QueueRow[] {
  const calendarRows = rows.filter((row) => row.pipelinePhase === "awaiting_calendar_decision");
  if (calendarRows.length === 0) return rows;

  const deduped = dedupeReciprocalCalendarRows(calendarRows);
  const parent = new Map<string, string>();
  const find = (date: string): string => {
    const current = parent.get(date) ?? date;
    if (current === date) return date;
    const root = find(current);
    parent.set(date, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parent.set(rootRight, rootLeft);
  };

  for (const row of deduped) {
    const dates = calendarDatesInRow(row);
    for (const date of dates) {
      if (!parent.has(date)) parent.set(date, date);
    }
    for (let i = 1; i < dates.length; i += 1) union(dates[0], dates[i]);
  }

  const components = new Map<string, AgentsV2QueueRow[]>();
  for (const row of deduped) {
    const root = find(calendarDatesInRow(row)[0]);
    const list = components.get(root) ?? [];
    list.push(row);
    components.set(root, list);
  }

  const memberToDisplay = new Map<string, AgentsV2QueueRow>();
  for (const groupRows of components.values()) {
    if (groupRows.length === 1) {
      memberToDisplay.set(groupRows[0].id, groupRows[0]);
      continue;
    }
    const display = buildCalendarGroupDisplayRow(groupRows);
    for (const row of groupRows) {
      memberToDisplay.set(row.id, display);
    }
    for (const row of calendarRows) {
      const pairKey = row.item.calendarReciprocalPair?.pairKey;
      if (!pairKey) continue;
      if (groupRows.some((member) => member.item.calendarReciprocalPair?.pairKey === pairKey)) {
        memberToDisplay.set(row.id, display);
      }
    }
  }

  const emitted = new Set<string>();
  const result: AgentsV2QueueRow[] = [];
  for (const row of rows) {
    if (row.pipelinePhase !== "awaiting_calendar_decision") {
      result.push(row);
      continue;
    }
    const display = memberToDisplay.get(row.id);
    if (!display) continue;
    if (emitted.has(display.id)) continue;
    emitted.add(display.id);
    result.push(display);
  }
  return result;
}

export function duplicatePairKey(row: AgentsV2QueueRow): string | null {
  if (row.pipelinePhase !== "awaiting_duplicate_decision") return null;
  const decision = row.item.duplicateDecision;
  if (!decision?.neighbors?.length) return null;
  const neighbor = decision.neighbors[0]?.date;
  if (!neighbor) return null;
  const [a, b] = [row.date, neighbor].sort();
  return `${a}::${b}`;
}

export function consolidateDuplicateQueueRows(rows: AgentsV2QueueRow[]): AgentsV2QueueRow[] {
  const seen = new Set<string>();
  const out: AgentsV2QueueRow[] = [];
  for (const row of rows) {
    const key = duplicatePairKey(row);
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function consolidateQueueRows(rows: AgentsV2QueueRow[]): AgentsV2QueueRow[] {
  return consolidateDuplicateQueueRows(groupCalendarQueueRows(rows));
}

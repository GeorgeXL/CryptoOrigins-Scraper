export type CalendarChronologyHint = {
  likelyEventDate: string;
  duplicateDate: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  reciprocalConflict: boolean;
  /** Recommended unified resolution: keep bill on earlier date, remove duplicate later row. */
  keepDate: string;
  removeDate: string;
};

export type CalendarPairSide = {
  queueItemId?: string;
  date: string;
  summary: string;
  tags: string[];
  topics: string[];
  pointsAtDate: string;
};

export type CalendarReciprocalPair = {
  pairKey: string;
  sideA: CalendarPairSide;
  sideB: CalendarPairSide;
  chronology: CalendarChronologyHint;
};

const LEGISLATIVE_PASS_RE =
  /\b(passes?|passed|approves?|approved|signs?|signed|enacts?|enacted|adopts?|adopted)\b/i;
const BILL_REF_RE = /\b(bill|hb\s*\d+|house bill|legislation|act|436)\b/i;

function normalizeSummary(text: string | null | undefined): string {
  return String(text ?? "").trim();
}

export function summaryConflatesMultipleLegislativeTopics(summary: string): boolean {
  const lower = summary.toLowerCase();
  const hasBitcoinLegislation =
    /\b(bitcoin|btc|crypto businesses|bill 436|hb\s*436)\b/i.test(lower);
  const hasCannabis = /\b(cannabis|marijuana|decriminali)/i.test(lower);
  return hasBitcoinLegislation && hasCannabis;
}

export function summariesDescribeSameLegislativeStory(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (!/\bnew hampshire\b/.test(left) || !/\bnew hampshire\b/.test(right)) {
    if (!/\b(house|senate|congress|parliament)\b/.test(left) || !/\b(house|senate|congress|parliament)\b/.test(right)) {
      return false;
    }
  }
  const leftLegislative = LEGISLATIVE_PASS_RE.test(a) && (BILL_REF_RE.test(a) || /\bbitcoin\b/i.test(a));
  const rightLegislative = LEGISLATIVE_PASS_RE.test(b) && (BILL_REF_RE.test(b) || /\bbitcoin\b/i.test(b));
  if (!leftLegislative || !rightLegislative) return false;

  const sharedBillNumber =
    (/\b436\b/.test(left) && /\b436\b/.test(right)) ||
    (/\bhb\s*436\b/.test(left) && /\bhb\s*436\b/.test(right));
  const sharedBitcoinBill =
    /\bbitcoin\b/.test(left) &&
    /\bbitcoin\b/.test(right) &&
    /\b(house|bill|legislat)/.test(left) &&
    /\b(house|bill|legislat)/.test(right);

  return sharedBillNumber || sharedBitcoinBill;
}

export function calendarPairKey(dateA: string, dateB: string): string {
  return [dateA, dateB].sort().join("::");
}

export function isReciprocalCalendarConflict(
  a: { currentDate: string; expectedDate: string },
  b: { currentDate: string; expectedDate: string },
): boolean {
  return a.currentDate === b.expectedDate && a.expectedDate === b.currentDate;
}

/** Prefer the earlier calendar date for the same legislative passage story. */
export function inferCalendarChronologyHint(input: {
  dateA: string;
  summaryA: string;
  dateB: string;
  summaryB: string;
  reciprocalConflict?: boolean;
}): CalendarChronologyHint | null {
  const summaryA = normalizeSummary(input.summaryA);
  const summaryB = normalizeSummary(input.summaryB);
  if (!summaryA || !summaryB) return null;

  const earlier = input.dateA < input.dateB ? input.dateA : input.dateB;
  const later = input.dateA < input.dateB ? input.dateB : input.dateA;
  const earlierSummary = input.dateA < input.dateB ? summaryA : summaryB;
  const laterSummary = input.dateA < input.dateB ? summaryB : summaryA;

  if (!summariesDescribeSameLegislativeStory(summaryA, summaryB)) return null;

  const conflatedEarlier = summaryConflatesMultipleLegislativeTopics(earlierSummary);
  const conflatedLater = summaryConflatesMultipleLegislativeTopics(laterSummary);
  const conflationNote =
    conflatedEarlier && !conflatedLater
      ? ` ${earlier} also mixes unrelated topics (e.g. cannabis) — edit that summary after keeping the bill on this date.`
      : conflatedLater && !conflatedEarlier
        ? ` ${later} looks like follow-up coverage of the same bill passage.`
        : "";

  return {
    likelyEventDate: earlier,
    duplicateDate: later,
    confidence: "high",
    rationale: `Both rows describe the same legislative passage. The vote or signing usually belongs on the earlier date (${earlier}), not duplicate coverage on ${later}.${conflationNote}`,
    reciprocalConflict: Boolean(input.reciprocalConflict),
    keepDate: earlier,
    removeDate: later,
  };
}

export function buildCalendarReciprocalPair(input: {
  itemA: {
    id: string;
    currentDate: string;
    expectedDate: string;
    summary: string;
    tags: string[];
    topics: string[];
  };
  itemB: {
    id: string;
    currentDate: string;
    expectedDate: string;
    summary: string;
    tags: string[];
    topics: string[];
  };
}): CalendarReciprocalPair | null {
  const a = {
    currentDate: input.itemA.currentDate,
    expectedDate: input.itemA.expectedDate,
  };
  const b = {
    currentDate: input.itemB.currentDate,
    expectedDate: input.itemB.expectedDate,
  };
  if (!isReciprocalCalendarConflict(a, b)) return null;

  const chronology = inferCalendarChronologyHint({
    dateA: input.itemA.currentDate,
    summaryA: input.itemA.summary,
    dateB: input.itemB.currentDate,
    summaryB: input.itemB.summary,
    reciprocalConflict: true,
  });
  if (!chronology) return null;

  const sideA: CalendarPairSide = {
    queueItemId: input.itemA.id,
    date: input.itemA.currentDate,
    summary: input.itemA.summary,
    tags: input.itemA.tags,
    topics: input.itemA.topics,
    pointsAtDate: input.itemA.expectedDate,
  };
  const sideB: CalendarPairSide = {
    queueItemId: input.itemB.id,
    date: input.itemB.currentDate,
    summary: input.itemB.summary,
    tags: input.itemB.tags,
    topics: input.itemB.topics,
    pointsAtDate: input.itemB.expectedDate,
  };

  return {
    pairKey: calendarPairKey(input.itemA.currentDate, input.itemB.currentDate),
    sideA,
    sideB,
    chronology,
  };
}

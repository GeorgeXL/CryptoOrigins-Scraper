export const MAIN_EVENTS_CHECK_MAX_DATES = 100;
/** @deprecated use MAIN_EVENTS_CHECK_MAX_DATES */
export const LEAF_AGENT_DEFAULT_MAX_DATES = MAIN_EVENTS_CHECK_MAX_DATES;
export const LEAF_AGENT_MAX_DATES = MAIN_EVENTS_CHECK_MAX_DATES;
export const LEAF_AGENT_CORPUS_START_DATE = "2009-01-03";
export const LEAF_AGENT_CORPUS_END_DATE = "2024-12-31";

/** Bump when corpus window, hierarchy, or Gemini ask shape changes so stale caches are ignored. */
export const MAIN_EVENTS_CHECK_CACHE_VERSION = `${LEAF_AGENT_CORPUS_START_DATE}:${LEAF_AGENT_CORPUS_END_DATE}:${MAIN_EVENTS_CHECK_MAX_DATES}:hierarchy-v2-2026-06`;

export type MainEventsDismissCategory = "misplaced" | "missing" | "extra";

export type MainEventsDismissals = {
  misplaced: string[];
  missing: string[];
  extra: string[];
};

export const EMPTY_MAIN_EVENTS_DISMISSALS: MainEventsDismissals = {
  misplaced: [],
  missing: [],
  extra: [],
};

/** Manual / agent review vs cached Gemini list — persisted per leaf on main_events_check_cache. */
export type MainEventsVerificationStatus = "matched" | "pending" | "rejected";

export type MainEventsVerificationDates = {
  /** Editor accepted — main event confirmed for this leaf. */
  matched: string[];
  /** Not yet reviewed, or moved back from accepted/rejected. */
  pending: string[];
  /** Editor rejected — not accepted as a main event for this leaf. */
  rejected: string[];
};

export const EMPTY_MAIN_EVENTS_VERIFICATION_DATES: MainEventsVerificationDates = {
  matched: [],
  pending: [],
  rejected: [],
};

export type MainEventsReviewDecision = "accepted" | "rejected" | "pending";

export type MainEventsReviewDbStatus = "in_db" | "missing" | "wrong_leaf" | "untagged";

export type MainEventsReviewItem = {
  date: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  sourceUrl?: string;
  dbStatus: MainEventsReviewDbStatus;
  dbSummary?: string;
  wrongLeafLabel?: string;
  isLocked?: boolean;
  reviewStatus: "pending" | "accepted" | "rejected";
};

export type MainEventsReviewQueue = {
  leaf: string;
  leafLabel: string;
  items: MainEventsReviewItem[];
  counts: {
    pending: number;
    accepted: number;
    rejected: number;
    total: number;
  };
};

/** One Gemini proposal for a date on a specific storyline leaf. */
export type MainEventsCrossLeafProposal = {
  leaf: string;
  leafLabel: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  sourceUrl?: string;
};

/** A date proposed by multiple leaves — pick one owner leaf. */
export type MainEventsCrossLeafDuplicate = {
  date: string;
  proposals: MainEventsCrossLeafProposal[];
  dbSummary?: string;
  dbStatus?: MainEventsReviewDbStatus;
  dbNote?: string;
  wrongLeafLabel?: string;
  /** Canonical storyline leaf from the database row's primary topic tag. */
  dbOwnerLeaf?: string;
  dbOwnerLeafLabel?: string;
  isLocked?: boolean;
};

export type MainEventsCrossLeafQueue = {
  items: MainEventsCrossLeafDuplicate[];
  counts: {
    unresolved: number;
    assigned: number;
  };
};

/** Sentinel row in main_events_check_cache — stores cross-leaf date ownership as JSON in `notes`. */
export const MAIN_EVENTS_CROSS_LEAF_SENTINEL = "__cross_leaf_assignments__";
export const MAIN_EVENTS_CROSS_LEAF_CACHE_VERSION = "cross-leaf-assignments-v1";

export function resolveMainEventsReviewStatus(
  date: string,
  verification: MainEventsVerificationDates,
): "pending" | "accepted" | "rejected" {
  if (verification.matched.includes(date)) return "accepted";
  if (verification.rejected.includes(date)) return "rejected";
  return "pending";
}

export function clampLeafAgentMaxDates(value: number, fallback = LEAF_AGENT_DEFAULT_MAX_DATES): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(LEAF_AGENT_MAX_DATES, Math.max(1, Math.trunc(value)));
}

export function isWithinLeafAgentCorpusRange(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date >= LEAF_AGENT_CORPUS_START_DATE && date <= LEAF_AGENT_CORPUS_END_DATE;
}

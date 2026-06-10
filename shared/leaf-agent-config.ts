export const MAIN_EVENTS_CHECK_MAX_DATES = 100;
/** @deprecated use MAIN_EVENTS_CHECK_MAX_DATES */
export const LEAF_AGENT_DEFAULT_MAX_DATES = MAIN_EVENTS_CHECK_MAX_DATES;
export const LEAF_AGENT_MAX_DATES = MAIN_EVENTS_CHECK_MAX_DATES;
export const LEAF_AGENT_CORPUS_START_DATE = "2009-01-03";
export const LEAF_AGENT_CORPUS_END_DATE = "2024-12-31";

/** Bump when corpus window or Gemini ask shape changes so stale caches are ignored. */
export const MAIN_EVENTS_CHECK_CACHE_VERSION = `${LEAF_AGENT_CORPUS_START_DATE}:${LEAF_AGENT_CORPUS_END_DATE}:${MAIN_EVENTS_CHECK_MAX_DATES}`;

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

export function clampLeafAgentMaxDates(value: number, fallback = LEAF_AGENT_DEFAULT_MAX_DATES): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(LEAF_AGENT_MAX_DATES, Math.max(1, Math.trunc(value)));
}

export function isWithinLeafAgentCorpusRange(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date >= LEAF_AGENT_CORPUS_START_DATE && date <= LEAF_AGENT_CORPUS_END_DATE;
}

/** Only these four dates may appear on the Halving events storyline leaf. */
export const CANONICAL_BITCOIN_HALVING_DATES = [
  "2012-11-28",
  "2016-07-09",
  "2020-05-11",
  "2024-04-20",
] as const;

export const HALVING_EVENTS_LEAF = "Halving events";

export const CANONICAL_BITCOIN_HALVING_DATE_SET = new Set<string>(CANONICAL_BITCOIN_HALVING_DATES);

export function isCanonicalBitcoinHalvingDate(date: string): boolean {
  return CANONICAL_BITCOIN_HALVING_DATE_SET.has(date);
}

/**
 * Retag scripts must NEVER assign rows to Halving events except `retag-halving-events.ts`,
 * which keeps only the four canonical block-subsidy halving dates.
 * Pre/post-halving hype → Bitcoin mining or Bitcoin price & cycles.
 */

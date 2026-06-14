/** Deterministic pre-checks for homepage Google check — catches obvious retrospective/anniversary coverage. */

export type GoogleCheckHeuristicResult = {
  /** When true, the row should be "no" without calling the LLM. */
  isRetrospective: boolean;
  reason?: string;
};

const RETROSPECTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brevisits?\b/i, reason: "Summary revisits a past event." },
  { pattern: /\brevisited\b/i, reason: "Summary describes revisited coverage." },
  { pattern: /\brevisiting\b/i, reason: "Summary describes revisiting a past event." },
  { pattern: /\banniversary\b/i, reason: "Summary describes anniversary coverage." },
  { pattern: /\bcommemorat\w*\b/i, reason: "Summary describes commemoration of a past event." },
  { pattern: /\b\d+\s+years?\s+since\b/i, reason: "Summary marks years since a past event." },
  { pattern: /\b\d+\s+years?\s+ago\b/i, reason: "Summary references an event years ago." },
  { pattern: /\bon this day in\b/i, reason: "Summary uses 'on this day in' retrospective framing." },
  { pattern: /\blooking back\b/i, reason: "Summary is retrospective ('looking back')." },
  { pattern: /\blooks back\b/i, reason: "Summary is retrospective ('looks back')." },
  { pattern: /\blook back\b/i, reason: "Summary is retrospective ('look back')." },
  { pattern: /\bflashback\b/i, reason: "Summary is a flashback to a past event." },
  { pattern: /\bretrospective\b/i, reason: "Summary is explicitly retrospective." },
  { pattern: /\bin retrospect\b/i, reason: "Summary is in-retrospect commentary." },
  { pattern: /\bmarks?\s+(his|her|its)\b/i, reason: "Summary marks a personal past milestone." },
  { pattern: /\bday\s+celebrat\w*\b/i, reason: "Summary celebrates an annual day." },
  { pattern: /\bcelebrat\w*\s+(worldwide|globally)\b/i, reason: "Summary describes worldwide celebration of a past event." },
  { pattern: /\bcelebrat\w*\s+.+\s+(day|anniversary)\b/i, reason: "Summary celebrates an annual day/anniversary." },
  { pattern: /\bannual\s+(celebration|commemoration|remembrance)\b/i, reason: "Summary describes annual celebration of a past event." },
  { pattern: /\byears?\s+on\b/i, reason: "Summary marks years on from a past event." },
];

/** Fast path: obvious retrospective/anniversary language → no without search. */
export function evaluateGoogleCheckRetrospectiveHeuristic(summary: string): GoogleCheckHeuristicResult {
  const text = summary.trim();
  if (!text) {
    return { isRetrospective: false };
  }

  for (const { pattern, reason } of RETROSPECTIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { isRetrospective: true, reason };
    }
  }

  return { isRetrospective: false };
}

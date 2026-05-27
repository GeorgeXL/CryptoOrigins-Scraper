/**
 * Quality bounds for editorial day summaries. These mirror the bounds the user
 * already uses in the Events Manager (`server/services/quality-checker.ts`)
 * so the editorial pipeline applies the same standard.
 *
 * The cleanup pipeline uses one hard editorial rule throughout: summaries must
 * be 100-110 characters before a day can be treated as clean.
 */
export const EDITORIAL_SUMMARY_TARGET_MIN = 100;
export const EDITORIAL_SUMMARY_TARGET_MAX = 110;

const FAILURE_SUMMARY_PATTERNS: RegExp[] = [
  /^analysis failed\.?$/i,
  /^no summary\.?$/i,
  /^summary generation failed\.?$/i,
];

/**
 * True when the summary is missing, outside the 100-110 target, or matches
 * known failure placeholders. Used by triage and pipeline executors so steps
 * cannot "complete" on junk text.
 */
export function isEditorialSummaryWeak(summary: string | null | undefined): boolean {
  return evaluateSummaryQuality(summary) !== null;
}

export type SummaryQualityIssue = {
  code: "empty" | "too_short" | "too_long" | "failure_placeholder";
  message: string;
};

/**
 * Stricter than `isEditorialSummaryWeak` — returns the specific issue (if any)
 * so the summary-approval gate can show the operator a meaningful message.
 * Mirrors `QualityCheckerService.checkSummaryQuality` length bounds.
 */
export function evaluateSummaryQuality(summary: string | null | undefined): SummaryQualityIssue | null {
  if (summary == null || summary.trim() === "") {
    return { code: "empty", message: "Summary is empty." };
  }
  const t = summary.trim();
  for (const re of FAILURE_SUMMARY_PATTERNS) {
    if (re.test(t)) {
      return { code: "failure_placeholder", message: `Summary looks like a failure placeholder: "${t}".` };
    }
  }
  if (t.length < EDITORIAL_SUMMARY_TARGET_MIN) {
    return {
      code: "too_short",
      message: `Summary is too short (${t.length} chars; target ${EDITORIAL_SUMMARY_TARGET_MIN}–${EDITORIAL_SUMMARY_TARGET_MAX}).`,
    };
  }
  if (t.length > EDITORIAL_SUMMARY_TARGET_MAX) {
    return {
      code: "too_long",
      message: `Summary is too long (${t.length} chars; target ${EDITORIAL_SUMMARY_TARGET_MIN}–${EDITORIAL_SUMMARY_TARGET_MAX}).`,
    };
  }
  return null;
}

/** Same rules as `POST /api/analysis/date/:date/redo-summary` and admin review `dayRedoSummaryAvailable`. */
export function isValidPipelineTopArticleId(id: string | null | undefined): boolean {
  const v = typeof id === "string" ? id.trim() : "";
  if (!v || v.toLowerCase() === "none") return false;
  if (v.includes("no-news-")) return false;
  // Accept canonical URL winners from historical rows.
  if (v.startsWith("http://") || v.startsWith("https://")) return true;
  // Accept pipeline/manual synthetic winners used by the editorial flow.
  if (v.startsWith("article-") || v.startsWith("manual-") || v.startsWith("known-")) return true;
  return false;
}

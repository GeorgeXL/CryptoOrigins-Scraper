/**
 * Unified editorial pipeline routing — one graph for empty + existing days.
 * Legacy empty-path chain remains opt-in via EDITORIAL_LEGACY_EMPTY_PATH=1.
 */
import type { PipelineCheckScope, TriageRoute } from "./contracts";

export function isLegacyEmptyPathEnabled(): boolean {
  return process.env.EDITORIAL_LEGACY_EMPTY_PATH === "1";
}

/** Empty/missing days: Exa fetch → human article pick → summary approval (default). */
export function shouldUseGatedArticlePick(
  route: TriageRoute,
  checkScopes: Set<PipelineCheckScope>,
): boolean {
  if (isLegacyEmptyPathEnabled()) return false;
  if (!checkScopes.has("relevance")) return false;
  return route === "empty_day" || route === "missing_day";
}

/** Saved days: corpus-clean graph (date → duplicate → relevance → proposals → auto/manual). */
export function shouldUseUnifiedExistingDayClean(
  route: TriageRoute,
  analysisId: string | null,
): boolean {
  return Boolean(analysisId) && (route === "existing_ok" || route === "existing_needs_correction");
}

import type { MainEventsReviewItem, MainEventsReviewQueue } from "./leaf-agent-config";

/**
 * Auto-accept only when Gemini cache and DB clearly agree on this leaf.
 *
 * Criteria (ALL must hold):
 * - reviewStatus === "pending" (not already accepted/rejected)
 * - dbStatus === "in_db" (row exists AND tagged on this leaf)
 * - NOT isLocked (operator-locked days are left for manual review)
 *
 * Cross-leaf reassignment is excluded upstream: dates owned by another leaf
 * never appear in the per-leaf review queue (see buildMainEventsReviewQueue).
 *
 * Never auto-accept: untagged, wrong_leaf, missing, rejected, accepted, or locked.
 */
export function findAutoAcceptCandidates(queue: MainEventsReviewQueue): MainEventsReviewItem[] {
  return queue.items.filter(
    (item) =>
      item.reviewStatus === "pending" &&
      item.dbStatus === "in_db" &&
      !item.isLocked,
  );
}

export type AutoAcceptLeafResult = {
  leaf: string;
  /** Dates that qualify for auto-accept on this leaf. */
  candidates: string[];
  /** Applied accepts (0 when dryRun). Equals candidates.length when all writes succeed. */
  accepted: number;
  /** Review items on this leaf not auto-accepted (remaining manual work). */
  skipped: number;
};

export type AutoAcceptBatchSummary = {
  dryRun: boolean;
  leafResults: AutoAcceptLeafResult[];
  totals: {
    leavesProcessed: number;
    leavesWithCandidates: number;
    /** Sum of candidate dates across leaves. */
    candidateDates: number;
    /** Sum of accepted writes (0 when dryRun). */
    accepted: number;
    skipped: number;
  };
};

export function summarizeAutoAcceptBatch(
  leafResults: AutoAcceptLeafResult[],
  opts?: { dryRun?: boolean },
): AutoAcceptBatchSummary {
  const dryRun = opts?.dryRun ?? false;
  const candidateDates = leafResults.reduce((sum, row) => sum + row.candidates.length, 0);
  const accepted = leafResults.reduce((sum, row) => sum + row.accepted, 0);
  const skipped = leafResults.reduce((sum, row) => sum + row.skipped, 0);

  return {
    dryRun,
    leafResults,
    totals: {
      leavesProcessed: leafResults.length,
      leavesWithCandidates: leafResults.filter((row) => row.candidates.length > 0).length,
      candidateDates,
      accepted: dryRun ? 0 : accepted,
      skipped,
    },
  };
}

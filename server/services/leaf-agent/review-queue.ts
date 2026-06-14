import {
  applyVerificationDecision,
  buildMainEventsReviewQueue,
  reviewDecisionToVerificationStatus,
  type CanonicalDateEntry,
} from "../../../shared/main-events-review-build";
import { resolveMainEventsReviewStatus, type MainEventsReviewDecision, type MainEventsReviewQueue } from "../../../shared/leaf-agent-config";
import { assertReviewDecisionRevertAllowed } from "../../../shared/main-events-verification-lock";
import { applyMainEventsVerificationUpdates, loadCachedMainEvents, loadMainEventsVerificationDates } from "./cache";
import {
  loadAnalysisIndexForLeafCrossCheck,
  resolveStorylineLeaf,
  type LeafDatabaseRow,
} from "./coverage";

export { buildMainEventsReviewQueue, parseVerificationDates, applyVerificationDecision } from "../../../shared/main-events-review-build";

function mapRowToReviewAnalysis(row: LeafDatabaseRow) {
  return {
    date: row.date,
    summary: row.summary,
    topicCategories: row.topics,
    isLocked: row.isLocked,
  };
}

export async function getMainEventsReviewQueue(leafInput: string): Promise<MainEventsReviewQueue> {
  const leaf = resolveStorylineLeaf(leafInput);
  const [cached, verification] = await Promise.all([
    loadCachedMainEvents(leaf),
    loadMainEventsVerificationDates(leaf),
  ]);

  if (!cached) {
    throw new Error("No cached main events list for this leaf — run Prepare all first");
  }

  const canonicalDates = cached.canonical.map((entry) => entry.date);
  const allRows = await loadAnalysisIndexForLeafCrossCheck(leaf, canonicalDates);

  const dateSet = new Set(canonicalDates);
  const analyses = allRows.filter((row) => dateSet.has(row.date)).map(mapRowToReviewAnalysis);

  return buildMainEventsReviewQueue({
    leaf,
    canonical: cached.canonical as CanonicalDateEntry[],
    analyses,
    verification,
  });
}

export async function setMainEventsReviewDecision(opts: {
  leaf: string;
  date: string;
  decision: MainEventsReviewDecision;
}): Promise<MainEventsReviewQueue> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const leaf = resolveStorylineLeaf(opts.leaf);
  const verification = await loadMainEventsVerificationDates(leaf);
  const currentReviewStatus = resolveMainEventsReviewStatus(opts.date, verification);
  assertReviewDecisionRevertAllowed(currentReviewStatus, opts.decision);

  await applyMainEventsVerificationUpdates({
    leaf,
    updates: [{ date: opts.date, status: reviewDecisionToVerificationStatus(opts.decision) }],
  });

  return getMainEventsReviewQueue(leaf);
}

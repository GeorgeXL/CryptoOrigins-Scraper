import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  MainEventsReviewDecision,
  MainEventsVerificationDates,
  MainEventsVerificationStatus,
} from "./leaf-agent-config";

export type MainEventsReviewStatus = "pending" | "accepted" | "rejected";

/** Accept/reject decisions are final in Main Events Check — not revertible to pending. */
export function isMainEventsReviewDecisionFinal(reviewStatus: MainEventsReviewStatus): boolean {
  return reviewStatus === "accepted" || reviewStatus === "rejected";
}

export function assertReviewDecisionRevertAllowed(
  currentReviewStatus: MainEventsReviewStatus,
  decision: MainEventsReviewDecision,
): void {
  if (decision === "pending" && isMainEventsReviewDecisionFinal(currentReviewStatus)) {
    throw new Error("Accepted and rejected review decisions are locked");
  }
}

/** UI + guards: database lock or a final accept/reject decision. */
export function resolveMainEventsReviewItemLocked(opts: {
  isLocked?: boolean | null;
  reviewStatus: MainEventsReviewStatus;
}): boolean {
  return Boolean(opts.isLocked) || isMainEventsReviewDecisionFinal(opts.reviewStatus);
}

/** Accepted/rejected review decisions freeze the day row in historical_news_analyses. */
export function verificationStatusRequiresDayLock(status: MainEventsVerificationStatus): boolean {
  return status === "matched" || status === "rejected";
}

export function reviewDecisionRequiresDayLock(decision: MainEventsReviewDecision): boolean {
  return decision === "accepted" || decision === "rejected";
}

export type DayLockOnVerificationResult = {
  locked: boolean;
  skipped: boolean;
  reason?: "no_lock_needed" | "no_analysis_row" | "already_locked";
};

export async function lockDayOnVerificationStatusSupabase(
  client: SupabaseClient,
  date: string,
  status: MainEventsVerificationStatus,
): Promise<DayLockOnVerificationResult> {
  if (!verificationStatusRequiresDayLock(status)) {
    return { locked: false, skipped: true, reason: "no_lock_needed" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const { data, error } = await client
    .from("historical_news_analyses")
    .select("id, is_locked")
    .eq("date", date)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) {
    return { locked: false, skipped: true, reason: "no_analysis_row" };
  }
  if (data.is_locked) {
    return { locked: false, skipped: false, reason: "already_locked" };
  }

  const { error: updateError } = await client
    .from("historical_news_analyses")
    .update({ is_locked: true })
    .eq("date", date);

  if (updateError) throw new Error(updateError.message);
  return { locked: true, skipped: false };
}

export async function lockDayOnReviewDecisionSupabase(
  client: SupabaseClient,
  date: string,
  decision: MainEventsReviewDecision,
): Promise<DayLockOnVerificationResult> {
  if (!reviewDecisionRequiresDayLock(decision)) {
    return { locked: false, skipped: true, reason: "no_lock_needed" };
  }

  const status: MainEventsVerificationStatus = decision === "accepted" ? "matched" : "rejected";
  return lockDayOnVerificationStatusSupabase(client, date, status);
}

export type CollectMainEventsCheckDatesOptions = {
  /**
   * When false, only matched + rejected (final review states).
   * Default true — every date listed in verification_dates on any leaf.
   *
   * Pending is included because those dates are actively in Main Events Check.
   * Ongoing accept/reject still auto-locks matched/rejected only; this backfill
   * closes the gap for historical rows (including pending already in the queue).
   */
  includePending?: boolean;
};

/** Unique YYYY-MM-DD dates from one leaf's verification_dates buckets. */
export function collectMainEventsCheckDatesFromVerification(
  verification: MainEventsVerificationDates,
  opts: CollectMainEventsCheckDatesOptions = {},
): string[] {
  const includePending = opts.includePending !== false;
  const dates = new Set<string>();
  for (const date of verification.matched) dates.add(date);
  for (const date of verification.rejected) dates.add(date);
  if (includePending) {
    for (const date of verification.pending) dates.add(date);
  }
  return Array.from(dates).sort((a, b) => a.localeCompare(b));
}

/** Unique dates across many verification_dates payloads (e.g. all cache rows). */
export function collectMainEventsCheckDates(
  verifications: MainEventsVerificationDates[],
  opts: CollectMainEventsCheckDatesOptions = {},
): string[] {
  const dates = new Set<string>();
  for (const verification of verifications) {
    for (const date of collectMainEventsCheckDatesFromVerification(verification, opts)) {
      dates.add(date);
    }
  }
  return Array.from(dates).sort((a, b) => a.localeCompare(b));
}

export type BackfillMainEventsDayLockDateResult = {
  date: string;
  action: "locked" | "already_locked" | "no_analysis_row" | "would_lock";
};

export type BackfillMainEventsDayLockSummary = {
  totalDates: number;
  locked: number;
  alreadyLocked: number;
  noAnalysisRow: number;
  wouldLock: number;
};

const ANALYSIS_DATE_BATCH_SIZE = 200;

async function fetchAnalysisLockStateByDate(
  client: SupabaseClient,
  dates: string[],
): Promise<Map<string, boolean>> {
  const byDate = new Map<string, boolean>();
  for (let i = 0; i < dates.length; i += ANALYSIS_DATE_BATCH_SIZE) {
    const batch = dates.slice(i, i + ANALYSIS_DATE_BATCH_SIZE);
    const { data, error } = await client
      .from("historical_news_analyses")
      .select("date, is_locked")
      .in("date", batch);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (typeof row.date === "string") {
        byDate.set(row.date, Boolean(row.is_locked));
      }
    }
  }
  return byDate;
}

/** Set is_locked=true for Main Events Check dates that have a historical_news_analyses row. */
export async function backfillMainEventsCheckDayLocksSupabase(
  client: SupabaseClient,
  dates: string[],
  opts: { dryRun?: boolean } = {},
): Promise<{ summary: BackfillMainEventsDayLockSummary; results: BackfillMainEventsDayLockDateResult[] }> {
  const dryRun = opts.dryRun ?? false;
  const uniqueDates = Array.from(new Set(dates)).sort((a, b) => a.localeCompare(b));
  const lockStateByDate = await fetchAnalysisLockStateByDate(client, uniqueDates);

  const results: BackfillMainEventsDayLockDateResult[] = [];
  const summary: BackfillMainEventsDayLockSummary = {
    totalDates: uniqueDates.length,
    locked: 0,
    alreadyLocked: 0,
    noAnalysisRow: 0,
    wouldLock: 0,
  };

  for (const date of uniqueDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid date format: ${date}`);
    }

    if (!lockStateByDate.has(date)) {
      results.push({ date, action: "no_analysis_row" });
      summary.noAnalysisRow += 1;
      continue;
    }

    if (lockStateByDate.get(date)) {
      results.push({ date, action: "already_locked" });
      summary.alreadyLocked += 1;
      continue;
    }

    if (dryRun) {
      results.push({ date, action: "would_lock" });
      summary.wouldLock += 1;
      continue;
    }

    const { error: updateError } = await client
      .from("historical_news_analyses")
      .update({ is_locked: true })
      .eq("date", date);

    if (updateError) throw new Error(updateError.message);
    results.push({ date, action: "locked" });
    summary.locked += 1;
  }

  return { summary, results };
}

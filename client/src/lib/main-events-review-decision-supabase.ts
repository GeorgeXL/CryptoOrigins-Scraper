import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveMainEventsReviewStatus, type MainEventsReviewDecision } from "@shared/leaf-agent-config";
import {
  applyVerificationDecision,
  normalizeMainEventsLeafKey,
  parseVerificationDates,
} from "@shared/main-events-review-build";
import {
  assertReviewDecisionRevertAllowed,
  lockDayOnReviewDecisionSupabase,
} from "@shared/main-events-verification-lock";

const RATE_LIMIT_PATTERN = /429|rate limit|too many requests/i;

type CacheRow = {
  normalized_leaf: string;
  verification_dates: unknown;
};

async function withSupabaseRetry<T>(run: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const retryable = RATE_LIMIT_PATTERN.test(lastError.message);
      if (!retryable || attempt === maxAttempts - 1) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError ?? new Error("Supabase request failed");
}

async function loadCacheRow(client: SupabaseClient, leaf: string): Promise<CacheRow | null> {
  const normalizedLeaf = normalizeMainEventsLeafKey(leaf);
  const { data, error } = await client
    .from("main_events_check_cache")
    .select("normalized_leaf, verification_dates")
    .eq("normalized_leaf", normalizedLeaf)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as CacheRow;
}

/** Persist accept/reject/pending on a leaf cache row and lock the day when final. */
export async function persistMainEventsReviewDecisionSupabase(
  client: SupabaseClient,
  opts: {
    leaf: string;
    date: string;
    decision: MainEventsReviewDecision;
  },
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  await withSupabaseRetry(async () => {
    const cache = await loadCacheRow(client, opts.leaf);
    if (!cache) {
      throw new Error("No cached main events list for this leaf");
    }

    const verification = parseVerificationDates(cache.verification_dates);
    const currentReviewStatus = resolveMainEventsReviewStatus(opts.date, verification);
    assertReviewDecisionRevertAllowed(currentReviewStatus, opts.decision);

    const nextVerification = applyVerificationDecision(verification, opts.date, opts.decision);

    const { error } = await client
      .from("main_events_check_cache")
      .update({
        verification_dates: nextVerification,
        updated_at: new Date().toISOString(),
      })
      .eq("normalized_leaf", cache.normalized_leaf);

    if (error) throw new Error(error.message);

    await lockDayOnReviewDecisionSupabase(client, opts.date, opts.decision);
  });
}

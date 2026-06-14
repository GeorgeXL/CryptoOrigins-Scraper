import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findAutoAcceptCandidates,
  summarizeAutoAcceptBatch,
  type AutoAcceptBatchSummary,
  type AutoAcceptLeafResult,
} from "./main-events-auto-accept";
import { parseCrossLeafAssignments } from "./main-events-cross-leaf-build";
import {
  applyVerificationDecision,
  buildMainEventsReviewQueue,
  parseVerificationDates,
  type CanonicalDateEntry,
  type ReviewAnalysisRow,
} from "./main-events-review-build";
import { lockDayOnVerificationStatusSupabase } from "./main-events-verification-lock";
import { MAIN_EVENTS_CROSS_LEAF_SENTINEL } from "./leaf-agent-config";

type CacheRow = {
  storyline_leaf: string;
  normalized_leaf: string;
  canonical_dates: CanonicalDateEntry[];
  verification_dates: unknown;
};

type AnalysisDbRow = {
  date: string;
  summary: string | null;
  topic_categories: unknown;
  is_locked: boolean | null;
};

function mapAnalysisRow(row: AnalysisDbRow): ReviewAnalysisRow {
  return {
    date: row.date,
    summary: row.summary,
    topicCategories: row.topic_categories,
    isLocked: row.is_locked,
  };
}

async function loadAnalysesForDates(client: SupabaseClient, dates: string[]): Promise<ReviewAnalysisRow[]> {
  if (dates.length === 0) return [];
  const chunkSize = 200;
  const rows: ReviewAnalysisRow[] = [];

  for (let i = 0; i < dates.length; i += chunkSize) {
    const chunk = dates.slice(i, i + chunkSize);
    const { data, error } = await client
      .from("historical_news_analyses")
      .select("date, summary, topic_categories, is_locked")
      .in("date", chunk);

    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as AnalysisDbRow[]) {
      rows.push(mapAnalysisRow(row));
    }
  }

  return rows;
}

async function fetchAllRows<T>(
  client: SupabaseClient,
  table: string,
  select: string,
  orderBy?: { column: string; ascending?: boolean },
): Promise<T[]> {
  const batchSize = 1000;
  const all: T[] = [];
  let from = 0;

  while (true) {
    let query = client.from(table).select(select).range(from, from + batchSize - 1);
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as T[];
    if (batch.length === 0) break;

    all.push(...batch);
    if (batch.length < batchSize) break;
    from += batchSize;
  }

  return all;
}

async function loadCrossLeafAssignments(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("main_events_check_cache")
    .select("notes")
    .eq("normalized_leaf", MAIN_EVENTS_CROSS_LEAF_SENTINEL)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.notes?.trim()) return new Map();

  try {
    const parsed = JSON.parse(data.notes) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const rows = Object.entries(parsed).map(([date, ownerLeaf]) => ({
      date,
      owner_leaf: String(ownerLeaf),
    }));
    return parseCrossLeafAssignments(rows);
  } catch {
    return new Map();
  }
}

async function loadCachedLeaves(client: SupabaseClient): Promise<CacheRow[]> {
  const rows = await fetchAllRows<CacheRow>(
    client,
    "main_events_check_cache",
    "storyline_leaf, normalized_leaf, canonical_dates, verification_dates",
    { column: "storyline_leaf", ascending: true },
  );

  return rows.filter((row) => row.storyline_leaf !== MAIN_EVENTS_CROSS_LEAF_SENTINEL);
}

async function applyLeafAutoAccepts(
  client: SupabaseClient,
  cache: CacheRow,
  candidateDates: string[],
): Promise<void> {
  if (candidateDates.length === 0) return;

  let verification = parseVerificationDates(cache.verification_dates);
  for (const date of candidateDates) {
    verification = applyVerificationDecision(verification, date, "accepted");
  }

  const { error } = await client
    .from("main_events_check_cache")
    .update({
      verification_dates: verification,
      updated_at: new Date().toISOString(),
    })
    .eq("normalized_leaf", cache.normalized_leaf);

  if (error) throw new Error(error.message);

  for (const date of candidateDates) {
    await lockDayOnVerificationStatusSupabase(client, date, "matched");
  }
}

/** Batch auto-accept for all cached storyline leaves (Supabase REST). */
export async function runAutoAcceptCertainMatches(
  client: SupabaseClient,
  opts?: { dryRun?: boolean },
): Promise<AutoAcceptBatchSummary> {
  const dryRun = opts?.dryRun ?? false;
  const [cacheRows, crossLeafAssignments] = await Promise.all([
    loadCachedLeaves(client),
    loadCrossLeafAssignments(client),
  ]);

  const leafResults: AutoAcceptLeafResult[] = [];

  for (const cache of cacheRows) {
    const canonical = Array.isArray(cache.canonical_dates) ? cache.canonical_dates : [];
    const dates = canonical.map((entry) => entry.date);
    const analyses = await loadAnalysesForDates(client, dates);
    const verification = parseVerificationDates(cache.verification_dates);

    const queue = buildMainEventsReviewQueue({
      leaf: cache.storyline_leaf,
      canonical,
      analyses,
      verification,
      crossLeafAssignments,
    });

    const candidates = findAutoAcceptCandidates(queue);
    const candidateDates = candidates.map((item) => item.date);

    if (!dryRun && candidateDates.length > 0) {
      await applyLeafAutoAccepts(client, cache, candidateDates);
    }

    leafResults.push({
      leaf: cache.storyline_leaf,
      candidates: candidateDates,
      accepted: dryRun ? 0 : candidateDates.length,
      skipped: queue.items.length - candidateDates.length,
    });
  }

  leafResults.sort((a, b) => a.leaf.localeCompare(b.leaf));
  return summarizeAutoAcceptBatch(leafResults, { dryRun });
}

import {
  applyVerificationDecision,
  buildMainEventsReviewQueue,
  countCorpusOnLeaf,
  normalizeMainEventsLeafKey,
  parseVerificationDates,
  type CanonicalDateEntry,
  type ReviewAnalysisRow,
} from "@shared/main-events-review-build";
import type {
  MainEventsReviewDecision,
  MainEventsReviewItem,
  MainEventsReviewQueue,
} from "@shared/leaf-agent-config";
import {
  assertGeminiMainEventApplyable,
  buildGeminiMainEventManualEntryInputs,
  geminiMainEventUsedPlaceholderSource,
} from "@shared/main-events-cross-leaf-apply";
import { TOPIC_HIERARCHY } from "@shared/topic-hierarchy";

import { loadCrossLeafAssignmentsSupabase } from "@/lib/main-events-cross-leaf-supabase";
import { persistMainEventsReviewDecisionSupabase } from "@/lib/main-events-review-decision-supabase";
import { saveManualDayEntrySupabase } from "@/lib/manual-day-entry-supabase";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabaseRows } from "@/lib/supabaseBatch";

type CacheRow = {
  storyline_leaf: string;
  normalized_leaf: string;
  canonical_dates: CanonicalDateEntry[];
  verification_dates: unknown;
  fetched_at: string | null;
  gemini_model: string | null;
  cache_version: string | null;
};

type AnalysisDbRow = {
  date: string;
  summary: string | null;
  topic_categories: unknown;
  is_locked: boolean | null;
};

export type MainEventsLeafStats = {
  leaf: string;
  corpusCount: number;
  lockedCount: number;
  geminiCached: boolean;
  canonicalCount: number;
  fetchedAt: string | null;
};

function assertSupabase() {
  if (!supabase) throw new Error("Supabase not configured — check client/.env");
  return supabase;
}

function mapAnalysisRow(row: AnalysisDbRow): ReviewAnalysisRow {
  return {
    date: row.date,
    summary: row.summary,
    topicCategories: row.topic_categories,
    isLocked: row.is_locked,
  };
}

async function loadCacheRow(leaf: string): Promise<CacheRow | null> {
  const client = assertSupabase();
  const normalizedLeaf = normalizeMainEventsLeafKey(leaf);
  const { data, error } = await client
    .from("main_events_check_cache")
    .select(
      "storyline_leaf, normalized_leaf, canonical_dates, verification_dates, fetched_at, gemini_model, cache_version",
    )
    .eq("normalized_leaf", normalizedLeaf)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as CacheRow;
}

async function loadAnalysesForDates(dates: string[]): Promise<ReviewAnalysisRow[]> {
  if (dates.length === 0) return [];
  const client = assertSupabase();
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

export async function fetchMainEventsLeafStatsSupabase(leaf: string): Promise<MainEventsLeafStats> {
  const cache = await loadCacheRow(leaf);
  const rows = await fetchAllSupabaseRows<AnalysisDbRow>(
    "historical_news_analyses",
    "date, summary, topic_categories, is_locked",
  );
  const { corpusCount, lockedCount } = countCorpusOnLeaf(rows.map(mapAnalysisRow), leaf);

  return {
    leaf,
    corpusCount,
    lockedCount,
    geminiCached: Boolean(cache),
    canonicalCount: Array.isArray(cache?.canonical_dates) ? cache.canonical_dates.length : 0,
    fetchedAt: cache?.fetched_at ?? null,
  };
}

export async function fetchMainEventsReviewQueueSupabase(leaf: string): Promise<MainEventsReviewQueue> {
  const cache = await loadCacheRow(leaf);
  if (!cache) {
    throw new Error("No cached main events list for this leaf — use Prepare all leaves (Advanced) first");
  }

  const canonical = Array.isArray(cache.canonical_dates) ? cache.canonical_dates : [];
  const dates = canonical.map((entry) => entry.date);
  const [analyses, crossLeafAssignments] = await Promise.all([
    loadAnalysesForDates(dates),
    loadCrossLeafAssignmentsSupabase(),
  ]);
  const verification = parseVerificationDates(cache.verification_dates);

  return buildMainEventsReviewQueue({
    leaf: cache.storyline_leaf || leaf,
    canonical,
    analyses,
    verification,
    crossLeafAssignments,
  });
}

export async function setMainEventsReviewDecisionSupabase(opts: {
  leaf: string;
  date: string;
  decision: MainEventsReviewDecision;
  /** When false, persist only — caller updates React Query cache optimistically. */
  refetchQueue?: boolean;
}): Promise<MainEventsReviewQueue | void> {
  const client = assertSupabase();
  await persistMainEventsReviewDecisionSupabase(client, opts);
  if (opts.refetchQueue === false) return;
  return fetchMainEventsReviewQueueSupabase(opts.leaf);
}

export type ApplyReviewGeminiEventResult = {
  queue: MainEventsReviewQueue;
  date: string;
  leaf: string;
  leafLabel: string;
  usedPlaceholderSource: boolean;
};

export async function applyReviewGeminiEventSupabase(opts: {
  leaf: string;
  date: string;
  item: Pick<MainEventsReviewItem, "date" | "event" | "sourceUrl" | "isLocked">;
}): Promise<ApplyReviewGeminiEventResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }
  if (!opts.leaf.trim()) {
    throw new Error("Leaf is required");
  }

  assertGeminiMainEventApplyable(opts.item, "applying this Gemini event");

  const manualInputs = buildGeminiMainEventManualEntryInputs({
    date: opts.date,
    ownerLeaf: opts.leaf,
    event: opts.item.event,
    sourceUrl: opts.item.sourceUrl,
  });

  await saveManualDayEntrySupabase({
    date: opts.date,
    summary: manualInputs.summary,
    sourceUrl: manualInputs.sourceUrl,
    topic: manualInputs.topic,
  });

  await setMainEventsReviewDecisionSupabase({
    leaf: opts.leaf,
    date: opts.date,
    decision: "accepted",
    refetchQueue: false,
  });
  const queue = await fetchMainEventsReviewQueueSupabase(opts.leaf);

  return {
    queue,
    date: opts.date,
    leaf: opts.leaf.trim(),
    leafLabel: queue.leafLabel,
    usedPlaceholderSource: geminiMainEventUsedPlaceholderSource(opts.item.sourceUrl),
  };
}

export async function fetchMainEventsCacheOverviewSupabase(): Promise<{
  totalLeaves: number;
  cachedCount: number;
  uncachedLeaves: string[];
}> {
  const allLeaves = TOPIC_HIERARCHY.flatMap((group) => group.leaves);
  const client = assertSupabase();
  const { data, error } = await client.from("main_events_check_cache").select("normalized_leaf");
  if (error) throw new Error(error.message);

  const cached = new Set((data ?? []).map((row) => row.normalized_leaf as string));
  const uncachedLeaves = allLeaves.filter((leaf) => !cached.has(normalizeMainEventsLeafKey(leaf)));

  return {
    totalLeaves: allLeaves.length,
    cachedCount: allLeaves.length - uncachedLeaves.length,
    uncachedLeaves,
  };
}

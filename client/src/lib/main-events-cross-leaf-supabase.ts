import {
  assertCrossLeafDbEntryKeepable,
  assertCrossLeafProposalApplyable,
  buildCrossLeafManualEntryInputs,
  findCrossLeafProposal,
  geminiMainEventUsedPlaceholderSource,
} from "@shared/main-events-cross-leaf-apply";
import {
  buildCrossLeafDuplicateQueue,
  parseCrossLeafAssignments,
  type CrossLeafCacheRow,
} from "@shared/main-events-cross-leaf-build";
import {
  MAIN_EVENTS_CROSS_LEAF_CACHE_VERSION,
  MAIN_EVENTS_CROSS_LEAF_SENTINEL,
} from "@shared/leaf-agent-config";
import {
  normalizeMainEventsLeafKey,
  type CanonicalDateEntry,
  type ReviewAnalysisRow,
} from "@shared/main-events-review-build";
import { lockDayOnReviewDecisionSupabase } from "@shared/main-events-verification-lock";
import type {
  MainEventsCrossLeafDuplicate,
  MainEventsCrossLeafQueue,
} from "@shared/leaf-agent-config";

import { saveManualDayEntrySupabase } from "@/lib/manual-day-entry-supabase";
import { persistMainEventsReviewDecisionSupabase } from "@/lib/main-events-review-decision-supabase";
import { supabase } from "@/lib/supabase";
import { fetchAllSupabaseRows } from "@/lib/supabaseBatch";

type CacheRow = {
  storyline_leaf: string;
  normalized_leaf: string;
  canonical_dates: CanonicalDateEntry[];
  verification_dates: unknown;
  notes?: string | null;
};

type AnalysisDbRow = {
  date: string;
  summary: string | null;
  topic_categories: unknown;
  is_locked: boolean | null;
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

function parseAssignmentsNotes(notes: string | null | undefined): Map<string, string> {
  if (!notes?.trim()) return new Map();
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
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

export async function loadCrossLeafAssignmentsSupabase(): Promise<Map<string, string>> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("main_events_check_cache")
    .select("notes")
    .eq("normalized_leaf", MAIN_EVENTS_CROSS_LEAF_SENTINEL)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return parseAssignmentsNotes(data?.notes);
}

async function saveCrossLeafAssignmentsSupabase(assignments: Map<string, string>): Promise<void> {
  const client = assertSupabase();
  const notes = JSON.stringify(
    Object.fromEntries([...assignments.entries()].sort(([a], [b]) => a.localeCompare(b))),
  );

  const { error } = await client.from("main_events_check_cache").upsert(
    {
      storyline_leaf: MAIN_EVENTS_CROSS_LEAF_SENTINEL,
      normalized_leaf: MAIN_EVENTS_CROSS_LEAF_SENTINEL,
      gemini_model: "operator",
      cache_version: MAIN_EVENTS_CROSS_LEAF_CACHE_VERSION,
      canonical_dates: [],
      skipped_canonical: [],
      verification_dates: { matched: [], pending: [], rejected: [] },
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "normalized_leaf" },
  );

  if (error) throw new Error(error.message);
}

async function loadAllCacheRows(): Promise<CrossLeafCacheRow[]> {
  const rows = await fetchAllSupabaseRows<CacheRow>(
    "main_events_check_cache",
    "storyline_leaf, canonical_dates",
    { orderBy: { column: "storyline_leaf", ascending: true } },
  );

  return rows
    .filter((row) => row.storyline_leaf !== MAIN_EVENTS_CROSS_LEAF_SENTINEL)
    .map((row) => ({
      leaf: row.storyline_leaf,
      canonical: Array.isArray(row.canonical_dates) ? row.canonical_dates : [],
    }));
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

export async function fetchMainEventsCrossLeafQueueSupabase(): Promise<MainEventsCrossLeafQueue> {
  const [cacheRows, assignments] = await Promise.all([
    loadAllCacheRows(),
    loadCrossLeafAssignmentsSupabase(),
  ]);

  const duplicateDates = new Set<string>();
  const countByDate = new Map<string, number>();
  for (const row of cacheRows) {
    const seenOnRow = new Set<string>();
    for (const entry of row.canonical) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || seenOnRow.has(entry.date)) continue;
      seenOnRow.add(entry.date);
      countByDate.set(entry.date, (countByDate.get(entry.date) ?? 0) + 1);
    }
  }
  for (const [date, count] of countByDate.entries()) {
    if (count >= 2 && !assignments.has(date)) duplicateDates.add(date);
  }

  const analyses = await loadAnalysesForDates([...duplicateDates]);

  return buildCrossLeafDuplicateQueue({
    cacheRows,
    assignments,
    analyses,
  });
}

export type ApplyCrossLeafProposalResult = {
  queue: MainEventsCrossLeafQueue;
  date: string;
  ownerLeaf: string;
  ownerLeafLabel: string;
  usedPlaceholderSource: boolean;
};

export async function applyCrossLeafProposalSupabase(opts: {
  date: string;
  ownerLeaf: string;
  item: { date: string; proposals: MainEventsCrossLeafDuplicate["proposals"]; isLocked?: boolean };
}): Promise<ApplyCrossLeafProposalResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }
  if (!opts.ownerLeaf.trim()) {
    throw new Error("Owner leaf is required");
  }

  assertCrossLeafProposalApplyable(
    { date: opts.item.date, proposals: opts.item.proposals, isLocked: opts.item.isLocked },
    opts.ownerLeaf,
  );

  const proposal = findCrossLeafProposal(opts.item, opts.ownerLeaf);
  if (!proposal) {
    throw new Error(`"${opts.ownerLeaf}" does not propose ${opts.date} as a main event`);
  }

  const manualInputs = buildCrossLeafManualEntryInputs({
    date: opts.date,
    ownerLeaf: opts.ownerLeaf,
    proposal,
  });

  await saveManualDayEntrySupabase({
    date: opts.date,
    summary: manualInputs.summary,
    sourceUrl: manualInputs.sourceUrl,
    topic: manualInputs.topic,
  });

  await assignMainEventsCrossLeafOwnerSupabase({
    date: opts.date,
    ownerLeaf: opts.ownerLeaf,
  });

  await persistMainEventsReviewDecisionSupabase(assertSupabase(), {
    leaf: opts.ownerLeaf,
    date: opts.date,
    decision: "accepted",
  });

  const queue = await fetchMainEventsCrossLeafQueueSupabase();

  return {
    queue,
    date: opts.date,
    ownerLeaf: opts.ownerLeaf.trim(),
    ownerLeafLabel: proposal.leafLabel,
    usedPlaceholderSource: geminiMainEventUsedPlaceholderSource(proposal.sourceUrl),
  };
}

export async function assignMainEventsCrossLeafOwnerSupabase(opts: {
  date: string;
  ownerLeaf: string;
  /** When false, allow assigning a leaf from the database tag even if Gemini did not propose it. */
  requireGeminiProposal?: boolean;
}): Promise<MainEventsCrossLeafQueue> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }
  if (!opts.ownerLeaf.trim()) {
    throw new Error("Owner leaf is required");
  }

  const requireGeminiProposal = opts.requireGeminiProposal ?? true;

  if (requireGeminiProposal) {
    const cacheRows = await loadAllCacheRows();
    const normalizedOwner = normalizeMainEventsLeafKey(opts.ownerLeaf);
    const hasProposal = cacheRows.some(
      (row) =>
        normalizeMainEventsLeafKey(row.leaf) === normalizedOwner &&
        row.canonical.some((entry) => entry.date === opts.date),
    );
    if (!hasProposal) {
      throw new Error(`"${opts.ownerLeaf}" does not propose ${opts.date} as a main event`);
    }
  }

  const assignments = await loadCrossLeafAssignmentsSupabase();
  assignments.set(opts.date, opts.ownerLeaf.trim());
  await saveCrossLeafAssignmentsSupabase(assignments);

  return fetchMainEventsCrossLeafQueueSupabase();
}

export type KeepCrossLeafDatabaseEntryResult = {
  queue: MainEventsCrossLeafQueue;
  date: string;
  ownerLeaf: string;
  ownerLeafLabel: string;
};

export async function keepCrossLeafDatabaseEntrySupabase(opts: {
  date: string;
  item: MainEventsCrossLeafDuplicate;
}): Promise<KeepCrossLeafDatabaseEntryResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  assertCrossLeafDbEntryKeepable(opts.item);

  const ownerLeaf = opts.item.dbOwnerLeaf!.trim();
  await assignMainEventsCrossLeafOwnerSupabase({
    date: opts.date,
    ownerLeaf,
    requireGeminiProposal: false,
  });

  try {
    await persistMainEventsReviewDecisionSupabase(assertSupabase(), {
      leaf: ownerLeaf,
      date: opts.date,
      decision: "accepted",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("No cached main events list")) {
      throw error;
    }
    await lockDayOnReviewDecisionSupabase(assertSupabase(), opts.date, "accepted");
  }

  const queue = await fetchMainEventsCrossLeafQueueSupabase();

  return {
    queue,
    date: opts.date,
    ownerLeaf,
    ownerLeafLabel: opts.item.dbOwnerLeafLabel ?? ownerLeaf,
  };
}

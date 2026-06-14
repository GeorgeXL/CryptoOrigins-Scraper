import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildManualAnalysisDbRow,
  buildManualArticle,
  normalizeManualSourceUrl,
  validateManualDayEntryInputs,
} from "./manual-day-entry-build";

export const MANUAL_ENTRY_RLS_BLOCKED_MESSAGE =
  "Database write blocked by Supabase RLS. Run migration " +
  "supabase/migrations/20260613120000_historical_news_analyses_anon_write.sql " +
  "in the Supabase SQL editor, or add SUPABASE_SERVICE_ROLE_KEY to .env for server fallback.";

function isRlsWriteBlockedSignal(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST116" ||
    error.code === "42501" ||
    message.includes("row-level security") ||
    message.includes("Cannot coerce the result to a single JSON object")
  );
}

export function formatManualEntryWriteError(error: { message?: string; code?: string } | null): string {
  if (isRlsWriteBlockedSignal(error)) return MANUAL_ENTRY_RLS_BLOCKED_MESSAGE;
  if (!error?.message) return "Failed to save manual entry";
  return error.message;
}

async function assertDayUnlocked(
  client: SupabaseClient,
  date: string,
): Promise<{ id?: string } | null> {
  const { data, error } = await client
    .from("historical_news_analyses")
    .select("id, is_locked")
    .eq("date", date)
    .maybeSingle();

  if (error) throw new Error(formatManualEntryWriteError(error));
  if (data?.is_locked) {
    throw new Error(`Day ${date} is locked by operator`);
  }
  return data;
}

async function syncPageTopicsForLabel(
  client: SupabaseClient,
  analysisId: string,
  topicLabel: string,
): Promise<string[]> {
  const { data: allTopics, error: topicsErr } = await client.from("topics").select("id, name");
  if (topicsErr) throw new Error(formatManualEntryWriteError(topicsErr));

  const normalized = topicLabel.trim().toLowerCase();
  const topic = (allTopics ?? []).find((row) => row.name.trim().toLowerCase() === normalized);

  const { error: deleteErr } = await client.from("page_topics").delete().eq("analysis_id", analysisId);
  if (deleteErr) throw new Error(formatManualEntryWriteError(deleteErr));

  if (!topic) return [];

  const { error: insertErr } = await client.from("page_topics").insert({
    analysis_id: analysisId,
    topic_id: topic.id,
    is_primary: true,
  });
  if (insertErr) throw new Error(formatManualEntryWriteError(insertErr));

  return [topic.name];
}

export async function saveManualDayEntryWithSupabase(
  client: SupabaseClient,
  opts: {
    date: string;
    summary: string;
    sourceUrl: string;
    topic: string | null;
    title?: string;
  },
): Promise<{ success: boolean; date: string; topics: string[]; sourceUrl: string; summary: string }> {
  const { summary, topicLabel } = validateManualDayEntryInputs(opts);
  const existing = await assertDayUnlocked(client, opts.date);

  const sourceUrl = normalizeManualSourceUrl(opts.sourceUrl);
  const manualArticle = buildManualArticle({
    date: opts.date,
    sourceUrl,
    summary,
    title: opts.title,
  });
  const linkedTopics = [topicLabel];
  const dbRow = buildManualAnalysisDbRow({
    date: opts.date,
    summary,
    sourceUrl,
    topicCategories: linkedTopics,
    manualArticle,
  });

  let analysisId: string;

  if (existing?.id) {
    const { data, error } = await client
      .from("historical_news_analyses")
      .update(dbRow)
      .eq("date", opts.date)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(formatManualEntryWriteError(error));
    if (!data?.id) throw new Error(formatManualEntryWriteError({ code: "PGRST116" }));
    analysisId = data.id;
  } else {
    const { data, error } = await client
      .from("historical_news_analyses")
      .insert(dbRow)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(formatManualEntryWriteError(error));
    if (!data?.id) throw new Error(formatManualEntryWriteError({ code: "PGRST116" }));
    analysisId = data.id;
  }

  const syncedTopics = await syncPageTopicsForLabel(client, analysisId, topicLabel);
  const topicCategories = syncedTopics.length > 0 ? syncedTopics : linkedTopics;
  if (syncedTopics.length > 0) {
    const { error } = await client
      .from("historical_news_analyses")
      .update({ topic_categories: topicCategories })
      .eq("id", analysisId);
    if (error) throw new Error(formatManualEntryWriteError(error));
  }

  return {
    success: true,
    date: opts.date,
    summary,
    sourceUrl,
    topics: topicCategories,
  };
}

export function isManualEntryWriteBlockedError(message: string): boolean {
  return (
    message.includes(MANUAL_ENTRY_RLS_BLOCKED_MESSAGE) ||
    message.includes("Database write blocked by Supabase RLS") ||
    message.includes("row-level security") ||
    message.includes("Cannot coerce the result to a single JSON object")
  );
}

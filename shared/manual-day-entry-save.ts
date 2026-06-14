import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildManualAnalysisDbRow,
  buildManualArticle,
  normalizeManualSourceUrl,
  validateManualDayEntryInputs,
} from "./manual-day-entry-build";

export const MANUAL_ENTRY_RLS_BLOCKED_MESSAGE =
  "Database write blocked by Supabase RLS. Apply pending migrations in supabase/migrations/ " +
  "(especially 20260613120000_historical_news_analyses_anon_write.sql and " +
  "20260614250000_enable_rls_all_tables.sql), or add SUPABASE_SERVICE_ROLE_KEY to .env for server fallback.";

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
  const topicCategories = [topicLabel];
  const dbRow = buildManualAnalysisDbRow({
    date: opts.date,
    summary,
    sourceUrl,
    topicCategories,
    manualArticle,
  });

  if (existing?.id) {
    const { error } = await client
      .from("historical_news_analyses")
      .update(dbRow)
      .eq("date", opts.date);
    if (error) throw new Error(formatManualEntryWriteError(error));
  } else {
    const { error } = await client
      .from("historical_news_analyses")
      .insert(dbRow);
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

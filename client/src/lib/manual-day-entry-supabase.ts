import {
  isManualEntryWriteBlockedError,
  MANUAL_ENTRY_RLS_BLOCKED_MESSAGE,
  saveManualDayEntryWithSupabase,
} from "@shared/manual-day-entry-save";

import { supabase } from "@/lib/supabase";

function assertSupabase() {
  if (!supabase) throw new Error("Supabase not configured — check client/.env");
  return supabase;
}

function formatManualEntryApiFallbackError(opts: {
  status: number;
  payloadError?: string;
  networkMessage?: string;
}): string {
  if (opts.networkMessage) {
    return (
      `Server manual-entry API unreachable (${opts.networkMessage}). ` +
      "Apply supabase/migrations/20260613120000_historical_news_analyses_anon_write.sql for client-side saves, " +
      "or add SUPABASE_SERVICE_ROLE_KEY to .env for server fallback."
    );
  }
  if (typeof opts.payloadError === "string" && opts.payloadError.trim()) {
    return opts.payloadError;
  }
  return `Manual entry API failed (${opts.status}). ${MANUAL_ENTRY_RLS_BLOCKED_MESSAGE}`;
}

async function saveManualDayEntryViaApi(opts: {
  date: string;
  summary: string;
  sourceUrl: string;
  topic: string | null;
  title?: string;
}): Promise<{ success: boolean; date: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/analysis/date/${encodeURIComponent(opts.date)}/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: opts.summary,
        sourceUrl: opts.sourceUrl,
        topic: opts.topic,
        title: opts.title,
      }),
    });
  } catch (error) {
    const networkMessage = error instanceof Error ? error.message : "network error";
    throw new Error(formatManualEntryApiFallbackError({ status: 0, networkMessage }));
  }

  let payload: { error?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(
      formatManualEntryApiFallbackError({ status: res.status, payloadError: payload.error }),
    );
  }

  return payload as { success: boolean; date: string };
}

export async function saveManualDayEntrySupabase(opts: {
  date: string;
  summary: string;
  sourceUrl: string;
  topic: string | null;
  title?: string;
}): Promise<{ success: boolean; date: string }> {
  try {
    const result = await saveManualDayEntryWithSupabase(assertSupabase(), opts);
    return { success: result.success, date: result.date };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save manual entry";
    if (isManualEntryWriteBlockedError(message)) {
      return saveManualDayEntryViaApi(opts);
    }
    throw error;
  }
}

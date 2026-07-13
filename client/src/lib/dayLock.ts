import { analysisEligibleForDayLock } from "@shared/storyline-topic-eligibility";
import { supabase } from "@/lib/supabase";

export async function setDayLocked(
  date: string,
  locked: boolean,
): Promise<{ success: boolean; isLocked: boolean }> {
  // Prefer Supabase HTTPS — local Node → Postgres often fails (IPv6 EHOSTUNREACH).
  if (supabase) {
    if (locked) {
      const { data: row, error: readError } = await supabase
        .from("historical_news_analyses")
        .select("is_locked, topic_categories")
        .eq("date", date)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!row) throw new Error(`Analysis not found for date: ${date}`);
      if (!analysisEligibleForDayLock(row.topic_categories)) {
        if (row.is_locked) {
          const { error: unlockError } = await supabase
            .from("historical_news_analyses")
            .update({ is_locked: false })
            .eq("date", date);
          if (unlockError) throw new Error(unlockError.message);
          return { success: true, isLocked: false };
        }
        return { success: true, isLocked: false };
      }
    }

    const { data, error } = await supabase
      .from("historical_news_analyses")
      .update({ is_locked: locked })
      .eq("date", date)
      .select("is_locked")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Analysis not found for date: ${date}`);
    return { success: true, isLocked: Boolean(data.is_locked) };
  }

  const res = await fetch(`/api/analysis/date/${date}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ locked }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `Failed to ${locked ? "lock" : "unlock"} day`);
  }
  return { success: true, isLocked: Boolean(payload.isLocked) };
}

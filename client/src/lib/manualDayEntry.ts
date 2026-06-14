import { saveManualDayEntrySupabase } from "@/lib/manual-day-entry-supabase";

export async function saveManualDayEntry(opts: {
  date: string;
  summary: string;
  sourceUrl: string;
  topic: string | null;
  title?: string;
}): Promise<{ success: boolean; date: string }> {
  return saveManualDayEntrySupabase(opts);
}

export function isManualSourceUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

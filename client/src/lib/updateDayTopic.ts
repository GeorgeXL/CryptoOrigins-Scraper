/** Update a day's storyline topic via the API (Supabase anon RLS cannot update analyses). */
export async function updateDayTopic(date: string, topic: string | null): Promise<string[]> {
  const res = await fetch(`/api/analysis/date/${encodeURIComponent(date)}/topic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Failed to update topic");
  }

  return Array.isArray(payload.topics) ? payload.topics : topic ? [topic] : [];
}

export async function saveManualDayEntry(opts: {
  date: string;
  summary: string;
  sourceUrl: string;
  topic: string | null;
  title?: string;
}): Promise<{ success: boolean; date: string }> {
  const res = await fetch(`/api/analysis/date/${encodeURIComponent(opts.date)}/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: opts.summary,
      sourceUrl: opts.sourceUrl,
      topic: opts.topic,
      title: opts.title,
    }),
  });

  let payload: { error?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Failed to save manual entry");
  }

  return payload as { success: boolean; date: string };
}

export function isManualSourceUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value.trim());
}

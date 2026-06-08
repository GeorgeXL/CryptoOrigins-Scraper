export async function setDayLocked(date: string, locked: boolean): Promise<{ success: boolean; isLocked: boolean }> {
  const res = await fetch(`/api/analysis/date/${date}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ locked }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to ${locked ? "lock" : "unlock"} day`);
  }
  return { success: true, isLocked: Boolean(data.isLocked) };
}

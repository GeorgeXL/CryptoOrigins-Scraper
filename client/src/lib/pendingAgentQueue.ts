export type PendingAgentQueueItem = {
  id: string;
  phase: string;
  queue: string;
  label: string;
  priority: number;
  createdAt: string | null;
};

export async function fetchPendingAgentQueueByDates(
  dates: string[],
): Promise<Record<string, PendingAgentQueueItem[]>> {
  if (dates.length === 0) return {};

  const res = await fetch("/api/analysis/pending-agent-queue/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dates }),
  });

  if (!res.ok) return {};

  const data = (await res.json()) as { byDate?: Record<string, PendingAgentQueueItem[]> };
  return data.byDate ?? {};
}

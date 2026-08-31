export type PendingAgentQueueItem = {
  id: string;
  phase: string;
  queue: string;
  label: string;
  priority: number;
  createdAt: string | null;
};

const PENDING_QUEUE_BATCH_SIZE = 200;

export function datesWithPendingAgentQueue(
  dates: string[],
  byDate: Record<string, PendingAgentQueueItem[]>,
): Set<string> {
  return new Set(dates.filter((date) => (byDate[date]?.length ?? 0) > 0));
}

export function formatPendingAgentQueueSkipLabel(items: PendingAgentQueueItem[]): string {
  if (items.length === 0) {
    return "Skipped — already pending in Agents";
  }
  const primary = items[0]!;
  const label = primary.label || primary.phase || "pending review";
  const extra = items.length > 1 ? ` (+${items.length - 1} more)` : "";
  return `Skipped — already pending in Agents (${label}${extra})`;
}

export async function fetchPendingAgentQueueByDates(
  dates: string[],
): Promise<Record<string, PendingAgentQueueItem[]>> {
  if (dates.length === 0) return {};

  const uniqueDates = [...new Set(dates)];
  const byDate: Record<string, PendingAgentQueueItem[]> = {};

  for (let offset = 0; offset < uniqueDates.length; offset += PENDING_QUEUE_BATCH_SIZE) {
    const chunk = uniqueDates.slice(offset, offset + PENDING_QUEUE_BATCH_SIZE);
    const res = await fetch("/api/analysis/pending-agent-queue/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ dates: chunk }),
    });

    if (!res.ok) continue;

    const data = (await res.json()) as { byDate?: Record<string, PendingAgentQueueItem[]> };
    Object.assign(byDate, data.byDate ?? {});
  }

  return byDate;
}

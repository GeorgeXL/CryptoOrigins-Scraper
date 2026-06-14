export type EmptySummaryEntryKind = "empty-summary" | "missing-day";

export type EmptySummaryEntry = {
  date: string;
  summary: string;
  kind: EmptySummaryEntryKind;
};

function parseIsoUtc(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

function addDaysIso(date: string, delta: number): string {
  const next = new Date(parseIsoUtc(date));
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

/** Build empty-summary / missing-day entries for the quality-check API. */
export function buildEmptySummaryEntries(
  analyses: { date: string; summary: string | null | undefined }[],
  minValidDate = "2009-01-03",
): EmptySummaryEntry[] {
  const existingDates = new Set<string>();
  const emptyEntries: EmptySummaryEntry[] = [];

  for (const a of analyses) {
    existingDates.add(a.date);
    const isEmpty = !a.summary || a.summary.trim() === "";
    if (isEmpty) {
      emptyEntries.push({ date: a.date, summary: a.summary || "", kind: "empty-summary" });
    }
  }

  const sortedDates = Array.from(existingDates).sort();
  if (sortedDates.length > 0) {
    const maxDate = sortedDates[sortedDates.length - 1]!;
    let cursor = minValidDate;
    while (cursor <= maxDate) {
      if (!existingDates.has(cursor)) {
        emptyEntries.push({ date: cursor, summary: "", kind: "missing-day" });
      }
      cursor = addDaysIso(cursor, 1);
    }
  }

  return emptyEntries;
}

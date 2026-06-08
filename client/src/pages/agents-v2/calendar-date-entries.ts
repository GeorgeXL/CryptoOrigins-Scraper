import type { AgentsV2QueueRow } from "@/pages/agents-v2/map-review-queue";

export type CalendarDateEntry = {
  date: string;
  summary: string;
  tags: string[];
  topics: string[];
};

export function collectCalendarDateEntries(rows: AgentsV2QueueRow[]): CalendarDateEntry[] {
  const byDate = new Map<string, CalendarDateEntry>();

  const upsert = (date: string, entry: Omit<CalendarDateEntry, "date">) => {
    const existing = byDate.get(date);
    if (existing) {
      if (!existing.summary && entry.summary) existing.summary = entry.summary;
      if (!existing.tags.length && entry.tags.length) existing.tags = entry.tags;
      if (!existing.topics.length && entry.topics.length) existing.topics = entry.topics;
      return;
    }
    byDate.set(date, { date, ...entry });
  };

  for (const row of rows) {
    const item = row.item;
    const pair = item.calendarReciprocalPair;
    if (pair) {
      upsert(pair.sideA.date, {
        summary: pair.sideA.summary,
        tags: pair.sideA.tags,
        topics: pair.sideA.topics,
      });
      upsert(pair.sideB.date, {
        summary: pair.sideB.summary,
        tags: pair.sideB.tags,
        topics: pair.sideB.topics,
      });
      continue;
    }

    const cd = item.calendarDecision;
    if (!cd) continue;

    upsert(cd.currentDate, {
      summary: item.daySummary?.trim() ?? "",
      tags: item.dayTags ?? [],
      topics: item.dayTopicCategories ?? [],
    });
    upsert(cd.expectedDate, {
      summary: cd.expectedDateSummary?.trim() ?? "",
      tags: cd.expectedDateTags ?? [],
      topics: cd.expectedDateTopics ?? [],
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function calendarFlagReasonFromRows(rows: AgentsV2QueueRow[]): string | null {
  for (const row of rows) {
    const pair = row.item.calendarReciprocalPair;
    if (pair) {
      return `Same story flagged on ${pair.sideA.date} and ${pair.sideB.date}. ${pair.chronology.rationale}`;
    }
    const cd = row.item.calendarDecision;
    if (cd?.reason) return cd.reason;
    if (cd?.chronologyHint?.rationale) return cd.chronologyHint.rationale;
  }
  return null;
}

/** Ensure at least one date stays on the timeline after Google suggestions. */
export function capCalendarRemoveDates(allDates: string[], removeDates: string[]): string[] {
  const allowed = new Set(allDates);
  const capped = [...new Set(removeDates.filter((date) => allowed.has(date)))].sort();
  if (capped.length >= allDates.length) {
    const keep = allDates[0];
    return capped.filter((date) => date !== keep);
  }
  return capped;
}

/**
 * Known / manual / milestone days — no Exa article required, but summary must match the event.
 */
import { inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  canonicalMilestones,
  historicalNewsAnalyses,
  manualNewsEntries,
} from "@shared/schema";
import { isValidPipelineTopArticleId } from "./editorial-quality";

export type KnownEventKind =
  | "milestone"
  | "manual_override"
  | "manual_entry"
  | "known_marker"
  | "manual_marker";

export type KnownEventContext = {
  isKnownEvent: boolean;
  kind: KnownEventKind | null;
  label: string | null;
  description: string | null;
  /** Short operator-facing explanation for review UI. */
  explanation: string | null;
  /** Text the Summary Agent uses instead of article title/snippet. */
  referenceText: string | null;
  hasArticleWinner: boolean;
};

function markerKind(topArticleId: string | null | undefined): KnownEventKind | null {
  const id = String(topArticleId ?? "").trim();
  if (id.startsWith("known-")) return "known_marker";
  if (id.startsWith("manual-")) return "manual_marker";
  return null;
}

function buildExplanation(kind: KnownEventKind, label: string | null): string {
  switch (kind) {
    case "milestone":
      return label
        ? `Canonical milestone day (${label}). No news article is required — the pipeline checks that your summary accurately describes this known event on the calendar.`
        : "Canonical milestone day. No news article is required — the pipeline validates the summary against the known event.";
    case "manual_override":
      return "Manual override day. You curated this date without a fetched article — checks focus on summary accuracy, length, topic, and tags.";
    case "manual_entry":
      return label
        ? `Manual entry (${label}). The summary should reflect this curated event, not an Exa article pick.`
        : "Manual entry day. The summary should reflect your curated event, not an Exa article pick.";
    case "known_marker":
      return "Known-event marker on top_article_id. This slot is a curated historical fact — article fetch and redo_summary are not expected.";
    case "manual_marker":
      return "Manual-event marker on top_article_id. This slot is operator-curated — validate summary and taxonomy, not article pick.";
  }
}

export function buildKnownEventContext(input: {
  topArticleId?: string | null;
  isManualOverride?: boolean | null;
  manualEntryCount?: number;
  manualEntryTitle?: string | null;
  manualEntryDescription?: string | null;
  milestone?: { label: string; description?: string | null; slug?: string } | null;
}): KnownEventContext {
  const hasArticleWinner = isValidPipelineTopArticleId(input.topArticleId) && !markerKind(input.topArticleId);
  const marker = markerKind(input.topArticleId);

  let kind: KnownEventKind | null = null;
  let label: string | null = null;
  let description: string | null = null;

  const milestone = input.milestone ?? null;
  const manualTitle = input.manualEntryTitle ?? null;
  const manualDescription = input.manualEntryDescription ?? null;

  if (input.isManualOverride) {
    kind = "manual_override";
    label = manualTitle ?? milestone?.label ?? null;
    description = manualDescription ?? milestone?.description ?? null;
  } else if (Number(input.manualEntryCount ?? 0) > 0) {
    kind = "manual_entry";
    label = manualTitle;
    description = manualDescription;
  } else if (milestone) {
    kind = "milestone";
    label = milestone.label;
    description = milestone.description ?? null;
  } else if (marker) {
    kind = marker;
    label = manualTitle;
    description = manualDescription;
  }

  const isKnownEvent = kind != null;
  const referenceParts = [label, description].filter((x) => typeof x === "string" && x.trim()).map((x) => x!.trim());

  return {
    isKnownEvent,
    kind,
    label,
    description,
    explanation: kind ? buildExplanation(kind, label) : null,
    referenceText: referenceParts.length > 0 ? referenceParts.join(" — ") : label,
    hasArticleWinner,
  };
}

export async function resolveKnownEventContext(date: string): Promise<KnownEventContext> {
  const batch = await resolveKnownEventContextBatch([date]);
  return batch.get(date) ?? buildKnownEventContext({});
}

function normalizeContextDate(d: unknown): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d.length >= 10 ? d.slice(0, 10) : null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

/** Batched known-event lookup — 2–3 queries total instead of 3×N. */
export async function resolveKnownEventContextBatch(
  dates: string[],
  preloadedAnalyses?: Iterable<{
    date: unknown;
    topArticleId?: string | null;
    isManualOverride?: boolean | null;
  }>,
): Promise<Map<string, KnownEventContext>> {
  const uniqueDates = [...new Set(dates.map((d) => d.trim()).filter(Boolean))];
  const out = new Map<string, KnownEventContext>();
  if (uniqueDates.length === 0) return out;

  const analysisByDate = new Map<string, { topArticleId?: string | null; isManualOverride?: boolean | null }>();
  if (preloadedAnalyses) {
    for (const row of preloadedAnalyses) {
      const ymd = normalizeContextDate(row.date);
      if (ymd) {
        analysisByDate.set(ymd, {
          topArticleId: row.topArticleId,
          isManualOverride: row.isManualOverride,
        });
      }
    }
  } else {
    const analyses = await db
      .select({
        date: historicalNewsAnalyses.date,
        topArticleId: historicalNewsAnalyses.topArticleId,
        isManualOverride: historicalNewsAnalyses.isManualOverride,
      })
      .from(historicalNewsAnalyses)
      .where(inArray(historicalNewsAnalyses.date, uniqueDates));

    for (const row of analyses) {
      const ymd = normalizeContextDate(row.date);
      if (ymd) analysisByDate.set(ymd, row);
    }
  }

  const milestones = await db
    .select({
      expectedDate: canonicalMilestones.expectedDate,
      slug: canonicalMilestones.slug,
      label: canonicalMilestones.label,
      description: canonicalMilestones.description,
    })
    .from(canonicalMilestones)
    .where(inArray(canonicalMilestones.expectedDate, uniqueDates));

  const milestoneByDate = new Map<string, (typeof milestones)[number]>();
  for (const row of milestones) {
    const ymd = normalizeContextDate(row.expectedDate);
    if (ymd) milestoneByDate.set(ymd, row);
  }

  const manualRows = await db
    .select({
      date: manualNewsEntries.date,
      title: manualNewsEntries.title,
      description: manualNewsEntries.description,
    })
    .from(manualNewsEntries)
    .where(inArray(manualNewsEntries.date, uniqueDates));

  const manualByDate = new Map<string, typeof manualRows>();
  for (const row of manualRows) {
    const ymd = normalizeContextDate(row.date);
    if (!ymd) continue;
    const list = manualByDate.get(ymd) ?? [];
    list.push(row);
    manualByDate.set(ymd, list);
  }

  for (const ymd of uniqueDates) {
    const row = analysisByDate.get(ymd);
    const milestone = milestoneByDate.get(ymd);
    const manualEntries = manualByDate.get(ymd) ?? [];
    const manualEntry = manualEntries[0] ?? null;

    out.set(
      ymd,
      buildKnownEventContext({
        topArticleId: row?.topArticleId,
        isManualOverride: row?.isManualOverride,
        manualEntryCount: manualEntries.length,
        manualEntryTitle: manualEntry?.title ?? null,
        manualEntryDescription: manualEntry?.description ?? null,
        milestone:
          milestone ?
            { slug: milestone.slug, label: milestone.label, description: milestone.description }
          : null,
      }),
    );
  }

  return out;
}

/** True when the day is curated without requiring a fetched article winner. */
export function isKnownEventDay(ctx: KnownEventContext): boolean {
  return ctx.isKnownEvent;
}

export function hasKnownEventSourceSignal(input: {
  topArticleId?: string | null;
  isManualOverride?: boolean | null;
  manualEntryCount?: number;
  milestoneLabel?: string | null;
}): boolean {
  return buildKnownEventContext({
    topArticleId: input.topArticleId,
    isManualOverride: input.isManualOverride,
    manualEntryCount: input.manualEntryCount,
    milestone: input.milestoneLabel ? { label: input.milestoneLabel } : null,
  }).isKnownEvent;
}

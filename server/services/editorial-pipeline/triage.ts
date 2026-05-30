import { and, asc, count, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../db";
import { historicalNewsAnalyses, manualNewsEntries, pagesAndTags } from "@shared/schema";
import type { TriageItem } from "./contracts";
import { triageItemSchema } from "./contracts";
import { evaluateSummaryQuality, isValidPipelineTopArticleId } from "./editorial-quality";
import { invalidTopicReasons } from "./topic-validation";

function isoDateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const s = new Date(`${from}T00:00:00.000Z`);
  const e = new Date(`${to}T00:00:00.000Z`);
  for (let d = s; d <= e; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Non-empty `tags_version2` strings. */
function tagsVersion2Len(v: unknown): number {
  if (v == null) return 0;
  if (!Array.isArray(v)) return 0;
  return v.filter((x) => typeof x === "string" && x.trim().length > 0).length;
}

/** Topic category entries (json array). */
function topicCategoriesLen(v: unknown): number {
  if (v == null) return 0;
  if (!Array.isArray(v)) return 0;
  return v.length;
}

function topicCategoryNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const v = entry.trim();
      if (v) out.push(v);
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const cand = [o.label, o.name, o.slug].find((x) => typeof x === "string" && (x as string).trim());
      if (typeof cand === "string") out.push(cand.trim());
    }
  }
  return out;
}

/** Legacy `tags` json array length. */
function legacyTagsLen(v: unknown): number {
  if (v == null) return 0;
  if (!Array.isArray(v)) return 0;
  return v.length;
}

/**
 * True when we have no positive taxonomy signal (normalized tags, topic categories, legacy tags, or join rows).
 * If no tag-related fields were passed at all (unit tests), returns false so behaviour stays backward-compatible.
 */
function editorialTaxonomyMissing(input: {
  tagsVersion2?: unknown;
  topicCategories?: unknown;
  tags?: unknown;
  tagLinkCount?: number | null;
}): boolean {
  const anyFieldProvided =
    input.tagsVersion2 !== undefined ||
    input.topicCategories !== undefined ||
    input.tags !== undefined ||
    input.tagLinkCount !== undefined;
  if (!anyFieldProvided) return false;

  if (tagsVersion2Len(input.tagsVersion2) > 0) return false;
  if (topicCategoriesLen(input.topicCategories) > 0) return false;
  if (legacyTagsLen(input.tags) > 0) return false;
  if (typeof input.tagLinkCount === "number" && input.tagLinkCount > 0) return false;
  return true;
}

export function triageExistingDay(input: {
  date: string;
  analysisId: string;
  summary: string | null;
  topArticleId?: string | null;
  isManualOverride?: boolean | null;
  isFlagged: boolean | null;
  isOrphan: boolean | null;
  totalArticlesFetched: number | null;
  confidenceScore: string | number | null;
  tagsVersion2?: unknown;
  topicCategories?: unknown;
  tags?: unknown;
  tagLinkCount?: number | null;
  manualEntryCount?: number | null;
}): TriageItem {
  const reasons: string[] = [];
  const totalArticlesFetched = Number(input.totalArticlesFetched ?? 0);
  const taxonomyMissing = editorialTaxonomyMissing(input);
  const summaryIssue = evaluateSummaryQuality(input.summary);
  const hasManualEventSignal =
    Boolean(input.isManualOverride) ||
    Number(input.manualEntryCount ?? 0) > 0 ||
    String(input.topArticleId ?? "").trim().startsWith("manual-") ||
    String(input.topArticleId ?? "").trim().startsWith("known-");
  const hasValidArticleWinner = totalArticlesFetched > 0 && isValidPipelineTopArticleId(input.topArticleId);
  const hasKnownManualEvent =
    hasManualEventSignal &&
    String(input.summary ?? "").trim().length > 0 &&
    !taxonomyMissing;
  const hasUsableEventSource = hasValidArticleWinner || hasKnownManualEvent;

  if (input.isFlagged) reasons.push("Day is flagged");
  if (input.isOrphan) reasons.push("Day marked as orphan");
  if (totalArticlesFetched === 0 && !hasKnownManualEvent) reasons.push("No fetched articles");
  if (summaryIssue) reasons.push(summaryIssue.message);
  if (!isValidPipelineTopArticleId(input.topArticleId) && !hasKnownManualEvent) {
    reasons.push("No winning article selected (top_article_id missing or placeholder)");
  }
  if (Number(input.confidenceScore ?? 0) < 60) reasons.push("Low confidence score");
  if (taxonomyMissing) {
    reasons.push("No tags or topic categories linked for this day");
  }
  const topicIssues = invalidTopicReasons(topicCategoryNames(input.topicCategories));
  if (topicIssues.length > 0 && !taxonomyMissing) {
    reasons.push(`Topic hierarchy issue: ${topicIssues.join("; ")}`);
  }

  if (!reasons.length) {
    return triageItemSchema.parse({
      date: input.date,
      analysisId: input.analysisId,
      route: "existing_ok",
      reasons: ["Quality checks passed for this day"],
      requiredAgents: ["NewsManager", "DuplicateCheckerAgent", "DateConsistencyAgent", "TagConsistencyAgent", "FinalEditorAgent"],
      confidence: 0.75,
    });
  }

  /**
   * Summary length is a hard cleanup rule, but it does not automatically mean
   * refetch. If a usable event source already exists (valid article winner OR
   * known/manual event with taxonomy), route to correction and redo the summary.
   */
  const summaryRedoViable = Boolean(summaryIssue) && hasUsableEventSource;
  const missingEventSource = !hasUsableEventSource;
  const useEmptyDayPath = missingEventSource && (totalArticlesFetched === 0 || Boolean(summaryIssue));

  const route = useEmptyDayPath ? "empty_day" : "existing_needs_correction";

  const reasonsForPackage =
    summaryRedoViable ?
      [
        ...reasons,
        hasKnownManualEvent
          ? "Known/manual event has enough context — pipeline uses correction/redo_summary (100–110 chars), not article refetch."
          : "Valid article + taxonomy exists — pipeline uses correction/redo_summary (100–110 chars), not article refetch.",
      ]
    : reasons;

  return triageItemSchema.parse({
    date: input.date,
    analysisId: input.analysisId,
    route,
    reasons: reasonsForPackage,
    requiredAgents: route === "empty_day"
      ? [
          "SourceFinderAgent",
          "RelevanceCheckerAgent",
          "VerificationAgent",
          "SummaryAgent",
          "DuplicateCheckerAgent",
          "DateConsistencyAgent",
          "TagConsistencyAgent",
          "FinalEditorAgent",
        ]
      : [
          "VerificationAgent",
          "TopicManagerAgent",
          "TagManagerAgent",
          "SummaryAgent",
          "DuplicateCheckerAgent",
          "DateConsistencyAgent",
          "TagConsistencyAgent",
          "FinalEditorAgent",
        ],
    confidence: 0.86,
  });
}

export function prioritizeTriage(items: TriageItem[]): TriageItem[] {
  return items.sort((a, b) => {
    const rank = (r: TriageItem["route"]) =>
      r === "missing_day" ? 0 : r === "empty_day" ? 1 : r === "existing_needs_correction" ? 2 : 3;
    return rank(a.route) - rank(b.route);
  });
}

/** Re-run triage rules against the latest DB row (e.g. after SourceFinder refetched articles). */
export async function retriageSingleExistingDate(date: string): Promise<TriageItem | null> {
  const [existing] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      isManualOverride: historicalNewsAnalyses.isManualOverride,
      isFlagged: historicalNewsAnalyses.isFlagged,
      isOrphan: historicalNewsAnalyses.isOrphan,
      totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      tags: historicalNewsAnalyses.tags,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  if (!existing) return null;

  const [cntRow] = await db
    .select({ n: count() })
    .from(pagesAndTags)
    .where(eq(pagesAndTags.analysisId, existing.id));
  const [manualRow] = await db
    .select({ n: count() })
    .from(manualNewsEntries)
    .where(eq(manualNewsEntries.date, date));

  return triageExistingDay({
    date,
    analysisId: existing.id,
    summary: existing.summary,
    topArticleId: existing.topArticleId,
    isManualOverride: existing.isManualOverride,
    isFlagged: existing.isFlagged,
    isOrphan: existing.isOrphan,
    totalArticlesFetched: existing.totalArticlesFetched,
    confidenceScore: existing.confidenceScore,
    tagsVersion2: existing.tagsVersion2,
    topicCategories: existing.topicCategories,
    tags: existing.tags,
    tagLinkCount: Number(cntRow?.n ?? 0),
    manualEntryCount: Number(manualRow?.n ?? 0),
  });
}

export async function triageRange(opts: {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
}): Promise<TriageItem[]> {
  const rows = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      isManualOverride: historicalNewsAnalyses.isManualOverride,
      isFlagged: historicalNewsAnalyses.isFlagged,
      isOrphan: historicalNewsAnalyses.isOrphan,
      totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      tags: historicalNewsAnalyses.tags,
    })
    .from(historicalNewsAnalyses)
    .where(and(gte(historicalNewsAnalyses.date, opts.dateFrom), lte(historicalNewsAnalyses.date, opts.dateTo)))
    .orderBy(asc(historicalNewsAnalyses.date));

  const analysisIds = rows.map((r) => r.id);
  const linkCountByAnalysis = new Map<string, number>();
  if (analysisIds.length) {
    const agg = await db
      .select({
        analysisId: pagesAndTags.analysisId,
        n: count(),
      })
      .from(pagesAndTags)
      .where(inArray(pagesAndTags.analysisId, analysisIds))
      .groupBy(pagesAndTags.analysisId);
    for (const row of agg) {
      linkCountByAnalysis.set(row.analysisId, Number(row.n));
    }
  }
  const manualCountByDate = new Map<string, number>();
  if (rows.length) {
    const dates = rows.map((r) => r.date);
    const manualAgg = await db
      .select({
        date: manualNewsEntries.date,
        n: count(),
      })
      .from(manualNewsEntries)
      .where(inArray(manualNewsEntries.date, dates))
      .groupBy(manualNewsEntries.date);
    for (const row of manualAgg) {
      manualCountByDate.set(row.date, Number(row.n));
    }
  }

  const byDate = new Map<string, (typeof rows)[number]>();
  for (const row of rows) byDate.set(row.date, row);

  const allDates = isoDateRange(opts.dateFrom, opts.dateTo);
  const triage: TriageItem[] = [];

  for (const date of allDates) {
    if (triage.length >= opts.maxDaysToConsider) break;
    const existing = byDate.get(date);
    if (!existing) {
      triage.push(
        triageItemSchema.parse({
          date,
          analysisId: null,
          route: "missing_day",
          reasons: ["No analysis exists for this day"],
          requiredAgents: [
            "MilestoneAgent",
            "SourceFinderAgent",
            "RelevanceCheckerAgent",
            "VerificationAgent",
            "SummaryAgent",
            "DuplicateCheckerAgent",
            "DateConsistencyAgent",
            "TagConsistencyAgent",
            "FinalEditorAgent",
          ],
          confidence: 0.98,
        })
      );
      continue;
    }

    triage.push(
      triageExistingDay({
        date,
        analysisId: existing.id,
        summary: existing.summary,
        topArticleId: existing.topArticleId,
        isManualOverride: existing.isManualOverride,
        isFlagged: existing.isFlagged,
        isOrphan: existing.isOrphan,
        totalArticlesFetched: existing.totalArticlesFetched,
        confidenceScore: existing.confidenceScore,
        tagsVersion2: existing.tagsVersion2,
        topicCategories: existing.topicCategories,
        tags: existing.tags,
        tagLinkCount: linkCountByAnalysis.get(existing.id) ?? 0,
        manualEntryCount: manualCountByDate.get(existing.date) ?? 0,
      })
    );
  }

  // Highest priority first: missing/empty/corrections then healthy days.
  return prioritizeTriage(triage);
}

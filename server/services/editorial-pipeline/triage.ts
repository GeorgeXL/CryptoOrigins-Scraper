import { and, asc, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import { historicalNewsAnalyses } from "@shared/schema";
import type { TriageItem } from "./contracts";
import { triageItemSchema } from "./contracts";

function isoDateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const s = new Date(`${from}T00:00:00.000Z`);
  const e = new Date(`${to}T00:00:00.000Z`);
  for (let d = s; d <= e; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function isSummaryWeak(summary: string | null): boolean {
  if (!summary) return true;
  return summary.trim().length < 80;
}

export function triageExistingDay(input: {
  date: string;
  analysisId: string;
  summary: string | null;
  isFlagged: boolean | null;
  isOrphan: boolean | null;
  totalArticlesFetched: number | null;
  confidenceScore: string | number | null;
}): TriageItem {
  const reasons: string[] = [];
  if (input.isFlagged) reasons.push("Day is flagged");
  if (input.isOrphan) reasons.push("Day marked as orphan");
  if (Number(input.totalArticlesFetched ?? 0) === 0) reasons.push("No fetched articles");
  if (isSummaryWeak(input.summary)) reasons.push("Summary appears weak or empty");
  if (Number(input.confidenceScore ?? 0) < 60) reasons.push("Low confidence score");

  if (!reasons.length) {
    return triageItemSchema.parse({
      date: input.date,
      analysisId: input.analysisId,
      route: "existing_ok",
      reasons: ["Quality checks passed for this day"],
      requiredAgents: ["NewsManager", "FinalEditorAgent"],
      confidence: 0.75,
    });
  }

  const route = Number(input.totalArticlesFetched ?? 0) === 0 || isSummaryWeak(input.summary)
    ? "empty_day"
    : "existing_needs_correction";

  return triageItemSchema.parse({
    date: input.date,
    analysisId: input.analysisId,
    route,
    reasons,
    requiredAgents: route === "empty_day"
      ? [
          "SourceFinderAgent",
          "RelevanceCheckerAgent",
          "VerificationAgent",
          "SummaryAgent",
          "FinalEditorAgent",
        ]
      : [
          "VerificationAgent",
          "TopicManagerAgent",
          "TagManagerAgent",
          "DuplicateCheckerAgent",
          "SummaryAgent",
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
      isFlagged: historicalNewsAnalyses.isFlagged,
      isOrphan: historicalNewsAnalyses.isOrphan,
      totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
    })
    .from(historicalNewsAnalyses)
    .where(and(gte(historicalNewsAnalyses.date, opts.dateFrom), lte(historicalNewsAnalyses.date, opts.dateTo)))
    .orderBy(asc(historicalNewsAnalyses.date));

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
        isFlagged: existing.isFlagged,
        isOrphan: existing.isOrphan,
        totalArticlesFetched: existing.totalArticlesFetched,
        confidenceScore: existing.confidenceScore,
      })
    );
  }

  // Highest priority first: missing/empty/corrections then healthy days.
  return prioritizeTriage(triage);
}

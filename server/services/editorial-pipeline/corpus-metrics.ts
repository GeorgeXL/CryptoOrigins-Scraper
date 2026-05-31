/**
 * §12 KPI metrics for editorial corpus cleaning.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { humanReviewQueue } from "@shared/schema";
import { evaluateCorpusDay } from "./corpus-clean";
import {
  EDITORIAL_SUMMARY_TARGET_MAX,
  EDITORIAL_SUMMARY_TARGET_MIN,
} from "./editorial-quality";
import { invalidTopicReasons } from "./topic-validation";
import { topicLabelsFromRow } from "./tools";
import {
  isArticlePickPackage,
  isCalendarDecisionPackage,
  isCorrectionApprovalPackage,
  isDuplicateDecisionPackage,
  isSummaryApprovalPackage,
} from "./review-package";

export type CorpusMetricsSample = {
  date: string;
  phase: string;
  hasTopicSuggestion: boolean;
  hasModelTopicReason: boolean;
  legacyTopic: boolean;
  wouldAutoApply: number;
  wouldQueue: number;
};

export type CorpusMetricsReport = {
  sampled: number;
  usefulTopicSuggestionPct: number;
  legacyTopicPct: number;
  modelReasonPct: number;
  autoPassPct: number;
  phaseCounts: Record<string, number>;
  samples: CorpusMetricsSample[];
};

export async function computeCorpusMetricsForDates(dates: string[]): Promise<CorpusMetricsReport> {
  const samples: CorpusMetricsSample[] = [];
  const phaseCounts: Record<string, number> = {};

  for (const date of dates) {
    const eval_ = await evaluateCorpusDay(date);
    if (!eval_) continue;

    phaseCounts[eval_.phase] = (phaseCounts[eval_.phase] ?? 0) + 1;
    const topicProposal = eval_.proposals.find((p) => p.kind === "set_topic_categories");
    const hasTopicSuggestion =
      Boolean(topicProposal?.kind === "set_topic_categories" && topicProposal.proposed.length > 0) ||
      Boolean(eval_.topicAfterAuto);
    const hasModelTopicReason =
      topicProposal?.kind === "set_topic_categories" &&
      Boolean(topicProposal.rationale?.includes("Topic Agent") || topicProposal.topicAgentSource === "llm");
    const legacyTopic = eval_.topicIssuesBefore.some(
      (i) => i.includes("Old broad") || i.includes("not in the current hierarchy"),
    );

    samples.push({
      date,
      phase: eval_.phase,
      hasTopicSuggestion,
      hasModelTopicReason: Boolean(hasModelTopicReason),
      legacyTopic,
      wouldAutoApply: eval_.wouldAutoApply.length,
      wouldQueue: eval_.wouldQueueForHuman.length,
    });
  }

  const n = samples.length || 1;
  return {
    sampled: samples.length,
    usefulTopicSuggestionPct: Math.round((samples.filter((s) => s.hasTopicSuggestion).length / n) * 100),
    legacyTopicPct: Math.round((samples.filter((s) => s.legacyTopic).length / n) * 100),
    modelReasonPct: Math.round((samples.filter((s) => s.hasModelTopicReason).length / n) * 100),
    autoPassPct: Math.round((samples.filter((s) => s.phase === "auto_pass").length / n) * 100),
    phaseCounts,
    samples,
  };
}

export function legacyTopicIssues(topics: string[]): boolean {
  return invalidTopicReasons(topics).some(
    (i) => i.includes("Old broad") || i.includes("not in the current hierarchy"),
  );
}

export function topicsFromRow(raw: unknown): string[] {
  return topicLabelsFromRow(raw);
}

export type CorpusOverviewMetrics = {
  totalDays: number;
  emptySummaryDays: number;
  summaryTooShort: number;
  summaryTooLong: number;
  summaryInTarget: number;
  orphanDays: number;
  flaggedDays: number;
  reviewQueue: {
    pending: number;
    approved: number;
    rejected: number;
    pendingByPhase: Record<string, number>;
  };
  yearCounts: Array<{ year: number; count: number }>;
  computedAt: string;
};

function phaseFromReviewPackage(pkg: unknown): string {
  if (isArticlePickPackage(pkg)) return "awaiting_article_pick";
  if (isSummaryApprovalPackage(pkg)) return "awaiting_summary_approval";
  if (isCorrectionApprovalPackage(pkg)) return "awaiting_correction_approval";
  if (isCalendarDecisionPackage(pkg)) return "awaiting_calendar_decision";
  if (isDuplicateDecisionPackage(pkg)) return "awaiting_duplicate_decision";
  return "other";
}

/** Fast corpus-wide stats from SQL + review queue (no LLM). */
export async function computeCorpusOverviewMetrics(): Promise<CorpusOverviewMetrics> {
  const totalsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_days,
      COUNT(*) FILTER (WHERE summary IS NULL OR TRIM(summary) = '')::int AS empty_summary,
      COUNT(*) FILTER (
        WHERE summary IS NOT NULL AND TRIM(summary) <> ''
          AND LENGTH(TRIM(summary)) < ${EDITORIAL_SUMMARY_TARGET_MIN}
      )::int AS too_short,
      COUNT(*) FILTER (
        WHERE summary IS NOT NULL AND TRIM(summary) <> ''
          AND LENGTH(TRIM(summary)) > ${EDITORIAL_SUMMARY_TARGET_MAX}
      )::int AS too_long,
      COUNT(*) FILTER (
        WHERE summary IS NOT NULL AND TRIM(summary) <> ''
          AND LENGTH(TRIM(summary)) >= ${EDITORIAL_SUMMARY_TARGET_MIN}
          AND LENGTH(TRIM(summary)) <= ${EDITORIAL_SUMMARY_TARGET_MAX}
      )::int AS in_target,
      COUNT(*) FILTER (WHERE is_orphan = true)::int AS orphan_days,
      COUNT(*) FILTER (WHERE is_flagged = true)::int AS flagged_days
    FROM historical_news_analyses
  `);

  const yearRows = await db.execute(sql`
    SELECT EXTRACT(YEAR FROM date)::int AS year, COUNT(*)::int AS count
    FROM historical_news_analyses
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const queueRows = await db
    .select({ status: humanReviewQueue.status, package: humanReviewQueue.package })
    .from(humanReviewQueue);

  const pendingByPhase: Record<string, number> = {};
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  for (const row of queueRows) {
    if (row.status === "pending") {
      pending += 1;
      const phase = phaseFromReviewPackage(row.package);
      pendingByPhase[phase] = (pendingByPhase[phase] ?? 0) + 1;
    } else if (row.status === "approved") approved += 1;
    else if (row.status === "rejected") rejected += 1;
  }

  const t = (totalsResult.rows[0] ?? {}) as Record<string, number>;

  return {
    totalDays: t.total_days ?? 0,
    emptySummaryDays: t.empty_summary ?? 0,
    summaryTooShort: t.too_short ?? 0,
    summaryTooLong: t.too_long ?? 0,
    summaryInTarget: t.in_target ?? 0,
    orphanDays: t.orphan_days ?? 0,
    flaggedDays: t.flagged_days ?? 0,
    reviewQueue: { pending, approved, rejected, pendingByPhase },
    yearCounts: (yearRows.rows as Array<{ year: number; count: number }>).map((r) => ({
      year: Number(r.year),
      count: Number(r.count),
    })),
    computedAt: new Date().toISOString(),
  };
}

function seededShuffle<T>(items: T[], seedStr: string): T[] {
  const arr = [...items];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i += 1) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function sampleDatesInRange(from: string, to: string, count: number, seed: string): Promise<string[]> {
  const pool = await db.execute(sql`
    SELECT date::text AS date
    FROM historical_news_analyses
    WHERE date >= ${from}::date AND date <= ${to}::date
    ORDER BY date ASC
  `);
  const allDates = (pool.rows as { date: string }[]).map((r) => r.date);
  return seededShuffle(allDates, seed).slice(0, Math.max(1, count));
}

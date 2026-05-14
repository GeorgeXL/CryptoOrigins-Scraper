import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { canonicalMilestones, historicalNewsAnalyses } from "@shared/schema";
import { NewsAnalyzerService } from "../news-analyzer";

const newsAnalyzer = new NewsAnalyzerService();

export type ExistingDay = {
  id: string;
  date: string;
  summary: string;
  isFlagged: boolean | null;
  isOrphan: boolean | null;
  confidenceScore: string | null;
};

export async function getExistingDay(date: string): Promise<ExistingDay | null> {
  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      isFlagged: historicalNewsAnalyses.isFlagged,
      isOrphan: historicalNewsAnalyses.isOrphan,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  return row ?? null;
}

export async function listCanonicalMilestonesInRange(dateFrom: string, dateTo: string) {
  return db
    .select()
    .from(canonicalMilestones)
    .where(and(eq(canonicalMilestones.category, "bitcoin-history")));
}

// Wrapper around existing mature search/analyze pipeline (preserved path).
export async function runExistingSearchAndSummaryForDate(date: string): Promise<{
  summary: string;
  confidenceScore: number;
  totalArticlesFetched: number;
}> {
  const out = await newsAnalyzer.analyzeNewsForDate({
    date,
    forceReanalysis: true,
    aiProvider: "openai",
    requestContext: { source: "editorial-pipeline-v2", requestId: `pipeline-${date}-${Date.now()}` },
  });
  return {
    summary: out.summary,
    confidenceScore: out.confidenceScore,
    totalArticlesFetched: out.totalArticlesFetched,
  };
}

// Lightweight wrapper for existing verification metadata already stored on day rows.
export async function getExistingVerificationSignals(date: string) {
  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      geminiApproved: historicalNewsAnalyses.geminiApproved,
      perplexityApproved: historicalNewsAnalyses.perplexityApproved,
      verificationStatus: historicalNewsAnalyses.verificationStatus,
      agreementScore: historicalNewsAnalyses.agreementScore,
      factCheckVerdict: historicalNewsAnalyses.factCheckVerdict,
      perplexityVerdict: historicalNewsAnalyses.perplexityVerdict,
      perplexityCitations: historicalNewsAnalyses.perplexityCitations,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  return row ?? null;
}

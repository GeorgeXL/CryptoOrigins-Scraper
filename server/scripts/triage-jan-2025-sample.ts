/**
 * One-off: triage + light DB snapshot for January 2025 sample window.
 * Usage: npx tsx server/scripts/triage-jan-2025-sample.ts
 */
import "dotenv/config";
import { and, asc, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { triageRange } from "../services/editorial-pipeline/triage";
import { isEditorialSummaryWeak } from "../services/editorial-pipeline/editorial-quality";

const DATE_FROM = "2025-01-01";
const DATE_TO = "2025-01-10";

async function main() {
  const items = await triageRange({
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    maxDaysToConsider: 31,
  });

  console.log(`=== TRIAGE ${DATE_FROM} → ${DATE_TO} ===\n`);
  for (const t of items) {
    console.log(
      JSON.stringify(
        {
          date: t.date,
          route: t.route,
          analysisId: t.analysisId,
          reasons: t.reasons,
          chain: t.requiredAgents.filter((a) => a !== "NewsManager"),
        },
        null,
        0,
      ),
    );
    console.log("");
  }

  const rows = await db
    .select({
      date: historicalNewsAnalyses.date,
      id: historicalNewsAnalyses.id,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
      isFlagged: historicalNewsAnalyses.isFlagged,
      isOrphan: historicalNewsAnalyses.isOrphan,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
    })
    .from(historicalNewsAnalyses)
    .where(
      and(
        gte(historicalNewsAnalyses.date, DATE_FROM),
        lte(historicalNewsAnalyses.date, DATE_TO),
      ),
    )
    .orderBy(asc(historicalNewsAnalyses.date));

  console.log(`=== DB (${rows.length} rows in range) ===\n`);
  for (const r of rows) {
    const s = (r.summary ?? "").trim();
    const tags = Array.isArray(r.tagsVersion2) ? r.tagsVersion2 : [];
    const topics = Array.isArray(r.topicCategories) ? r.topicCategories : [];
    console.log(
      JSON.stringify(
        {
          date: r.date,
          id: r.id,
          summaryChars: s.length,
          summaryWeak: isEditorialSummaryWeak(r.summary),
          summaryPreview: s.slice(0, 100),
          topArticleId: r.topArticleId,
          articles: r.totalArticlesFetched,
          confidence: r.confidenceScore,
          flagged: r.isFlagged,
          orphan: r.isOrphan,
          tagsV2Count: tags.length,
          tagsV2Sample: tags.slice(0, 5),
          topicsCount: topics.length,
        },
        null,
        2,
      ),
    );
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

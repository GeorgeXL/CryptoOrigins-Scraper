import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";

async function main() {
  const date = "2026-01-13";
  const rows = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      isManualOverride: historicalNewsAnalyses.isManualOverride,
      isOrphan: historicalNewsAnalyses.isOrphan,
      lastAnalyzed: historicalNewsAnalyses.lastAnalyzed,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);

  console.log(rows[0] ?? null);

  const joinCount = await db.execute(
    sql.raw(`
      select count(*)::int as n
      from pages_and_tags pt
      join historical_news_analyses hna on hna.id = pt.analysis_id
      where hna.date = '2026-01-13'
    `),
  );
  console.log("pages_and_tags:", joinCount.rows?.[0] ?? null);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


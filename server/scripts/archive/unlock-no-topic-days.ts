/**
 * Unlock days that have no storyline topic but are still locked.
 *
 * Usage:
 *   npx tsx server/scripts/unlock-no-topic-days.ts --dry-run
 *   npx tsx server/scripts/unlock-no-topic-days.ts --apply
 */

import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { historicalNewsAnalyses } from "@shared/schema";
import { analysisHasStorylineTopic } from "@shared/storyline-topic-eligibility";
import { db } from "../db";
import { unlockAnalysisDayWithoutTopic } from "../services/unverified-day-normalization";

function parseArgs() {
  return { dryRun: !process.argv.includes("--apply") };
}

async function main() {
  const { dryRun } = parseArgs();

  const rows = await db
    .select({
      date: historicalNewsAnalyses.date,
      topicCategories: historicalNewsAnalyses.topicCategories,
      isLocked: historicalNewsAnalyses.isLocked,
      googleCheckHappened: historicalNewsAnalyses.googleCheckHappened,
      summary: historicalNewsAnalyses.summary,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.isLocked, true));

  const toUnlock = rows.filter(
    (row) => row.isLocked && !analysisHasStorylineTopic(row.topicCategories),
  );

  console.log(
    JSON.stringify({
      mode: dryRun ? "dry-run" : "apply",
      lockedTotal: rows.length,
      lockedWithoutTopic: toUnlock.length,
    }),
  );

  for (const row of toUnlock) {
    console.log(
      JSON.stringify({
        date: row.date,
        googleCheck: row.googleCheckHappened,
        summary: String(row.summary ?? "").slice(0, 100),
      }),
    );
    if (!dryRun) {
      await unlockAnalysisDayWithoutTopic(row.date);
    }
  }

  if (!dryRun) {
    const verify = await db.execute(sql`
      SELECT COUNT(*)::int AS locked_no_topic
      FROM historical_news_analyses
      WHERE is_locked = true
        AND (topic_categories IS NULL OR jsonb_array_length(COALESCE(topic_categories, '[]'::jsonb)) = 0)
    `);
    console.log(JSON.stringify({ remainingLockedWithoutTopic: verify.rows[0] }));
  } else {
    console.log("\nDry run complete — pass --apply to persist.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Normalize google_check=no/uncertain days: clear storyline topics and unlock.
 *
 * Usage:
 *   npx tsx server/scripts/clear-topics-unverified-days.ts --dry-run
 *   npx tsx server/scripts/clear-topics-unverified-days.ts --apply
 */

import "dotenv/config";

import { eq, or } from "drizzle-orm";

import { historicalNewsAnalyses } from "@shared/schema";
import {
  analysisHasStorylineTopic,
  storylineTopicBlockReason,
} from "@shared/storyline-topic-eligibility";
import { db } from "../db";
import { normalizeUnverifiedAnalysisDay } from "../services/unverified-day-normalization";

function parseArgs() {
  return { dryRun: !process.argv.includes("--apply") };
}

async function main() {
  const { dryRun } = parseArgs();
  const rows = await db
    .select({
      date: historicalNewsAnalyses.date,
      googleCheckHappened: historicalNewsAnalyses.googleCheckHappened,
      topicCategories: historicalNewsAnalyses.topicCategories,
      isLocked: historicalNewsAnalyses.isLocked,
      summary: historicalNewsAnalyses.summary,
    })
    .from(historicalNewsAnalyses)
    .where(
      or(
        eq(historicalNewsAnalyses.googleCheckHappened, "no"),
        eq(historicalNewsAnalyses.googleCheckHappened, "uncertain"),
      ),
    );

  const needsWork = rows.filter((row) => {
    if (!storylineTopicBlockReason(row.googleCheckHappened)) return false;
    return analysisHasStorylineTopic(row.topicCategories) || Boolean(row.isLocked);
  });

  console.log(
    JSON.stringify({
      mode: dryRun ? "dry-run" : "apply",
      googleNoOrUncertain: rows.length,
      needingNormalization: needsWork.length,
    }),
  );

  let clearedTopics = 0;
  let unlocked = 0;

  for (const row of needsWork) {
    const reason = storylineTopicBlockReason(row.googleCheckHappened);
    const wouldClearTopic = analysisHasStorylineTopic(row.topicCategories);
    const wouldUnlock = Boolean(row.isLocked);

    console.log(
      JSON.stringify({
        date: row.date,
        googleCheck: row.googleCheckHappened,
        reason,
        wouldClearTopic,
        wouldUnlock,
        summary: String(row.summary ?? "").slice(0, 100),
      }),
    );

    if (wouldClearTopic) clearedTopics += 1;
    if (wouldUnlock) unlocked += 1;

    if (!dryRun) {
      await normalizeUnverifiedAnalysisDay(row.date, row.googleCheckHappened);
    }
  }

  console.log(
    JSON.stringify({
      clearedTopics,
      unlocked,
      done: dryRun ? "dry-run" : "applied",
    }),
  );

  if (dryRun) {
    console.log("\nDry run complete — pass --apply to persist.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

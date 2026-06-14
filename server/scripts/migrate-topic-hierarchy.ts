/**
 * Migrate storyline topics to hierarchy v2 and optionally clear stale main-events cache.
 *
 * Usage:
 *   npx tsx server/scripts/migrate-topic-hierarchy.ts --dry-run
 *   npx tsx server/scripts/migrate-topic-hierarchy.ts
 *   npx tsx server/scripts/migrate-topic-hierarchy.ts --clear-main-events-cache
 */

import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses, mainEventsCheckCache } from "@shared/schema";
import { TOPIC_HIERARCHY } from "../../shared/topic-hierarchy";
import {
  LEGACY_TOPIC_LEAF_MIGRATION,
  migrateLegacyTopicLeaf,
  resolveStorylineLeafLabel,
} from "../../shared/topic-hierarchy-migration";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { syncStorylineAssignmentsForDate, backfillPageTopicsFromCategories, ensureTopicHierarchySeeded } from "../services/editorial-pipeline/storyline-taxonomy";

function normalizeTopicKey(value: string): string {
  return value.trim().toLowerCase();
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    clearMainEventsCache: args.includes("--clear-main-events-cache"),
    seedTopics: args.includes("--seed-topics"),
    backfillPageTopics: args.includes("--backfill-page-topics"),
  };
}

type MigrationStats = {
  scanned: number;
  unchanged: number;
  migrated: number;
  alreadyCurrent: number;
  needsReview: number;
  empty: number;
  byTarget: Record<string, number>;
  reviewSamples: Array<{ date: string; from: string }>;
};

async function migrateAnalysisTopics(dryRun: boolean): Promise<MigrationStats> {
  const stats: MigrationStats = {
    scanned: 0,
    unchanged: 0,
    migrated: 0,
    alreadyCurrent: 0,
    needsReview: 0,
    empty: 0,
    byTarget: {},
    reviewSamples: [],
  };

  const rows = await db
    .select({
      date: historicalNewsAnalyses.date,
      topicCategories: historicalNewsAnalyses.topicCategories,
    })
    .from(historicalNewsAnalyses);

  for (const row of rows) {
    stats.scanned += 1;
    const labels = topicLabelsFromRow(row.topicCategories);
    if (labels.length === 0) {
      stats.empty += 1;
      continue;
    }

    const current = labels[0]!;
    const resolved = resolveStorylineLeafLabel(current);

    if (!resolved) {
      stats.needsReview += 1;
      if (stats.reviewSamples.length < 25) {
        stats.reviewSamples.push({ date: row.date, from: current });
      }
      continue;
    }

    if (normalizeTopicKey(resolved) === normalizeTopicKey(current)) {
      stats.alreadyCurrent += 1;
      continue;
    }

    if (!dryRun) {
      await syncStorylineAssignmentsForDate(row.date, [resolved]);
      await db
        .update(historicalNewsAnalyses)
        .set({ topicCategories: [resolved] })
        .where(eq(historicalNewsAnalyses.date, row.date));
    }

    stats.migrated += 1;
    stats.byTarget[resolved] = (stats.byTarget[resolved] ?? 0) + 1;
  }

  return stats;
}

async function clearMainEventsCache(dryRun: boolean): Promise<number> {
  if (dryRun) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(mainEventsCheckCache);
    return row?.count ?? 0;
  }
  await db.delete(mainEventsCheckCache);
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(mainEventsCheckCache);
  return row?.count ?? 0;
}

async function main() {
  const { dryRun, clearMainEventsCache: shouldClearCache, seedTopics, backfillPageTopics } = parseArgs();

  console.log(`Topic hierarchy v2 migration${dryRun ? " (dry run)" : ""}`);
  console.log(`New groups: ${TOPIC_HIERARCHY.map((g) => g.name).join(" · ")}`);
  console.log(
    `Legacy leaves mapped: ${Object.keys(LEGACY_TOPIC_LEAF_MIGRATION).length}`,
  );

  if (seedTopics) {
    if (dryRun) {
      console.log("\nWould seed hierarchy groups and leaves into topics.");
    } else {
      await ensureTopicHierarchySeeded();
      console.log("\nSeeded hierarchy groups and leaves into topics.");
    }
  }

  if (backfillPageTopics) {
    const backfillStats = await backfillPageTopicsFromCategories(dryRun);
    console.log("\npage_topics backfill:");
    console.log(JSON.stringify(backfillStats, null, 2));
  }

  const stats = await migrateAnalysisTopics(dryRun);
  console.log("\nRetag results:");
  console.log(JSON.stringify(stats, null, 2));

  if (shouldClearCache) {
    const remaining = await clearMainEventsCache(dryRun);
    console.log(
      `\nMain events cache ${dryRun ? "would clear" : "cleared"} (${remaining} rows remaining).`,
    );
  } else {
    console.log(
      "\nNote: main-events cache already invalid via MAIN_EVENTS_CHECK_CACHE_VERSION bump. Pass --clear-main-events-cache to delete old rows.",
    );
  }

  if (dryRun) {
    console.log("\nRe-run without --dry-run to apply.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

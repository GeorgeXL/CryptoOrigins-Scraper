/**
 * Strip heavy JSONB artifacts from finalized (locked + topic) analysis rows.
 * Keeps summary, topic_categories, google_check fields, lock state, etc.
 *
 * Usage:
 *   npx tsx server/scripts/strip-analysis-artifacts.ts           # dry-run (default)
 *   npx tsx server/scripts/strip-analysis-artifacts.ts --apply
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { analysisHasStorylineTopic } from "@shared/storyline-topic-eligibility";
import { db } from "../db";

function parseArgs() {
  return { apply: process.argv.includes("--apply") };
}

type SizeRow = {
  row_count: number;
  tiered_bytes: string;
  article_tags_bytes: string;
  analyzed_bytes: string;
  total_json_bytes: string;
};

async function measureTargetSizes(): Promise<SizeRow> {
  const result = await db.execute<SizeRow>(sql`
    SELECT
      COUNT(*)::int AS row_count,
      COALESCE(SUM(pg_column_size(tiered_articles)), 0)::bigint AS tiered_bytes,
      COALESCE(SUM(pg_column_size(article_tags)), 0)::bigint AS article_tags_bytes,
      COALESCE(SUM(pg_column_size(analyzed_articles)), 0)::bigint AS analyzed_bytes,
      COALESCE(
        SUM(
          COALESCE(pg_column_size(tiered_articles), 0)
          + COALESCE(pg_column_size(article_tags), 0)
          + COALESCE(pg_column_size(analyzed_articles), 0)
        ),
        0
      )::bigint AS total_json_bytes
    FROM historical_news_analyses
    WHERE is_locked = true
      AND topic_categories IS NOT NULL
      AND jsonb_array_length(topic_categories) > 0
      AND (
        tiered_articles IS NOT NULL
        OR article_tags IS NOT NULL
        OR analyzed_articles IS NOT NULL
      )
  `);
  return result.rows[0]!;
}

function formatBytes(n: number | string): string {
  const bytes = typeof n === "string" ? Number(n) : n;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${bytes} B`;
}

async function main() {
  const { apply } = parseArgs();

  const before = await measureTargetSizes();
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        targetCriteria: "is_locked=true AND has storyline topic AND has JSON artifacts",
        rowsWithArtifacts: before.row_count,
        bytesBefore: {
          tiered_articles: formatBytes(before.tiered_bytes),
          article_tags: formatBytes(before.article_tags_bytes),
          analyzed_articles: formatBytes(before.analyzed_bytes),
          totalStrippedColumns: formatBytes(before.total_json_bytes),
        },
      },
      null,
      2,
    ),
  );

  if (before.row_count === 0) {
    console.log("\nNo rows to strip.");
    return;
  }

  // Spot-check eligibility helper alignment (sample up to 5)
  const sample = await db.execute(sql`
    SELECT date::text AS date, topic_categories, is_locked
    FROM historical_news_analyses
    WHERE is_locked = true
      AND topic_categories IS NOT NULL
      AND jsonb_array_length(topic_categories) > 0
      AND (
        tiered_articles IS NOT NULL
        OR article_tags IS NOT NULL
        OR analyzed_articles IS NOT NULL
      )
    ORDER BY date ASC
    LIMIT 5
  `);
  for (const row of sample.rows as { date: string; topic_categories: unknown; is_locked: boolean }[]) {
    if (!analysisHasStorylineTopic(row.topic_categories)) {
      console.warn(`WARN: row ${row.date} has topic_categories but fails analysisHasStorylineTopic check`);
    }
  }

  if (!apply) {
    console.log("\nDry run complete — pass --apply to NULL tiered_articles, article_tags, analyzed_articles.");
    return;
  }

  const updated = await db.execute(sql`
    UPDATE historical_news_analyses
    SET
      tiered_articles = NULL,
      article_tags = NULL,
      analyzed_articles = NULL
    WHERE is_locked = true
      AND topic_categories IS NOT NULL
      AND jsonb_array_length(topic_categories) > 0
      AND (
        tiered_articles IS NOT NULL
        OR article_tags IS NOT NULL
        OR analyzed_articles IS NOT NULL
      )
    RETURNING date::text AS date
  `);

  const after = await measureTargetSizes();
  console.log(
    JSON.stringify(
      {
        rowsStripped: (updated.rows as { date: string }[]).length,
        bytesAfter: {
          tiered_articles: formatBytes(after.tiered_bytes),
          article_tags: formatBytes(after.article_tags_bytes),
          analyzed_articles: formatBytes(after.analyzed_bytes),
          totalStrippedColumns: formatBytes(after.total_json_bytes),
        },
        estimatedSavings: formatBytes(
          Number(before.total_json_bytes) - Number(after.total_json_bytes),
        ),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

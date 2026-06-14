/**
 * Clear only Google check "Happened" (yes) tags — leaves no/uncertain untouched.
 *
 * Sets google_check_happened and google_check_checked_at to NULL for rows where
 * google_check_happened = 'yes'. Also unlocks rows auto-locked on yes
 * (see storage.updateAnalysisGoogleCheck).
 *
 * Usage:
 *   npx tsx server/scripts/clear-yes-google-checks.ts --dry-run
 *   npx tsx server/scripts/clear-yes-google-checks.ts --apply
 */

import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../db";

type CountRow = { count: string };

type BreakdownRow = { google_check_happened: string | null; count: string };

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = true;

  for (const arg of args) {
    if (arg === "--apply") dryRun = false;
    else if (arg === "--dry-run") dryRun = true;
  }

  if (!args.includes("--apply") && !args.includes("--dry-run")) {
    console.log("No mode flag provided; defaulting to --dry-run.");
  }

  return { dryRun };
}

async function countQuery(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute<{ count: string }>(query);
  const row = result.rows[0] as CountRow | undefined;
  return Number(row?.count ?? 0);
}

async function gatherStats() {
  const totalRows = await countQuery(sql`
    SELECT COUNT(*)::text AS count FROM historical_news_analyses
  `);

  const rowsWithYes = await countQuery(sql`
    SELECT COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened = 'yes'
  `);

  const rowsToUnlock = await countQuery(sql`
    SELECT COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened = 'yes'
      AND is_locked = true
  `);

  const otherGoogleChecks = await countQuery(sql`
    SELECT COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened IN ('no', 'uncertain')
  `);

  const breakdownResult = await db.execute<BreakdownRow>(sql`
    SELECT google_check_happened, COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened IS NOT NULL
    GROUP BY google_check_happened
    ORDER BY google_check_happened NULLS LAST
  `);

  const breakdown = (breakdownResult.rows as BreakdownRow[]).map((row) => ({
    happened: row.google_check_happened ?? "(null)",
    count: Number(row.count),
  }));

  return {
    totalRows,
    rowsWithYes,
    rowsToUnlock,
    otherGoogleChecks,
    breakdown,
  };
}

async function applyClear() {
  const result = await db.execute(sql`
    UPDATE historical_news_analyses
    SET
      google_check_happened = NULL,
      google_check_checked_at = NULL,
      is_locked = CASE
        WHEN is_locked = true THEN false
        ELSE is_locked
      END
    WHERE google_check_happened = 'yes'
  `);

  return Number(result.rowCount ?? 0);
}

async function main() {
  const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL or POSTGRES_URL is required.");
    console.error("\nRun this SQL manually:\n");
    console.error(`UPDATE historical_news_analyses
SET
  google_check_happened = NULL,
  google_check_checked_at = NULL,
  is_locked = CASE
    WHEN is_locked = true THEN false
    ELSE is_locked
  END
WHERE google_check_happened = 'yes';`);
    process.exit(1);
  }

  const { dryRun } = parseArgs();
  const before = await gatherStats();

  console.log("=== Clear yes-only Google checks (Happened tags) ===");
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Total rows in historical_news_analyses: ${before.totalRows}`);
  console.log(`Rows with google_check_happened = 'yes' (to clear): ${before.rowsWithYes}`);
  console.log(`Rows to unlock (yes + is_locked): ${before.rowsToUnlock}`);
  console.log(`Rows with no/uncertain (untouched): ${before.otherGoogleChecks}`);

  if (before.breakdown.length > 0) {
    console.log("Current breakdown by google_check_happened:");
    for (const row of before.breakdown) {
      console.log(`  ${row.happened}: ${row.count}`);
    }
  } else {
    console.log("No rows currently have Google check state set.");
  }

  if (dryRun) {
    console.log("\nDry run only — no changes written. Re-run with --apply to execute.");
    return;
  }

  const updated = await applyClear();
  const after = await gatherStats();

  console.log(`\n✅ Applied update to ${updated} row(s).`);
  console.log(`Rows with google_check_happened = 'yes' after apply: ${after.rowsWithYes}`);
  console.log(`Rows with no/uncertain after apply (should be unchanged): ${after.otherGoogleChecks}`);
  console.log(`Locked yes rows remaining: ${after.rowsToUnlock}`);
}

main().catch((error) => {
  console.error("❌ Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

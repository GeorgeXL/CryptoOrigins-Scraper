/**
 * Clear Google check state database-wide so checks can rerun on all rows.
 *
 * Clears google_check_happened and google_check_checked_at for every row that
 * has either set. Also unlocks rows that were auto-locked when Google check
 * returned "yes" (see storage.updateAnalysisGoogleCheck).
 *
 * Usage:
 *   npx tsx server/scripts/clear-all-google-checks.ts --dry-run
 *   npx tsx server/scripts/clear-all-google-checks.ts --apply
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

  const rowsWithGoogleCheck = await countQuery(sql`
    SELECT COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened IS NOT NULL
       OR google_check_checked_at IS NOT NULL
  `);

  const rowsToUnlock = await countQuery(sql`
    SELECT COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened = 'yes'
      AND is_locked = true
  `);

  const breakdownResult = await db.execute<BreakdownRow>(sql`
    SELECT google_check_happened, COUNT(*)::text AS count
    FROM historical_news_analyses
    WHERE google_check_happened IS NOT NULL
       OR google_check_checked_at IS NOT NULL
    GROUP BY google_check_happened
    ORDER BY google_check_happened NULLS LAST
  `);

  const breakdown = (breakdownResult.rows as BreakdownRow[]).map((row) => ({
    happened: row.google_check_happened ?? "(null verdict, checked_at set)",
    count: Number(row.count),
  }));

  return {
    totalRows,
    rowsWithGoogleCheck,
    rowsToUnlock,
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
        WHEN google_check_happened = 'yes' AND is_locked = true THEN false
        ELSE is_locked
      END
    WHERE google_check_happened IS NOT NULL
       OR google_check_checked_at IS NOT NULL
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
    WHEN google_check_happened = 'yes' AND is_locked = true THEN false
    ELSE is_locked
  END
WHERE google_check_happened IS NOT NULL
   OR google_check_checked_at IS NOT NULL;`);
    process.exit(1);
  }

  const { dryRun } = parseArgs();
  const before = await gatherStats();

  console.log("=== Clear all Google checks ===");
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Total rows in historical_news_analyses: ${before.totalRows}`);
  console.log(`Rows with Google check set: ${before.rowsWithGoogleCheck}`);
  console.log(`Rows to clear: ${before.rowsWithGoogleCheck}`);
  console.log(`Rows to unlock (google_check_happened='yes' + is_locked): ${before.rowsToUnlock}`);

  if (before.breakdown.length > 0) {
    console.log("Breakdown by google_check_happened:");
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
  console.log(`Rows with Google check set after apply: ${after.rowsWithGoogleCheck}`);
  console.log(`Locked rows that had google_check_happened='yes' after apply: ${after.rowsToUnlock}`);
}

main().catch((error) => {
  console.error("❌ Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

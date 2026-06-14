/**
 * Backfill is_locked=true on historical_news_analyses for every date that appears
 * in any main_events_check_cache.verification_dates bucket (matched, rejected, pending).
 *
 * Pending dates are included: they are actively in Main Events Check. Review-item UI
 * still treats pending as editable unless is_locked is set; this script aligns DB locks
 * with "part of Main Events Check". Use --final-only to lock matched+rejected only.
 *
 * Usage:
 *   npx tsx server/scripts/lock-all-main-events-check-dates.ts
 *   npx tsx server/scripts/lock-all-main-events-check-dates.ts --dry-run
 *   npx tsx server/scripts/lock-all-main-events-check-dates.ts --apply
 *   npx tsx server/scripts/lock-all-main-events-check-dates.ts --apply --final-only
 */

import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parseVerificationDates } from "../../shared/main-events-review-build";
import {
  backfillMainEventsCheckDayLocksSupabase,
  collectMainEventsCheckDates,
} from "../../shared/main-events-verification-lock";
import { getSupabaseAdmin } from "../lib/supabase-admin";

dotenv.config({ path: path.resolve("client/.env") });

function createScriptSupabaseClient(): SupabaseClient {
  const admin = getSupabaseAdmin();
  if (admin) return admin;

  const url =
    process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase not configured — set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY",
    );
  }

  console.log("Using anon Supabase client (service role not configured)");
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const finalOnly = args.includes("--final-only");
  return { dryRun, finalOnly };
}

async function loadAllVerificationDates(client: SupabaseClient) {
  const { data, error } = await client.from("main_events_check_cache").select("verification_dates");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => parseVerificationDates(row.verification_dates));
}

async function main() {
  const { dryRun, finalOnly } = parseArgs();
  const client = createScriptSupabaseClient();
  const includePending = !finalOnly;

  const verifications = await loadAllVerificationDates(client);
  const dates = collectMainEventsCheckDates(verifications, { includePending });

  console.log(
    dryRun
      ? "=== Main Events Check day lock backfill (DRY RUN) ==="
      : "=== Main Events Check day lock backfill (APPLY) ===",
  );
  console.log(`Cached leaves: ${verifications.length}`);
  console.log(
    `Scope: ${includePending ? "matched + rejected + pending" : "matched + rejected only"}`,
  );
  console.log(`Unique dates in verification_dates: ${dates.length}`);
  console.log("");

  const { summary, results } = await backfillMainEventsCheckDayLocksSupabase(client, dates, {
    dryRun,
  });

  console.log("Summary:");
  console.log(`  Total dates:        ${summary.totalDates}`);
  console.log(`  Already locked:     ${summary.alreadyLocked}`);
  if (dryRun) {
    console.log(`  Would lock:         ${summary.wouldLock}`);
  } else {
    console.log(`  Newly locked:       ${summary.locked}`);
  }
  console.log(`  No analysis row:    ${summary.noAnalysisRow}`);
  console.log("");

  const actionable = results.filter(
    (row) => row.action === "would_lock" || row.action === "locked" || row.action === "no_analysis_row",
  );
  if (actionable.length > 0) {
    console.log("Dates needing attention:");
    for (const row of actionable) {
      console.log(`  ${row.date}: ${row.action}`);
    }
  } else {
    console.log("Nothing to do — all Main Events Check dates with analysis rows are already locked.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

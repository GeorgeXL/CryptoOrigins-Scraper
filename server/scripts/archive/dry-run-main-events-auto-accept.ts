/**
 * Dry-run auto-accept for Main Events Check across all cached leaves.
 *
 * Usage:
 *   npx tsx server/scripts/dry-run-main-events-auto-accept.ts
 *   npx tsx server/scripts/dry-run-main-events-auto-accept.ts --apply
 */

import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { runAutoAcceptCertainMatches } from "../../shared/main-events-auto-accept-run";

dotenv.config({ path: path.resolve("client/.env") });

function createScriptSupabaseClient() {
  const url =
    process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env or root .env",
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = createScriptSupabaseClient();
  const summary = await runAutoAcceptCertainMatches(client, { dryRun: !apply });

  console.log(apply ? "=== Main events auto-accept (APPLIED) ===" : "=== Main events auto-accept (DRY RUN) ===");
  console.log(
    `Leaves processed: ${summary.totals.leavesProcessed} · with candidates: ${summary.totals.leavesWithCandidates}`,
  );
  console.log(
    `Candidate dates: ${summary.totals.candidateDates} · ${apply ? "accepted" : "would accept"}: ${apply ? summary.totals.accepted : summary.totals.candidateDates}`,
  );
  console.log("");

  const withCandidates = summary.leafResults.filter((row) => row.candidates.length > 0);
  if (withCandidates.length === 0) {
    console.log("No auto-accept candidates found.");
    return;
  }

  console.log("Per leaf:");
  for (const row of withCandidates) {
    console.log(`  ${row.leaf}: ${row.candidates.length} (${row.candidates.join(", ")})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

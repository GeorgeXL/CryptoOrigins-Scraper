import type { AutoAcceptBatchSummary } from "@shared/main-events-auto-accept";
import { runAutoAcceptCertainMatches } from "@shared/main-events-auto-accept-run";

import { supabase } from "@/lib/supabase";

function assertSupabase() {
  if (!supabase) throw new Error("Supabase not configured — check client/.env");
  return supabase;
}

export async function autoAcceptCertainMatchesSupabase(opts?: {
  dryRun?: boolean;
}): Promise<AutoAcceptBatchSummary> {
  return runAutoAcceptCertainMatches(assertSupabase(), opts);
}

export async function previewAutoAcceptCertainMatchesSupabase(): Promise<{
  candidateDates: number;
  leavesWithCandidates: number;
}> {
  const summary = await autoAcceptCertainMatchesSupabase({ dryRun: true });
  return {
    candidateDates: summary.totals.candidateDates,
    leavesWithCandidates: summary.totals.leavesWithCandidates,
  };
}

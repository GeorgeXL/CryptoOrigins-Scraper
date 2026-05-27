/**
 * One-shot reset for editorial + agent lab state, and January 2026 day rows.
 *
 * - Deletes all pipeline_runs (cascades steps, handoffs, evidence, confidence_history,
 *   human_review_queue — including review_notes and package "notes").
 * - Deletes autonomous curator rows (agent_sessions → cascades decisions + audit_log).
 * - Deletes historical_news_analyses for 2026-01-01 … 2026-01-31 (cascades pages_and_tags, page_topics).
 *
 * Optional: if a legacy `notes` table exists, truncates it.
 *
 * Usage: npx tsx server/scripts/reset-agents-editorial-jan-2026.ts
 */
import "dotenv/config";
import { and, count, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses, pipelineRuns } from "@shared/schema";

const JAN_2026_FROM = "2026-01-01";
const JAN_2026_TO = "2026-01-31";

async function main() {
  const [{ n: pipelineCount }] = await db.select({ n: count() }).from(pipelineRuns);
  const [{ n: janCount }] = await db
    .select({ n: count() })
    .from(historicalNewsAnalyses)
    .where(and(gte(historicalNewsAnalyses.date, JAN_2026_FROM), lte(historicalNewsAnalyses.date, JAN_2026_TO)));

  console.log(`pipeline_runs before: ${pipelineCount}`);
  console.log(`historical_news_analyses (Jan 2026) before: ${janCount}`);

  await db.delete(pipelineRuns);
  console.log("Cleared pipeline_runs (+ cascaded editorial / human review data).");

  try {
    await db.execute(sql`delete from agent_sessions`);
    console.log("Cleared agent_sessions (+ cascaded agent_decisions / agent_audit_log if present).");
  } catch (e) {
    console.warn("Skipping agent_sessions (table may not exist in this DB):", (e as Error).message);
  }

  try {
    await db.execute(sql`delete from notes`);
    console.log("Cleared legacy notes table (if present).");
  } catch (e) {
    console.warn("No notes table or delete failed (safe to ignore):", (e as Error).message);
  }

  const deleted = await db
    .delete(historicalNewsAnalyses)
    .where(and(gte(historicalNewsAnalyses.date, JAN_2026_FROM), lte(historicalNewsAnalyses.date, JAN_2026_TO)))
    .returning({ date: historicalNewsAnalyses.date });

  console.log(`Deleted ${deleted.length} Jan 2026 analysis row(s).`);
  for (const row of deleted.slice(0, 40)) {
    console.log(`  - ${row.date}`);
  }
  if (deleted.length > 40) console.log(`  … and ${deleted.length - 40} more`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

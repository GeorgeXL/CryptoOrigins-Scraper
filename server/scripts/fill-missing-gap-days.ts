/**
 * Fill calendar-gap days (no analysis row) via editorial pipeline relevance scope.
 *
 * Usage:
 *   npx tsx server/scripts/fill-missing-gap-days.ts
 *   npx tsx server/scripts/fill-missing-gap-days.ts --dates 2013-01-01,2013-03-03
 *   npx tsx server/scripts/fill-missing-gap-days.ts --dry-run
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import path from "node:path";

import { getEditorialPipelineRun, startEditorialPipelineRun } from "../services/editorial-pipeline/run";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

const DEFAULT_DATES = ["2013-01-01", "2013-03-03", "2014-09-28", "2014-11-24", "2014-12-10"];

function parseArgs() {
  const dryRun = process.argv.includes("--dry-run");
  const datesIdx = process.argv.indexOf("--dates");
  const dates =
    datesIdx >= 0 && process.argv[datesIdx + 1]
      ? process.argv[datesIdx + 1]!.split(",").map((d) => d.trim()).filter(Boolean)
      : DEFAULT_DATES;
  return { dryRun, dates };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(runId: string, timeoutMs = 900_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const detail = await getEditorialPipelineRun(runId);
    if (!detail) throw new Error(`Run ${runId} not found`);
    if (detail.run.status !== "running") return detail;
    await sleep(2500);
  }
  throw new Error(`Run ${runId} timed out after ${timeoutMs}ms`);
}

async function runPipelineForDate(date: string, dryRun: boolean) {
  const existing = await storage.getAnalysisByDate(date);
  if (existing?.summary?.trim()) {
    console.log(`Skip ${date} — already has summary (${existing.summary.length} chars)`);
    return { date, status: "skipped" as const };
  }

  if (dryRun) {
    console.log(`[dry-run] would run relevance pipeline for ${date}`);
    return { date, status: "dry-run" as const };
  }

  console.log(`\n=== Pipeline relevance · ${date} ===`);
  const { runId } = await startEditorialPipelineRun({
    dateFrom: date,
    dateTo: date,
    maxDaysToConsider: 1,
    requestedBy: "fill-missing-gap-days",
    checkScopes: ["relevance"],
    targetDates: [date],
    ignoreDayLock: true,
  });
  console.log(`Started run ${runId}`);

  const detail = await waitForRun(runId);
  const err =
    typeof detail.run.stats === "object" &&
    detail.run.stats &&
    "error" in detail.run.stats &&
    typeof detail.run.stats.error === "string"
      ? detail.run.stats.error
      : null;
  console.log(`Run ${runId} finished: ${detail.run.status}${err ? ` (${err})` : ""}`);
  return { date, status: detail.run.status, runId };
}

function runApproveScript(script: string) {
  console.log(`\n>>> ${script}`);
  execFileSync("npx", ["tsx", script], {
    stdio: "inherit",
    cwd: path.resolve("."),
    env: process.env,
  });
}

async function main() {
  const { dryRun, dates } = parseArgs();
  console.log(`${dryRun ? "DRY RUN" : "APPLY"} · ${dates.length} date(s): ${dates.join(", ")}`);

  for (const date of dates) {
    await runPipelineForDate(date, dryRun);
  }

  if (dryRun) {
    console.log("\nDry run complete — no pipeline or approvals executed.");
    return;
  }

  runApproveScript("server/scripts/approve-pending-article-picks.ts");
  runApproveScript("server/scripts/approve-pending-summary-approvals.ts");

  console.log("\n--- Verification ---");
  for (const date of dates) {
    const row = await storage.getAnalysisByDate(date);
    const summary = row?.summary?.trim() ?? "";
    console.log(`${date}: ${row ? "row exists" : "NO ROW"} · summary ${summary ? `${summary.length} chars` : "empty"}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

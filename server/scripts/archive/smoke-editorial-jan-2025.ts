/**
 * Smoke test: January 2025 editorial window (coverage gap in prod DB).
 *
 * Usage:
 *   EDITORIAL_PIPELINE_V3_GATED_FETCH=1 npx tsx server/scripts/smoke-editorial-jan-2025.ts
 *
 * Requires DATABASE_URL, Exa/search keys for gated fetch, optional OPENAI_API_KEY.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { humanReviewQueue } from "@shared/schema";
import {
  getEditorialPipelineRun,
  shadowValidatePipelineWindow,
  startEditorialPipelineRun,
} from "../services/editorial-pipeline/run";

const DATE_FROM = process.env.SMOKE_DATE_FROM?.trim() || "2025-01-01";
const DATE_TO = process.env.SMOKE_DATE_TO?.trim() || "2025-01-10";
const MAX_DAYS = Number(process.env.SMOKE_MAX_DAYS) || 10;
const POLL_MS = 2000;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 600_000;

async function main() {
  console.log("=== Editorial smoke · Jan 2025 window ===");
  console.log({
    DATE_FROM,
    DATE_TO,
    MAX_DAYS,
    EDITORIAL_PIPELINE_ENABLED: process.env.EDITORIAL_PIPELINE_ENABLED ?? "(unset)",
    EDITORIAL_PIPELINE_V3_GATED_FETCH: process.env.EDITORIAL_PIPELINE_V3_GATED_FETCH ?? "(unset)",
  });

  console.log("\n--- 1) Shadow triage ---");
  const shadow = await shadowValidatePipelineWindow({
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    maxDaysToConsider: MAX_DAYS,
  });
  console.log(JSON.stringify(shadow, null, 2));

  console.log("\n--- 2) Pipeline run ---");
  const { runId } = await startEditorialPipelineRun({
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    maxDaysToConsider: MAX_DAYS,
    requestedBy: "smoke-editorial-jan-2025",
  });
  console.log("runId:", runId);

  const deadline = Date.now() + TIMEOUT_MS;
  let lastStepCount = -1;
  while (Date.now() < deadline) {
    const detail = await getEditorialPipelineRun(runId);
    if (!detail) {
      console.error("Run not found");
      process.exit(4);
    }
    const run = detail.run as { status: string; stats?: Record<string, unknown> };
    if (detail.steps.length !== lastStepCount) {
      lastStepCount = detail.steps.length;
      console.log(
        JSON.stringify({
          status: run.status,
          steps: detail.steps.length,
          last: detail.steps.at(-1)?.agentName,
          lastStatus: detail.steps.at(-1)?.status,
        }),
      );
    }
    if (run.status !== "running") {
      console.log("\n--- run.stats ---");
      console.log(JSON.stringify(run.stats ?? {}, null, 2));
      console.log("Final run status:", run.status);
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  console.log("\n--- 3) human_review_queue (pending in window) ---");
  const pending = await db
    .select({
      id: humanReviewQueue.id,
      eventDate: humanReviewQueue.eventDate,
      status: humanReviewQueue.status,
      package: humanReviewQueue.package,
    })
    .from(humanReviewQueue)
    .where(eq(humanReviewQueue.status, "pending"));

  const inWindow = pending.filter((r) => {
    const d = String(r.eventDate ?? "").slice(0, 10);
    return d >= DATE_FROM && d <= DATE_TO;
  });

  for (const row of inWindow) {
    const pkg = row.package as { phase?: string; triage?: { route?: string } } | null;
    console.log(
      JSON.stringify({
        id: row.id,
        date: row.eventDate,
        phase: pkg?.phase ?? "legacy",
        route: pkg?.triage?.route,
      }),
    );
  }
  console.log(`Pending in window: ${inWindow.length}`);

  if (inWindow.length === 0) {
    console.warn("WARN: no pending queue rows in window (check run stats or V3_GATED_FETCH=1)");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});

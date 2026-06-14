/**
 * One-off / CI helper: start an editorial pipeline run for a short date window and poll until terminal status.
 * Usage: npx tsx server/scripts/smoke-editorial-short-range.ts
 * Requires DATABASE_URL or POSTGRES_URL (and OPENAI_API_KEY if the run reaches generateManagerNarrative).
 */
import "dotenv/config";
import { getEditorialPipelineRun, startEditorialPipelineRun } from "../services/editorial-pipeline/run";

const DATE_FROM = "2010-01-01";
const DATE_TO = "2010-01-05";
const MAX_DAYS = 5;
const POLL_MS = 1500;
const TIMEOUT_MS = 120_000;

async function main() {
  const { runId } = await startEditorialPipelineRun({
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    maxDaysToConsider: MAX_DAYS,
    requestedBy: "smoke-editorial-short-range",
  });
  console.log(`Started run ${runId} (${DATE_FROM} → ${DATE_TO}, maxDays=${MAX_DAYS})`);

  const deadline = Date.now() + TIMEOUT_MS;
  let lastLine = "";
  while (Date.now() < deadline) {
    const detail = await getEditorialPipelineRun(runId);
    if (!detail) {
      console.error("Run not found");
      process.exit(4);
    }
    const run = detail.run as { status: string; stats?: Record<string, unknown> };
    const line = JSON.stringify({
      t: new Date().toISOString(),
      status: run.status,
      steps: detail.steps.length,
      handoffs: detail.handoffs.length,
    });
    if (line !== lastLine) {
      lastLine = line;
      console.log(line);
    }
    if (run.status !== "running") {
      console.log("--- run.stats ---");
      console.log(JSON.stringify(run.stats ?? {}, null, 2));
      console.log("Final:", run.status);
      process.exit(run.status === "completed" ? 0 : 1);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.error("Timed out waiting for run");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});

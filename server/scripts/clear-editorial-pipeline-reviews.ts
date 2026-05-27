/**
 * Deletes all editorial pipeline runs and related rows (steps, handoffs, evidence,
 * confidence history, human_review_queue) via FK cascade from pipeline_runs.
 * Does not touch historical_news_analyses or day summaries.
 */
import "dotenv/config";
import { db } from "../db";
import { pipelineRuns } from "@shared/schema";

async function main() {
  await db.delete(pipelineRuns);
  console.log("Cleared pipeline_runs and cascaded editorial review data.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

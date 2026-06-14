/**
 * Purge editorial pipeline history tables.
 * Does NOT touch historical_news_analyses or pages_and_tags.
 *
 * FK order: all child tables cascade from pipeline_runs. Deleting runs
 * removes pipeline_confidence_history, pipeline_steps, human_review_queue,
 * pipeline_evidence, and pipeline_handoffs.
 *
 * Usage:
 *   npx tsx server/scripts/purge-pipeline-history.ts           # dry-run (default)
 *   npx tsx server/scripts/purge-pipeline-history.ts --apply
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "../db";

function parseArgs() {
  return { apply: process.argv.includes("--apply") };
}

type CountRow = { table_name: string; row_count: number };

async function countPipelineTables(): Promise<CountRow[]> {
  const result = await db.execute<CountRow>(sql`
    SELECT 'pipeline_confidence_history' AS table_name, COUNT(*)::int AS row_count FROM pipeline_confidence_history
    UNION ALL
    SELECT 'pipeline_evidence', COUNT(*)::int FROM pipeline_evidence
    UNION ALL
    SELECT 'pipeline_handoffs', COUNT(*)::int FROM pipeline_handoffs
    UNION ALL
    SELECT 'human_review_queue', COUNT(*)::int FROM human_review_queue
    UNION ALL
    SELECT 'pipeline_steps', COUNT(*)::int FROM pipeline_steps
    UNION ALL
    SELECT 'pipeline_runs', COUNT(*)::int FROM pipeline_runs
  `);
  return result.rows as CountRow[];
}

async function main() {
  const { apply } = parseArgs();
  const counts = await countPipelineTables();
  const totalRows = counts.reduce((sum, r) => sum + r.row_count, 0);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        tables: Object.fromEntries(counts.map((r) => [r.table_name, r.row_count])),
        totalRowsAcrossTables: totalRows,
        note: "Deleting pipeline_runs cascades to all child pipeline tables.",
      },
      null,
      2,
    ),
  );

  if (totalRows === 0) {
    console.log("\nPipeline tables already empty.");
    return;
  }

  if (!apply) {
    console.log("\nDry run complete — pass --apply to delete all pipeline_runs (cascade).");
    return;
  }

  const deleted = await db.execute(sql`
    DELETE FROM pipeline_runs RETURNING id
  `);

  const after = await countPipelineTables();
  console.log(
    JSON.stringify(
      {
        pipelineRunsDeleted: (deleted.rows as { id: string }[]).length,
        remaining: Object.fromEntries(after.map((r) => [r.table_name, r.row_count])),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

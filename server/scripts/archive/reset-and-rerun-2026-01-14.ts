import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { rerunPipelineForDate } from "../services/editorial-pipeline/approved-writer";

async function main() {
  const deleted = await db.execute(
    sql.raw(`
      delete from human_review_queue
      where event_date = '2026-01-14' and status = 'pending'
      returning id
    `),
  );
  console.log(`deleted pending queue rows: ${deleted.rowCount ?? 0}`);

  const out = await rerunPipelineForDate({ date: "2026-01-14", reviewer: "codex" });
  console.log(out);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
  const res = await db.execute(sql.raw("select count(*)::int as n from human_review_queue"));
  const n = (res.rows?.[0] as { n?: number } | undefined)?.n ?? 0;
  console.log(`human_review_queue count: ${n}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
  const res = await db.execute(
    sql.raw(`
      select
        id,
        status,
        package->>'phase' as phase,
        package->'proposedTags' as proposed_tags,
        package->'proposedTopics' as proposed_topics,
        package->'winningArticle'->>'title' as winning_title
      from human_review_queue
      where event_date = '2026-01-14'
      order by created_at desc
      limit 3
    `),
  );
  console.log(res.rows ?? []);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


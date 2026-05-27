import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
  const before = await db.execute(sql`
    select count(*)::int as total,
           count(review_notes)::int as with_review_notes
    from human_review_queue
  `);
  const beforeRow = (before.rows?.[0] ?? { total: 0, with_review_notes: 0 }) as {
    total: number;
    with_review_notes: number;
  };

  await db.execute(sql`
    update human_review_queue
    set review_notes = null,
        package = case
          when package ? 'notes' then package - 'notes'
          else package
        end
  `);

  let legacyNotesCleared = 0;
  try {
    const legacy = await db.execute(sql`delete from notes`);
    legacyNotesCleared = legacy.rowCount ?? 0;
  } catch {
    legacyNotesCleared = 0;
  }

  const after = await db.execute(sql`
    select count(*)::int as total,
           count(review_notes)::int as with_review_notes
    from human_review_queue
  `);
  const afterRow = (after.rows?.[0] ?? { total: 0, with_review_notes: 0 }) as {
    total: number;
    with_review_notes: number;
  };

  console.log("Agent notes cleanup complete.");
  console.log(`human_review_queue rows: ${beforeRow.total}`);
  console.log(`review_notes before: ${beforeRow.with_review_notes}`);
  console.log(`review_notes after: ${afterRow.with_review_notes}`);
  console.log(`legacy notes rows cleared: ${legacyNotesCleared}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


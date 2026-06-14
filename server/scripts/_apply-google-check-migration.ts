import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
  await db.execute(sql.raw(`
ALTER TABLE historical_news_analyses
ADD COLUMN IF NOT EXISTS google_check_happened TEXT,
ADD COLUMN IF NOT EXISTS google_check_checked_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_historical_news_google_check_happened
ON historical_news_analyses(google_check_happened);
  `));
  console.log("migration applied");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

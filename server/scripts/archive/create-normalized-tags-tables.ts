/**
 * Utility script to create the `tags` and `pages_and_tags` tables directly via SQL.
 * Use this when drizzle-kit prompts for interactive confirmation (not ideal in CI/automation).
 *
 * Run with:
 *   npx tsx server/scripts/create-normalized-tags-tables.ts
 */

import "dotenv/config";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("❌ DATABASE_URL or POSTGRES_URL not set!");
  process.exit(1);
}

function cleanConnectionString(raw: string): string {
  let cleanConnectionString = raw.split(/\s+/)[0].replace(/"/g, "");
  cleanConnectionString = cleanConnectionString.replace(/[?&]supa=[^&]*/g, "");
  cleanConnectionString = cleanConnectionString.replace(/\?&/, "?");

  if (!cleanConnectionString.includes("sslmode=")) {
    const separator = cleanConnectionString.includes("?") ? "&" : "?";
    cleanConnectionString += `${separator}sslmode=require`;
  }

  return cleanConnectionString;
}

const TAGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  normalized_name text,
  parent_tag_id uuid REFERENCES tags(id) ON DELETE SET NULL,
  subcategory_path text[],
  usage_count integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_category ON tags (name, category);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags (category);
CREATE INDEX IF NOT EXISTS idx_tags_parent_tag ON tags (parent_tag_id);
CREATE INDEX IF NOT EXISTS idx_tags_normalized_name ON tags (normalized_name);
`;

const PAGES_AND_TAGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS pages_and_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES historical_news_analyses(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_and_tags_unique ON pages_and_tags (analysis_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_pages_and_tags_analysis ON pages_and_tags (analysis_id);
CREATE INDEX IF NOT EXISTS idx_pages_and_tags_tag ON pages_and_tags (tag_id);
`;

async function run() {
  const pool = new Pool({
    connectionString: cleanConnectionString(databaseUrl),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  console.log("🔧 Connecting to database...");

  const client = await pool.connect();
  try {
    console.log("🛠️  Creating `tags` table (if not exists)...");
    await client.query(TAGS_TABLE_SQL);
    console.log("✅ `tags` table ready");

    console.log("🛠️  Creating `pages_and_tags` table (if not exists)...");
    await client.query(PAGES_AND_TAGS_TABLE_SQL);
    console.log("✅ `pages_and_tags` table ready");

    console.log("🎉 Normalized tags tables are ready!");
  } catch (error) {
    console.error("❌ Failed to create tables:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});


/**
 * Export all Perplexity-flagged dates: didn't happen (no) and uncertain.
 *
 * Usage:
 *   npx tsx server/scripts/export-no-and-uncertain-csv.ts
 *   npx tsx server/scripts/export-no-and-uncertain-csv.ts --output tmp/no-and-uncertain-events.csv
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";

import { db } from "../db";

dotenv.config({ path: path.resolve("client/.env") });

type ExportRow = {
  date: string;
  status: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const outputArg = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  return {
    outputPath: outputArg
      ? path.resolve(outputArg)
      : path.resolve("tmp/no-and-uncertain-events.csv"),
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvLine(row: ExportRow): string {
  return csvEscape(row.date);
}

async function fetchRows(): Promise<ExportRow[]> {
  const result = await db.execute<ExportRow>(sql`
    SELECT
      h.date::text AS date,
      h.google_check_happened AS status
    FROM historical_news_analyses h
    WHERE h.google_check_happened IN ('no', 'uncertain')
    ORDER BY h.date ASC
  `);

  return result.rows as ExportRow[];
}

async function main() {
  const { outputPath } = parseArgs();
  const rows = await fetchRows();

  const noCount = rows.filter((r) => r.status === "no").length;
  const uncertainCount = rows.filter((r) => r.status === "uncertain").length;

  const csv = `${rows.map(rowToCsvLine).join("\n")}\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv, "utf-8");

  console.log(`Exported ${rows.length} row(s) to ${outputPath}`);
  console.log(`  didn't happen (no): ${noCount}`);
  console.log(`  uncertain: ${uncertainCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

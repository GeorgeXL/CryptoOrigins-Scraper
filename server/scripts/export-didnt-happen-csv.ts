/**
 * Export all events marked as "didn't happen" (google_check_happened = 'no').
 *
 * Usage:
 *   npx tsx server/scripts/export-didnt-happen-csv.ts
 *   npx tsx server/scripts/export-didnt-happen-csv.ts --output tmp/didnt-happen-events.csv
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
  summary: string;
};

const CSV_COLUMNS = ["date", "summary"] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const outputArg = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  const defaultOutput = path.resolve("tmp/didnt-happen-events.csv");

  return {
    outputPath: outputArg ? path.resolve(outputArg) : defaultOutput,
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvLine(row: ExportRow): string {
  return [row.date, row.summary].map((cell) => csvEscape(String(cell))).join(",");
}

async function fetchRows(): Promise<ExportRow[]> {
  const result = await db.execute<ExportRow>(sql`
    SELECT
      h.date::text AS date,
      h.summary
    FROM historical_news_analyses h
    WHERE h.google_check_happened = 'no'
    ORDER BY h.date ASC
  `);

  return result.rows as ExportRow[];
}

async function main() {
  const { outputPath } = parseArgs();

  const rows = await fetchRows();
  const header = CSV_COLUMNS.join(",");
  const body = rows.map(rowToCsvLine).join("\n");
  const csv = `${header}\n${body}\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv, "utf-8");

  console.log(`Exported ${rows.length} row(s) to ${outputPath}`);
  console.log(`Columns: ${CSV_COLUMNS.join(", ")}`);
  if (rows.length > 0) {
    console.log("First 3 rows:");
    for (const row of rows.slice(0, 3)) {
      console.log(
        JSON.stringify({
          date: row.date,
          summary: row.summary.slice(0, 120) + (row.summary.length > 120 ? "…" : ""),
        }),
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

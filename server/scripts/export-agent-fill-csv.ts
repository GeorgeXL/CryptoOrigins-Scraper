/**
 * Simple CSV for external agents: one row per empty unlocked day.
 * Agent fills summary, source_url, and tier — nothing else.
 *
 * Usage:
 *   npx tsx server/scripts/export-agent-fill-csv.ts
 *   npx tsx server/scripts/export-agent-fill-csv.ts --output ~/Downloads/agent-fill-days.csv
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { asc, and, eq, or, sql } from "drizzle-orm";

import { historicalNewsAnalyses } from "@shared/schema";
import { db } from "../db";

dotenv.config({ path: path.resolve("client/.env") });

const COLUMNS = ["date", "summary", "source_url", "tier"] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const outputArg = outputIdx >= 0 ? args[outputIdx + 1] : undefined;
  return {
    outputPath: outputArg ? path.resolve(outputArg) : path.resolve("tmp/agent-fill-days.csv"),
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main() {
  const { outputPath } = parseArgs();

  const rows = await db
    .select({ date: historicalNewsAnalyses.date })
    .from(historicalNewsAnalyses)
    .where(
      and(
        eq(historicalNewsAnalyses.isLocked, false),
        or(
          sql`${historicalNewsAnalyses.summary} IS NULL`,
          sql`trim(${historicalNewsAnalyses.summary}) = ''`,
        ),
      ),
    )
    .orderBy(asc(historicalNewsAnalyses.date));

  const lines = [
    COLUMNS.join(","),
    ...rows.map((row) => [row.date, "", "", ""].map(csvEscape).join(",")),
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf-8");

  console.log(`Exported ${rows.length} empty unlocked day(s) to ${outputPath}`);
  console.log(`Columns: ${COLUMNS.join(", ")}`);
  console.log("Agent fills: summary, source_url, tier (bitcoin | crypto | macro). Leave all three blank if no event.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

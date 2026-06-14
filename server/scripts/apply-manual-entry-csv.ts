/**
 * Apply manual entries from a minimal CSV: date, summary, source_url
 * Keeps the row's existing storyline topic; does not change verify/lock status.
 *
 * Usage:
 *   npx tsx server/scripts/apply-manual-entry-csv.ts --dry-run tmp/enriched-manual.csv
 *   npx tsx server/scripts/apply-manual-entry-csv.ts --apply tmp/enriched-manual.csv
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import type { InsertHistoricalNewsAnalysis } from "@shared/schema";
import {
  buildManualArticle,
  normalizeManualSourceUrl,
  validateManualDayEntryInputs,
} from "../../shared/manual-day-entry-build";
import { evaluateSummaryQuality } from "../services/editorial-pipeline/editorial-quality";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

type CsvRow = {
  date: string;
  summary: string;
  source_url: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const fileArg = args.find((arg) => !arg.startsWith("--") && arg.endsWith(".csv"));
  if (!fileArg) {
    throw new Error("Pass a CSV path: --dry-run tmp/enriched-manual.csv");
  }
  return { csvPath: path.resolve(fileArg), dryRun };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const summaryIdx = header.indexOf("summary");
  const sourceIdx = header.indexOf("source_url");
  if (dateIdx < 0 || summaryIdx < 0 || sourceIdx < 0) {
    throw new Error("CSV must have columns: date, summary, source_url");
  }

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const date = cells[dateIdx]?.trim() ?? "";
    const summary = cells[summaryIdx]?.trim() ?? "";
    const source_url = cells[sourceIdx]?.trim() ?? "";
    if (!date && !summary && !source_url) continue;
    rows.push({ date, summary, source_url });
  }
  return rows;
}

function firstTopicLabel(topicCategories: unknown): string | null {
  if (!Array.isArray(topicCategories)) return null;
  for (const item of topicCategories) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object" && "label" in item) {
      const label = (item as { label?: unknown }).label;
      if (typeof label === "string" && label.trim()) return label.trim();
    }
  }
  return null;
}

async function main() {
  const { csvPath, dryRun } = parseArgs();
  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));

  if (rows.length === 0) {
    console.log("No data rows in CSV");
    return;
  }

  if (dryRun) console.log("DRY RUN — no DB writes\n");

  let applied = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.date || !row.summary || !row.source_url) {
      console.log(`${row.date || "(blank)"} — skip (missing date, summary, or source_url)`);
      skipped += 1;
      continue;
    }

    const quality = evaluateSummaryQuality(row.summary);
    if (quality) {
      console.log(`${row.date} — skip (${quality.message})`);
      skipped += 1;
      continue;
    }

    const existing = await storage.getAnalysisByDate(row.date);
    if (!existing) {
      console.log(`${row.date} — skip (no row)`);
      skipped += 1;
      continue;
    }

    const topic = firstTopicLabel(existing.topicCategories);
    if (!topic) {
      console.log(`${row.date} — skip (no existing topic on row)`);
      skipped += 1;
      continue;
    }

    try {
      validateManualDayEntryInputs({ date: row.date, summary: row.summary, topic });
      const sourceUrl = normalizeManualSourceUrl(row.source_url);
      const manualArticle = buildManualArticle({
        date: row.date,
        sourceUrl,
        summary: row.summary,
      });

      if (dryRun) {
        console.log(`${row.date} — would apply manual entry · ${topic}`);
        applied += 1;
        continue;
      }

      const payload: Partial<InsertHistoricalNewsAnalysis> = {
        summary: row.summary,
        topArticleId: sourceUrl,
        isManualOverride: true,
        isOrphan: false,
        aiProvider: "manual",
        reasoning: "Manual entry from enriched CSV",
        confidenceScore: "100",
        winningTier: "manual",
        tierUsed: "manual",
        tieredArticles: { bitcoin: [manualArticle], crypto: [], macro: [] },
        analyzedArticles: [manualArticle],
        totalArticlesFetched: 1,
        uniqueArticlesAnalyzed: 1,
        geminiApproved: false,
        perplexityApproved: false,
      };

      await storage.updateAnalysis(row.date, payload);
      console.log(`${row.date} — applied ✓`);
      applied += 1;
    } catch (err) {
      console.log(`${row.date} — skip (${err instanceof Error ? err.message : String(err)})`);
      skipped += 1;
    }
  }

  console.log(`\nDone: ${applied} ${dryRun ? "would apply" : "applied"} · ${skipped} skipped · ${rows.length} total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

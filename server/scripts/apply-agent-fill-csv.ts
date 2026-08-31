/**
 * Import agent-filled CSV (date, summary, source_url, tier).
 *
 * Usage:
 *   npx tsx server/scripts/apply-agent-fill-csv.ts --dry-run ~/Downloads/agent-fill-days.csv
 *   npx tsx server/scripts/apply-agent-fill-csv.ts --apply ~/Downloads/agent-fill-days.csv
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import type { ArticleData, TieredArticles } from "@shared/schema";
import { buildManualArticle, normalizeManualSourceUrl } from "@shared/manual-day-entry-build";
import { evaluateSummaryQuality, normalizeEditorialSummaryText } from "../services/editorial-pipeline/editorial-quality";
import { ensureTopicCategoryAndStorylineLinks } from "../services/editorial-pipeline/storyline-taxonomy";
import { suggestTopicsWithAgent } from "../services/editorial-pipeline/topic-agent";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

type CsvRow = {
  date: string;
  summary: string;
  source_url: string;
  tier: string;
};

const VALID_TIERS = new Set(["bitcoin", "crypto", "macro"]);

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const fileArg = args.find((arg) => !arg.startsWith("--") && arg.endsWith(".csv"));
  if (!fileArg) {
    throw new Error("Pass a CSV path: --dry-run path.csv or --apply path.csv");
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
  const tierIdx = header.indexOf("tier");
  if (dateIdx < 0 || summaryIdx < 0 || sourceIdx < 0 || tierIdx < 0) {
    throw new Error("CSV must have columns: date, summary, source_url, tier");
  }

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    rows.push({
      date: cells[dateIdx]?.trim() ?? "",
      summary: cells[summaryIdx]?.trim() ?? "",
      source_url: cells[sourceIdx]?.trim() ?? "",
      tier: cells[tierIdx]?.trim().toLowerCase() ?? "",
    });
  }
  return rows;
}

function tieredArticlesForTier(tier: "bitcoin" | "crypto" | "macro", article: ArticleData): TieredArticles {
  return {
    bitcoin: tier === "bitcoin" ? [article] : [],
    crypto: tier === "crypto" ? [article] : [],
    macro: tier === "macro" ? [article] : [],
  };
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
    if (!row.summary && !row.source_url && !row.tier) {
      skipped += 1;
      continue;
    }

    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      console.log(`${row.date || "(blank)"} — skip (invalid date)`);
      skipped += 1;
      continue;
    }

    if (!row.summary || !row.source_url || !row.tier) {
      console.log(`${row.date} — skip (summary, source_url, and tier must all be filled together)`);
      skipped += 1;
      continue;
    }

    if (!VALID_TIERS.has(row.tier)) {
      console.log(`${row.date} — skip (tier must be bitcoin, crypto, or macro)`);
      skipped += 1;
      continue;
    }

    const summary = normalizeEditorialSummaryText(row.summary);
    const quality = evaluateSummaryQuality(summary);
    if (quality) {
      console.log(`${row.date} — skip (${quality.message})`);
      skipped += 1;
      continue;
    }

    const existing = await storage.getAnalysisByDate(row.date);
    if (!existing) {
      console.log(`${row.date} — skip (no analysis row in database)`);
      skipped += 1;
      continue;
    }

    if (existing.isLocked) {
      console.log(`${row.date} — skip (day is locked)`);
      skipped += 1;
      continue;
    }

    try {
      const sourceUrl = normalizeManualSourceUrl(row.source_url);
      const tier = row.tier as "bitcoin" | "crypto" | "macro";
      const manualArticle = buildManualArticle({
        date: row.date,
        sourceUrl,
        summary,
      });
      const tieredArticles = tieredArticlesForTier(tier, manualArticle);

      const topicResult = await suggestTopicsWithAgent({
        date: row.date,
        summary,
        tags: [],
        currentTopics: [],
        sourceSnippet: manualArticle.title,
      });
      const topicLabel = topicResult.recommended ?? topicResult.proposed[0];
      if (!topicLabel) {
        console.log(`${row.date} — skip (could not assign storyline topic)`);
        skipped += 1;
        continue;
      }

      const linkedTopics = await ensureTopicCategoryAndStorylineLinks(row.date, [topicLabel]);

      if (dryRun) {
        console.log(`${row.date} — would apply · ${tier} · ${topicLabel}`);
        applied += 1;
        continue;
      }

      await storage.updateAnalysis(row.date, {
        summary,
        topArticleId: sourceUrl,
        isManualOverride: true,
        reasoning: `Agent CSV import (${tier} tier)`,
        winningTier: tier,
        tierUsed: "manual",
        tieredArticles,
        analyzedArticles: [manualArticle],
        topicCategories: linkedTopics,
      });

      console.log(`${row.date} — applied ✓ · ${tier} · ${linkedTopics[0] ?? topicLabel}`);
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

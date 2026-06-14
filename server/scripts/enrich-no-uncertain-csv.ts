/**
 * Enrich no/uncertain rows via Perplexity (Bitcoin → crypto → macro) + OpenAI summary.
 * Writes a minimal review CSV: date, summary, source_url
 *
 * Usage:
 *   npx tsx server/scripts/enrich-no-uncertain-csv.ts --limit 5
 *   npx tsx server/scripts/enrich-no-uncertain-csv.ts --output tmp/enriched-manual.csv --resume
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";

import type { ArticleData } from "@shared/schema";
import { db } from "../db";
import { evaluateSummaryQuality } from "../services/editorial-pipeline/editorial-quality";
import { generateSummaryWithOpenAI } from "../services/analysis-modes";
import { researchSignificantEventForDate } from "../services/homepage-checks/perplexity-day-research";

dotenv.config({ path: path.resolve("client/.env") });

const CSV_COLUMNS = ["date", "summary", "source_url"] as const;
const STATE_DIR = path.resolve("tmp/perplexity-enrich");
const DEFAULT_OUTPUT = path.resolve("tmp/enriched-manual.csv");
const DEFAULT_DELAY_MS = 1500;

type InputRow = {
  date: string;
  summary: string;
  topicLeaf: string | null;
};

type OutputRow = {
  date: string;
  summary: string;
  source_url: string;
};

type StateFile = {
  processedDates: string[];
  rows: OutputRow[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const limitIdx = args.indexOf("--limit");
  const dateIdx = args.indexOf("--date");
  const delayIdx = args.indexOf("--delay-ms");

  return {
    outputPath: outputIdx >= 0 ? path.resolve(args[outputIdx + 1] ?? DEFAULT_OUTPUT) : DEFAULT_OUTPUT,
    limit: limitIdx >= 0 ? Number(args[limitIdx + 1]) : null,
    date: dateIdx >= 0 ? args[dateIdx + 1] : null,
    resume: args.includes("--resume"),
    delayMs: delayIdx >= 0 ? Number(args[delayIdx + 1]) : DEFAULT_DELAY_MS,
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowsToCsv(rows: OutputRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((row) =>
    [row.date, row.summary, row.source_url].map((cell) => csvEscape(cell)).join(","),
  );
  return `${header}\n${body.join("\n")}\n`;
}

function loadState(statePath: string): StateFile {
  if (!fs.existsSync(statePath)) {
    return { processedDates: [], rows: [] };
  }
  return JSON.parse(fs.readFileSync(statePath, "utf-8")) as StateFile;
}

function saveState(statePath: string, state: StateFile) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRows(singleDate: string | null): Promise<InputRow[]> {
  const result = singleDate
    ? await db.execute<InputRow>(sql`
        SELECT
          h.date::text AS date,
          COALESCE(h.summary, '') AS summary,
          (
            SELECT value
            FROM jsonb_array_elements_text(COALESCE(h.topic_categories, '[]'::jsonb)) AS value
            LIMIT 1
          ) AS "topicLeaf"
        FROM historical_news_analyses h
        WHERE h.date = ${singleDate}::date
          AND h.google_check_happened IN ('no', 'uncertain')
      `)
    : await db.execute<InputRow>(sql`
        SELECT
          h.date::text AS date,
          COALESCE(h.summary, '') AS summary,
          (
            SELECT value
            FROM jsonb_array_elements_text(COALESCE(h.topic_categories, '[]'::jsonb)) AS value
            LIMIT 1
          ) AS "topicLeaf"
        FROM historical_news_analyses h
        WHERE h.google_check_happened IN ('no', 'uncertain')
        ORDER BY h.date ASC
      `);

  return result.rows as InputRow[];
}

async function buildSummary(
  date: string,
  research: Awaited<ReturnType<typeof researchSignificantEventForDate>>,
): Promise<string | null> {
  if (!research.sourceUrl || !research.eventSnippet) return null;

  const article: ArticleData = {
    id: research.sourceUrl,
    title: research.eventTitle ?? research.sourceTitle ?? "News article",
    url: research.sourceUrl,
    publishedDate: date,
    text: research.eventSnippet,
    summary: research.eventSnippet,
    source: research.sourceTitle ?? "Perplexity",
  };

  const tier = research.tier ?? "bitcoin";
  const out = await generateSummaryWithOpenAI(
    article.id,
    [article],
    date,
    tier,
    `enrich-${date}-${Date.now()}`,
  );

  const quality = evaluateSummaryQuality(out.summary);
  if (quality) {
    console.log(`  skip summary — ${quality.message}`);
    return null;
  }

  return out.summary;
}

async function main() {
  const { outputPath, limit, date: singleDate, resume, delayMs } = parseArgs();
  const statePath = path.join(STATE_DIR, "state.json");

  const state = resume ? loadState(statePath) : { processedDates: [], rows: [] };
  const processed = new Set(state.processedDates);

  let rows = await fetchRows(singleDate);
  rows = rows.filter((row) => !processed.has(row.date));
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    rows = rows.slice(0, limit);
  }

  console.log(`Enriching ${rows.length} row(s) → ${outputPath}`);
  console.log(`Columns: ${CSV_COLUMNS.join(", ")}`);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    console.log(`\n${row.date} …`);

    try {
      const research = await researchSignificantEventForDate(row.date, {
        priorSummary: row.summary || undefined,
        topicLeaf: row.topicLeaf,
      });

      if (!research.found || !research.sourceUrl) {
        console.log(`  skip — ${research.reasoning || "no accepted event"}`);
        skipped += 1;
        processed.add(row.date);
        state.processedDates.push(row.date);
        saveState(statePath, state);
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }

      const summary = await buildSummary(row.date, research);
      if (!summary) {
        skipped += 1;
        processed.add(row.date);
        state.processedDates.push(row.date);
        saveState(statePath, state);
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }

      const outputRow: OutputRow = {
        date: row.date,
        summary,
        source_url: research.sourceUrl,
      };

      state.rows.push(outputRow);
      state.processedDates.push(row.date);
      processed.add(row.date);
      added += 1;

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, rowsToCsv(state.rows), "utf-8");
      saveState(statePath, state);

      console.log(`  ✓ ${summary.length} chars · ${research.tier} · ${research.sourceUrl}`);
    } catch (err) {
      console.log(`  error — ${err instanceof Error ? err.message : String(err)}`);
      skipped += 1;
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  console.log(`\nDone: ${added} written · ${skipped} skipped · ${state.rows.length} total in CSV`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

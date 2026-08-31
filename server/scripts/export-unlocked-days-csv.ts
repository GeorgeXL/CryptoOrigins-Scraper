/**
 * Export unlocked days for external AI review / re-import planning.
 *
 * Usage:
 *   npx tsx server/scripts/export-unlocked-days-csv.ts
 *   npx tsx server/scripts/export-unlocked-days-csv.ts --output tmp/unlocked-days-review.csv
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { asc, and, eq, or, sql } from "drizzle-orm";

import { historicalNewsAnalyses, type ArticleData, type TieredArticles } from "@shared/schema";
import { db } from "../db";
import { resolveStoredWinningArticle } from "../services/editorial-pipeline/run";

dotenv.config({ path: path.resolve("client/.env") });

const CSV_COLUMNS = [
  "date",
  "summary",
  "top_article_url",
  "top_article_title",
  "winning_tier",
  "topic",
  "bitcoin_articles",
  "crypto_articles",
  "macro_articles",
  "proposed_summary",
  "proposed_winning_article_url",
  "proposed_winning_tier",
] as const;

type ExportRow = Record<(typeof CSV_COLUMNS)[number], string>;

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf("--output");
  const outputArg = outputIdx >= 0 ? args[outputIdx + 1] : undefined;
  const emptySummaryOnly = args.includes("--empty-summary-only");
  const defaultName = emptySummaryOnly ? "unlocked-empty-summary-days.csv" : "unlocked-days-review.csv";
  return {
    outputPath: outputArg ? path.resolve(outputArg) : path.resolve("tmp", defaultName),
    emptySummaryOnly,
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvLine(row: ExportRow): string {
  return CSV_COLUMNS.map((col) => csvEscape(row[col] ?? "")).join(",");
}

function firstTopicLabel(topicCategories: unknown): string {
  if (!Array.isArray(topicCategories)) return "";
  for (const item of topicCategories) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object" && "label" in item) {
      const label = (item as { label?: unknown }).label;
      if (typeof label === "string" && label.trim()) return label.trim();
    }
  }
  return "";
}

function formatTierArticles(articles: ArticleData[] | undefined): string {
  if (!articles?.length) return "";
  return articles
    .map((article) => {
      const url = String(article.url ?? article.id ?? "").trim();
      const title = String(article.title ?? "").trim().replace(/\s+/g, " ");
      if (!url) return "";
      return title ? `${url}|${title}` : url;
    })
    .filter(Boolean)
    .join(";;");
}

function tieredFromRow(tieredArticles: unknown): TieredArticles {
  if (!tieredArticles || typeof tieredArticles !== "object") {
    return { bitcoin: [], crypto: [], macro: [] };
  }
  const raw = tieredArticles as Partial<TieredArticles>;
  return {
    bitcoin: Array.isArray(raw.bitcoin) ? (raw.bitcoin as ArticleData[]) : [],
    crypto: Array.isArray(raw.crypto) ? (raw.crypto as ArticleData[]) : [],
    macro: Array.isArray(raw.macro) ? (raw.macro as ArticleData[]) : [],
  };
}

async function fetchRows(emptySummaryOnly: boolean): Promise<ExportRow[]> {
  const rows = await db
    .select()
    .from(historicalNewsAnalyses)
    .where(
      emptySummaryOnly
        ? and(
            eq(historicalNewsAnalyses.isLocked, false),
            or(
              sql`${historicalNewsAnalyses.summary} IS NULL`,
              sql`trim(${historicalNewsAnalyses.summary}) = ''`,
            ),
          )
        : eq(historicalNewsAnalyses.isLocked, false),
    )
    .orderBy(asc(historicalNewsAnalyses.date));

  return rows.map((row) => {
    const tiered = tieredFromRow(row.tieredArticles);
    const winner = resolveStoredWinningArticle({
      topArticleId: row.topArticleId,
      tieredArticles: row.tieredArticles,
      analyzedArticles: row.analyzedArticles,
      winningTier: row.winningTier,
    });

    const topUrl =
      winner?.article.url?.trim() ||
      (row.topArticleId?.startsWith("http") ? row.topArticleId.trim() : "") ||
      row.topArticleId?.trim() ||
      "";

    return {
      date: row.date,
      summary: row.summary ?? "",
      top_article_url: topUrl,
      top_article_title: winner?.article.title?.trim() ?? "",
      winning_tier: row.winningTier?.trim() || winner?.tier || row.tierUsed?.trim() || "",
      topic: firstTopicLabel(row.topicCategories),
      bitcoin_articles: formatTierArticles(tiered.bitcoin),
      crypto_articles: formatTierArticles(tiered.crypto),
      macro_articles: formatTierArticles(tiered.macro),
      proposed_summary: "",
      proposed_winning_article_url: "",
      proposed_winning_tier: "",
    };
  });
}

async function main() {
  const { outputPath, emptySummaryOnly } = parseArgs();
  const rows = await fetchRows(emptySummaryOnly);

  const header = CSV_COLUMNS.join(",");
  const body = rows.map(rowToCsvLine).join("\n");
  const csv = `${header}\n${body}\n`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csv, "utf-8");

  console.log(`Exported ${rows.length} unlocked day(s)${emptySummaryOnly ? " with empty summary" : ""} to ${outputPath}`);
  if (rows.length > 0) {
    console.log("Sample row:", JSON.stringify(rows[0], null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

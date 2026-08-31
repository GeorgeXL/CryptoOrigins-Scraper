/**
 * Research unlocked days via Gemini + Google Search, then save winning article URL to DB.
 *
 * Usage:
 *   npx tsx server/scripts/fill-days-from-google-api.ts --year 2009 --dry-run
 *   npx tsx server/scripts/fill-days-from-google-api.ts --year 2009 --apply
 *   npx tsx server/scripts/fill-days-from-google-api.ts --date 2009-04-06 --apply
 *   npx tsx server/scripts/fill-days-from-google-api.ts --all-empty --apply --delay-ms=4000
 *   npx tsx server/scripts/fill-days-from-google-api.ts --retry-plan tmp/remaining-empty-url-retry-plan.csv --apply
 */

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
dotenv.config();

import type { ArticleData, TieredArticles } from "@shared/schema";
import { buildManualArticle, normalizeManualSourceUrl } from "@shared/manual-day-entry-build";
import type { ResearchTier } from "../services/homepage-checks/perplexity-day-research";
import type { DayResearchResult } from "../services/homepage-checks/perplexity-day-research";

type CliOptions = {
  year: number | null;
  date: string | null;
  allEmpty: boolean;
  retryPlanPath: string | null;
  apply: boolean;
  delayMs: number;
};

function readRetryPlanDates(csvPath: string): string[] {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const retryIdx = header.indexOf("retry");
  if (dateIdx < 0 || retryIdx < 0) {
    throw new Error(`Retry plan CSV must have date and retry columns: ${csvPath}`);
  }

  const dates: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    const date = cells[dateIdx]?.trim() ?? "";
    const retry = cells[retryIdx]?.trim().toLowerCase() ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && retry === "yes") {
      dates.push(date);
    }
  }
  return dates.sort();
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const yearArg = args.find((a) => a.startsWith("--year="))?.split("=")[1];
  const yearFlagIdx = args.indexOf("--year");
  const yearRaw = yearArg ?? (yearFlagIdx >= 0 ? args[yearFlagIdx + 1] : null);
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
  const dateFlagIdx = args.indexOf("--date");
  const dateRaw = dateArg ?? (dateFlagIdx >= 0 ? args[dateFlagIdx + 1] : null);
  const delayArg = args.find((a) => a.startsWith("--delay-ms="))?.split("=")[1];
  const delayFlagIdx = args.indexOf("--delay-ms");
  const retryPlanArg = args.find((a) => a.startsWith("--retry-plan="))?.split("=")[1];
  const retryPlanFlagIdx = args.indexOf("--retry-plan");
  const retryPlanRaw = retryPlanArg ?? (retryPlanFlagIdx >= 0 ? args[retryPlanFlagIdx + 1] : null);
  const allEmpty = args.includes("--all-empty");
  const defaultDelay = allEmpty || retryPlanRaw ? "4000" : "1500";
  const delayRaw = delayArg ?? (delayFlagIdx >= 0 ? args[delayFlagIdx + 1] : defaultDelay);

  return {
    year: yearRaw ? Number(yearRaw) : null,
    date: dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null,
    allEmpty,
    retryPlanPath: retryPlanRaw ? path.resolve(retryPlanRaw) : null,
    apply: args.includes("--apply"),
    delayMs: Math.max(0, Number(delayRaw) || Number(defaultDelay)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.includes("rate limit");
}

async function researchWithRetry(
  date: string,
  researchFn: (date: string) => Promise<DayResearchResult>,
): Promise<DayResearchResult> {
  const backoffMs = [30_000, 60_000, 120_000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    try {
      return await researchFn(date);
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt >= backoffMs.length) {
        throw err;
      }
      const wait = backoffMs[attempt]!;
      console.log(`  rate limited — waiting ${wait / 1000}s before retry ${attempt + 1}/${backoffMs.length}`);
      await sleep(wait);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function tieredArticlesForTier(tier: ResearchTier, article: ArticleData): TieredArticles {
  return {
    bitcoin: tier === "bitcoin" ? [article] : [],
    crypto: tier === "crypto" ? [article] : [],
    macro: tier === "macro" ? [article] : [],
  };
}

async function main() {
  const opts = parseArgs();
  if (!opts.year && !opts.date && !opts.allEmpty && !opts.retryPlanPath) {
    throw new Error("Pass --year 2009, --date YYYY-MM-DD, --all-empty, or --retry-plan path.csv");
  }
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY required");
  }

  const { storage } = await import("../storage");
  const { researchSignificantEventForDateWithGoogle } = await import(
    "../services/homepage-checks/google-day-research"
  );

  let dates: string[] = [];
  if (opts.date) {
    dates = [opts.date];
  } else if (opts.retryPlanPath) {
    dates = readRetryPlanDates(opts.retryPlanPath);
  } else if (opts.allEmpty) {
    const rows = await storage.getAllAnalyses();
    dates = rows
      .filter((row) => !row.isLocked && !row.topArticleId?.trim())
      .map((row) => row.date)
      .sort();
  } else if (opts.year) {
    const start = `${opts.year}-01-01`;
    const end = `${opts.year}-12-31`;
    const rows = await storage.getAnalysesByDateRange(start, end);
    dates = rows
      .filter((row) => !row.isLocked && !row.topArticleId?.trim())
      .map((row) => row.date);
  }

  if (dates.length === 0) {
    console.log("No target dates to process");
    return;
  }

  const mode = opts.apply ? "APPLY" : "DRY RUN";
  console.log(`${mode} · ${dates.length} date(s) · delay ${opts.delayMs}ms\n`);

  let applied = 0;
  let skipped = 0;
  let noResult = 0;

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i]!;
    const prefix = `[${i + 1}/${dates.length}] ${date}`;

    const existing = await storage.getAnalysisByDate(date);
    if (!existing) {
      console.log(`${prefix} — skip (no row)`);
      skipped += 1;
      continue;
    }
    if (existing.isLocked) {
      console.log(`${prefix} — skip (locked)`);
      skipped += 1;
      continue;
    }
    if (existing.topArticleId?.trim()) {
      console.log(`${prefix} — skip (already has URL)`);
      skipped += 1;
      continue;
    }

    try {
      const research = await researchWithRetry(date, researchSignificantEventForDateWithGoogle);
      if (!research.found || !research.tier || !research.sourceUrl) {
        console.log(`${prefix} — no article (${research.reasoning.slice(0, 120)})`);
        noResult += 1;
        if (i < dates.length - 1) await sleep(opts.delayMs);
        continue;
      }

      const sourceUrl = normalizeManualSourceUrl(research.sourceUrl);
      const title =
        research.eventTitle?.trim() ||
        research.sourceTitle?.trim() ||
        "Google Search result";
      const manualArticle = buildManualArticle({
        date,
        sourceUrl,
        summary: "",
        title,
      });
      const tieredArticles = tieredArticlesForTier(research.tier, manualArticle);

      if (!opts.apply) {
        console.log(`${prefix} — would save · ${research.tier} · ${title}`);
        console.log(`  ${sourceUrl}`);
        applied += 1;
        if (i < dates.length - 1) await sleep(opts.delayMs);
        continue;
      }

      await storage.updateAnalysis(date, {
        topArticleId: sourceUrl,
        winningTier: research.tier,
        tierUsed: "manual",
        isManualOverride: true,
        reasoning: `Google API day research (${research.tier} tier)`,
        tieredArticles,
        analyzedArticles: [manualArticle],
      });

      console.log(`${prefix} — saved ✓ · ${research.tier} · ${title}`);
      console.log(`  ${sourceUrl}`);
      applied += 1;
    } catch (err) {
      console.log(`${prefix} — error (${err instanceof Error ? err.message : String(err)})`);
      skipped += 1;
    }

    if (i < dates.length - 1) await sleep(opts.delayMs);
  }

  console.log(
    `\nDone: ${applied} ${opts.apply ? "saved" : "would save"} · ${noResult} no result · ${skipped} skipped · ${dates.length} total`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

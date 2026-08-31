/**
 * Apply operator-provided URL + editorial summary rows to historical_news_analyses.
 *
 * Batch JSON (recommended when pasting several days):
 *   [
 *     {
 *       "date": "2009-04-15",
 *       "url": "https://home.treasury.gov/news/press-releases/tg90",
 *       "summary": "Geithner releases Treasury report to Congress on global contraction, exchange rates and multilateral policy",
 *       "title": "Treasury releases semi-annual report on international economic policies",
 *       "tier": "macro"
 *     }
 *   ]
 *
 * Usage:
 *   npx tsx server/scripts/apply-manual-day-entries.ts --dry-run tmp/manual-day-batch.json
 *   npx tsx server/scripts/apply-manual-day-entries.ts --apply tmp/manual-day-batch.json
 *   npx tsx server/scripts/apply-manual-day-entries.ts --apply \
 *     --date 2009-04-15 --url https://example.com/a --summary "…100–110 chars…" --tier macro
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { buildManualArticle, normalizeManualSourceUrl } from "@shared/manual-day-entry-build";
import {
  normalizeManualDayUploadEntries,
  tieredArticlesForUploadTier,
  type ManualDayUploadEntry,
} from "@shared/manual-day-upload";
import {
  evaluateSummaryQuality,
  normalizeEditorialSummaryText,
} from "../services/editorial-pipeline/editorial-quality";
import { storage } from "../storage";

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;

  const read = (flag: string): string | undefined => {
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.split("=").slice(1).join("=");
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const fileArg = args.find((arg) => !arg.startsWith("--") && /\.json$/i.test(arg));
  const date = read("--date");
  const url = read("--url");
  const summary = read("--summary");
  const title = read("--title");
  const tier = read("--tier");
  const replace = args.includes("--replace");

  let entries: ManualDayUploadEntry[] = [];
  if (fileArg) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(fileArg), "utf-8")) as unknown;
    entries = normalizeManualDayUploadEntries(parsed);
  } else if (date && url && summary) {
    entries = normalizeManualDayUploadEntries([
      { date, url, summary, title, tier, replace },
    ]);
  } else {
    throw new Error(
      "Pass --dry-run|--apply with a .json batch file, or --date --url --summary for one row",
    );
  }

  return { dryRun, entries };
}

async function applyEntry(entry: ManualDayUploadEntry, dryRun: boolean): Promise<"saved" | "skipped"> {
  const summary = normalizeEditorialSummaryText(entry.summary);
  const quality = evaluateSummaryQuality(summary);
  if (quality) {
    throw new Error(`${entry.date}: ${quality.message} (${summary.length} chars)`);
  }

  const existing = await storage.getAnalysisByDate(entry.date);
  if (!existing) {
    throw new Error(`${entry.date}: no analysis row in database`);
  }
  if (existing.isLocked) {
    throw new Error(`${entry.date}: day is locked`);
  }
  if (existing.topArticleId?.trim() && !entry.replace) {
    console.log(`  skip ${entry.date} — already has URL (pass replace: true to overwrite)`);
    return "skipped";
  }

  const sourceUrl = normalizeManualSourceUrl(entry.url);
  const title = entry.title?.trim() || "Manual source";
  const manualArticle = buildManualArticle({ date: entry.date, sourceUrl, summary, title });
  const tier = entry.tier ?? "macro";
  const tieredArticles = tieredArticlesForUploadTier(tier, manualArticle);

  if (dryRun) {
    console.log(`  would save ${entry.date} · ${tier} · ${summary.length} chars`);
    console.log(`    ${summary}`);
    console.log(`    ${sourceUrl}`);
    return "saved";
  }

  await storage.updateAnalysis(entry.date, {
    topArticleId: sourceUrl,
    winningTier: tier,
    tierUsed: "manual",
    isManualOverride: true,
    reasoning: "Manual URL + summary entry (operator-provided)",
    tieredArticles,
    analyzedArticles: [manualArticle],
    summary,
  });

  console.log(`  saved ${entry.date} · ${tier} · ${summary.length} chars`);
  return "saved";
}

async function main() {
  const { dryRun, entries } = parseArgs();
  console.log(`${dryRun ? "DRY RUN" : "APPLY"} · ${entries.length} entr${entries.length === 1 ? "y" : "ies"}\n`);

  let saved = 0;
  let skipped = 0;
  for (const entry of entries) {
    try {
      const result = await applyEntry(entry, dryRun);
      if (result === "saved") saved += 1;
      else skipped += 1;
    } catch (err) {
      console.error(`  error ${entry.date}:`, err instanceof Error ? err.message : err);
      skipped += 1;
    }
  }

  console.log(`\nDone: ${saved} ${dryRun ? "would save" : "saved"} · ${skipped} skipped/failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

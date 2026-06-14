/**
 * Create manual override entries for calendar gap dates (missing analysis rows).
 *
 * Usage:
 *   npx tsx server/scripts/apply-gap-day-manual-entries.ts --dry-run
 *   npx tsx server/scripts/apply-gap-day-manual-entries.ts --apply
 *   npx tsx server/scripts/apply-gap-day-manual-entries.ts --apply --date 2013-01-01
 */
import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildManualAnalysisDbRow,
  buildManualArticle,
  normalizeManualSourceUrl,
  validateManualDayEntryInputs,
} from "../../shared/manual-day-entry-build";
import type { InsertHistoricalNewsAnalysis } from "../../shared/schema";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { evaluateSummaryQuality } from "../services/editorial-pipeline/editorial-quality";
import {
  ensureTopicCategoryAndStorylineLinks,
  syncStorylineAssignmentsForDate,
} from "../services/editorial-pipeline/storyline-taxonomy";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

type GapDayEntry = {
  date: string;
  summary: string;
  topic: string;
  tags: string[];
  sourceUrl: string;
  title: string;
  researchNote: string;
};

const GAP_DAY_ENTRIES: GapDayEntry[] = [
  {
    date: "2013-01-01",
    summary:
      "Bitcoin opened near thirteen dollars, beginning the bull run that would later push price toward one thousand",
    topic: "Bitcoin price & cycles",
    tags: ["Bitcoin"],
    sourceUrl: "https://www.coindesk.com/price/bitcoin/",
    title: "CoinDesk",
    researchNote: "Beginning of Bitcoin 2013 bull run year, trading near $13",
  },
  {
    date: "2013-03-03",
    summary:
      "Bitcoin market cap topped one billion dollars for the first time as Coinbase set a first million dollar month",
    topic: "Bitcoin price & cycles",
    tags: ["Coinbase", "Bitcoin"],
    sourceUrl: "https://en.bitcoin.it/wiki/History",
    title: "Bitcoin Wiki",
    researchNote: "Bitcoin market cap surpassed $1B; Coinbase first $1M month",
  },
  {
    date: "2014-09-28",
    summary:
      "BearWhale posted a thirty thousand Bitcoin sell wall at three hundred on Bitstamp before traders bought it out",
    topic: "Bitcoin price & cycles",
    tags: ["Bitstamp", "Bitcoin"],
    sourceUrl: "https://bitcointalk.org/",
    title: "Bitcointalk",
    researchNote: "BearWhale 30,000 BTC sell wall at $300 on Bitstamp",
  },
  {
    date: "2014-11-24",
    summary:
      "Microsoft announced Bitcoin payments for Xbox games and Windows software through BitPay on its digital store",
    topic: "Bitcoin adoption",
    tags: ["Microsoft", "BitPay"],
    sourceUrl: "https://news.microsoft.com/",
    title: "Microsoft News",
    researchNote: "Microsoft announced Bitcoin payments via BitPay partnership",
  },
  {
    date: "2014-12-10",
    summary:
      "Microsoft launched live Bitcoin checkout on online stores as merchants pushed for clearer global crypto rules",
    topic: "Bitcoin adoption",
    tags: ["Microsoft", "Bitcoin"],
    sourceUrl: "https://blogs.microsoft.com/",
    title: "Microsoft Blogs",
    researchNote: "Microsoft live Bitcoin integration on online commerce platforms",
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const dateIdx = args.indexOf("--date");
  const singleDate = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  if (singleDate && !/^\d{4}-\d{2}-\d{2}$/.test(singleDate)) {
    throw new Error(`Invalid --date value: ${singleDate}`);
  }
  return { dryRun, apply, singleDate };
}

function truncate(text: string, max = 52): string {
  const t = text.trim();
  if (!t) return "(empty)";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function syncPageTopicsForLabel(
  _client: SupabaseClient,
  _analysisId: string,
  topicLabel: string,
): Promise<string[]> {
  return [topicLabel];
}

async function syncTagsForAnalysis(date: string, tagNames: string[]): Promise<void> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) return;

  const existingTags = await storage.getTagsForAnalysis(analysis.id);
  for (const tag of existingTags) {
    await storage.removeTagFromAnalysis(analysis.id, tag.id);
  }

  await storage.updateAnalysis(date, { tagsVersion2: tagNames });
  for (const tagName of tagNames) {
    const tag = await storage.findOrCreateTag({ name: tagName, category: "miscellaneous" });
    await storage.addTagToAnalysis(analysis.id, tag.id);
    await storage.updateTagUsageCount(tag.id);
  }
}

async function saveManualEntryBypassingLock(entry: GapDayEntry): Promise<string[]> {
  const { summary, topicLabel } = validateManualDayEntryInputs({
    date: entry.date,
    summary: entry.summary,
    topic: entry.topic,
  });
  const qualityIssue = evaluateSummaryQuality(summary);
  if (qualityIssue) {
    throw new Error(`Summary quality failed for ${entry.date}: ${qualityIssue.message}`);
  }

  const sourceUrl = normalizeManualSourceUrl(entry.sourceUrl);
  const manualArticle = buildManualArticle({
    date: entry.date,
    sourceUrl,
    summary,
    title: entry.title,
  });
  const linkedTopics = [topicLabel];
  const dbRow = buildManualAnalysisDbRow({
    date: entry.date,
    summary,
    sourceUrl,
    topicCategories: linkedTopics,
    manualArticle,
    tagsVersion2: entry.tags,
  });

  const supabaseAdmin = getSupabaseAdmin();
  if (supabaseAdmin) {
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("historical_news_analyses")
      .select("id")
      .eq("date", entry.date)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);

    let analysisId: string;
    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from("historical_news_analyses")
        .update(dbRow)
        .eq("date", entry.date)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error(`Update returned no row for ${entry.date}`);
      analysisId = data.id;
    } else {
      const { data, error } = await supabaseAdmin
        .from("historical_news_analyses")
        .insert(dbRow)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error(`Insert returned no row for ${entry.date}`);
      analysisId = data.id;
    }

    const syncedTopics = await syncPageTopicsForLabel(supabaseAdmin, analysisId, topicLabel);
    const topicCategories = syncedTopics.length > 0 ? syncedTopics : linkedTopics;
    if (syncedTopics.length > 0) {
      const { error } = await supabaseAdmin
        .from("historical_news_analyses")
        .update({ topic_categories: topicCategories })
        .eq("id", analysisId);
      if (error) throw new Error(error.message);
    }
    await syncStorylineAssignmentsForDate(entry.date, [topicLabel]);
    await syncTagsForAnalysis(entry.date, entry.tags);
    return topicCategories;
  }

  const linked = await ensureTopicCategoryAndStorylineLinks(entry.date, linkedTopics);
  await syncStorylineAssignmentsForDate(entry.date, [topicLabel]);

  const analysisPayload: InsertHistoricalNewsAnalysis = {
    date: entry.date,
    summary,
    topArticleId: sourceUrl,
    isManualOverride: true,
    isOrphan: false,
    aiProvider: "manual",
    reasoning: "Manual override for calendar gap day",
    confidenceScore: "100",
    winningTier: "bitcoin",
    tierUsed: "manual",
    tieredArticles: dbRow.tiered_articles,
    analyzedArticles: dbRow.analyzed_articles,
    totalArticlesFetched: 1,
    uniqueArticlesAnalyzed: 1,
    topicCategories: linked,
    geminiApproved: false,
    perplexityApproved: false,
    tagsVersion2: entry.tags,
  };

  const existingAnalysis = await storage.getAnalysisByDate(entry.date);
  if (existingAnalysis) {
    await storage.updateAnalysis(entry.date, analysisPayload);
  } else {
    await storage.createAnalysis(analysisPayload);
  }
  await syncTagsForAnalysis(entry.date, entry.tags);
  return linked;
}

async function main() {
  const { dryRun, singleDate } = parseArgs();
  const selected = GAP_DAY_ENTRIES.filter((entry) => !singleDate || entry.date === singleDate);
  if (selected.length === 0) {
    throw new Error(singleDate ? `No gap-day entry configured for ${singleDate}` : "No entries configured");
  }

  console.log(
    dryRun
      ? `=== Gap-day manual entries (DRY RUN) — ${selected.length} row(s) ===`
      : `=== Gap-day manual entries (APPLY) — ${selected.length} row(s) ===`,
  );

  const failures: Array<{ date: string; error: string }> = [];
  let applied = 0;

  console.log(
    `${"date".padEnd(12)} | ${"chars".padEnd(5)} | ${"topic".padEnd(24)} | ${"tags".padEnd(24)} | summary`,
  );
  console.log("-".repeat(120));

  for (const entry of selected) {
    try {
      const qualityIssue = evaluateSummaryQuality(entry.summary);
      if (qualityIssue) {
        throw new Error(qualityIssue.message);
      }

      console.log(
        `${entry.date.padEnd(12)} | ${String(entry.summary.length).padEnd(5)} | ${entry.topic.padEnd(24)} | ${entry.tags.join(", ").padEnd(24)} | ${truncate(entry.summary, 48)}`,
      );

      if (!dryRun) {
        await saveManualEntryBypassingLock(entry);
        applied += 1;
      }
    } catch (error) {
      failures.push({
        date: entry.date,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("\n---");
  console.log(`Processed: ${selected.length}`);
  console.log(`Applied: ${dryRun ? 0 : applied}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.date}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

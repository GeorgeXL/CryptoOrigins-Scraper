/**
 * Fix Satoshi identity rows that failed Google check (pre-verified with Gemini).
 *
 * Usage:
 *   npx tsx server/scripts/fix-satoshi-identity-google-nos.ts --dry-run
 *   npx tsx server/scripts/fix-satoshi-identity-google-nos.ts --apply
 */
import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildManualAnalysisDbRow,
  buildManualArticle,
  normalizeManualSourceUrl,
  validateManualDayEntryInputs,
} from "../../shared/manual-day-entry-build";
import type { InsertHistoricalNewsAnalysis } from "../../shared/schema";
import { historicalNewsAnalyses } from "@shared/schema";
import { db } from "../db";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { evaluateSummaryQuality } from "../services/editorial-pipeline/editorial-quality";
import {
  ensureTopicCategoryAndStorylineLinks,
  syncStorylineAssignmentsForDate,
} from "../services/editorial-pipeline/storyline-taxonomy";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

const LEAF = "Satoshi identity";

type ManualFix = {
  date: string;
  summary: string;
  topic: string;
  tags: string[];
  sourceUrl: string;
  title: string;
};

const MANUAL_FIXES: ManualFix[] = [
  {
    date: "2010-01-25",
    summary:
      "Satoshi Nakamoto posts on Bitcointalk, explaining address payments cannot carry messages unlike IP sends",
    topic: LEAF,
    tags: ["Satoshi", "Bitcointalk"],
    sourceUrl: "https://bitcointalk.org/index.php?topic=25.msg164",
    title: "Bitcointalk",
  },
  {
    date: "2015-05-17",
    summary:
      "Popper reports Bitcoin insiders see Nick Szabo as the most convincing Satoshi candidate and Szabo denies it",
    topic: LEAF,
    tags: ["Nick Szabo", "Bitcoin"],
    sourceUrl:
      "https://archive.nytimes.com/bits.blogs.nytimes.com/2015/05/15/daily-report-unearthing-the-enigma-of-bitcoins-birth/",
    title: "New York Times",
  },
];

const RETAG_OFF_DATES = ["2016-03-04", "2022-08-15"];

function parseArgs() {
  const apply = process.argv.includes("--apply");
  return { dryRun: !apply, apply };
}

async function syncPageTopicsForLabel(
  client: SupabaseClient,
  analysisId: string,
  topicLabel: string,
): Promise<string[]> {
  const { data: allTopics, error: topicsErr } = await client.from("topics").select("id, name");
  if (topicsErr) throw new Error(topicsErr.message);

  const normalized = topicLabel.trim().toLowerCase();
  const topic = (allTopics ?? []).find((row) => row.name.trim().toLowerCase() === normalized);

  const { error: deleteErr } = await client.from("page_topics").delete().eq("analysis_id", analysisId);
  if (deleteErr) throw new Error(deleteErr.message);
  if (!topic) return [];

  const { error: insertErr } = await client.from("page_topics").insert({
    analysis_id: analysisId,
    topic_id: topic.id,
    is_primary: true,
  });
  if (insertErr) throw new Error(insertErr.message);
  return [topic.name];
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

async function saveManualFix(entry: ManualFix): Promise<void> {
  const { summary, topicLabel } = validateManualDayEntryInputs({
    date: entry.date,
    summary: entry.summary,
    topic: entry.topic,
  });
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
  } else {
    const linked = await ensureTopicCategoryAndStorylineLinks(entry.date, linkedTopics);
    await syncStorylineAssignmentsForDate(entry.date, [topicLabel]);

    const analysisPayload: InsertHistoricalNewsAnalysis = {
      date: entry.date,
      summary,
      topArticleId: sourceUrl,
      isManualOverride: true,
      isOrphan: false,
      aiProvider: "manual",
      reasoning: "Manual fix for Satoshi identity Google check failure (Gemini pre-verified yes)",
      confidenceScore: "100",
      winningTier: "bitcoin",
      tierUsed: "manual",
      tieredArticles: dbRow.tieredArticles,
      analyzedArticles: dbRow.analyzedArticles,
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
  }

  await storage.updateAnalysisGoogleCheck(entry.date, {
    googleCheckHappened: "yes",
    googleCheckCheckedAt: new Date(),
  });
}

async function clearTopicForDate(date: string): Promise<void> {
  await syncStorylineAssignmentsForDate(date, []);
  await db
    .update(historicalNewsAnalyses)
    .set({ topicCategories: [] })
    .where(eq(historicalNewsAnalyses.date, date));
}

async function main() {
  const { dryRun } = parseArgs();
  console.log(dryRun ? "=== Satoshi identity Google-no fixes (DRY RUN) ===" : "=== Satoshi identity Google-no fixes (APPLY) ===");

  for (const entry of MANUAL_FIXES) {
    const issue = evaluateSummaryQuality(entry.summary);
    if (issue) throw new Error(`${entry.date}: ${issue.message}`);
    console.log(`\nMANUAL ${entry.date} · ${entry.summary.length} chars`);
    console.log(`  ${entry.summary}`);
    console.log(`  source: ${entry.sourceUrl}`);
    if (!dryRun) {
      await saveManualFix(entry);
      console.log("  ✓ saved + google_check=yes");
    }
  }

  for (const date of RETAG_OFF_DATES) {
    const row = await storage.getAnalysisByDate(date);
    console.log(`\nRETAG OFF ${date}`);
    console.log(`  was: ${row?.summary?.slice(0, 90) ?? "(no row)"}`);
    if (!dryRun) {
      await clearTopicForDate(date);
      console.log("  ✓ topic cleared");
    }
  }

  if (dryRun) {
    console.log("\nDry run complete — pass --apply to persist.");
    return;
  }

  console.log("\n--- Verification ---");
  const leafRows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const nos = leafRows.filter((r) => r.googleCheckHappened === "no");
  console.log(`Satoshi identity: ${leafRows.length} rows, ${nos.length} google no`);
  for (const r of nos) {
    console.log(`  still no: ${r.date} · ${r.summary?.slice(0, 70)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

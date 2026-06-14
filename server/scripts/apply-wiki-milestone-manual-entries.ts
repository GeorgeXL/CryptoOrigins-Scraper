/**
 * Create manual override entries for Bitcoin Wiki milestone cross-check rows
 * with verdict partial or mismatch.
 *
 * Usage:
 *   npx tsx server/scripts/apply-wiki-milestone-manual-entries.ts --dry-run
 *   npx tsx server/scripts/apply-wiki-milestone-manual-entries.ts --dry-run --limit 3
 *   npx tsx server/scripts/apply-wiki-milestone-manual-entries.ts --apply
 *   npx tsx server/scripts/apply-wiki-milestone-manual-entries.ts --apply --date 2009-03-08
 *   npx tsx server/scripts/apply-wiki-milestone-manual-entries.ts --apply --limit 5
 */
import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildManualAnalysisDbRow,
  buildManualArticle,
  normalizeManualSourceUrl,
  validateManualDayEntryInputs,
} from "../../shared/manual-day-entry-build";
import type { InsertHistoricalNewsAnalysis } from "../../shared/schema";
import { extractWikiMilestoneKeywordTags } from "../../shared/wiki-milestone-keyword-tags";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  coerceEditorialSummaryLength,
  evaluateSummaryQuality,
  normalizeEditorialSummaryText,
} from "../services/editorial-pipeline/editorial-quality";
import { getModelForAgent } from "../services/editorial-pipeline/model-config";
import { isSummaryAgentEnabled } from "../services/editorial-pipeline/summary-agent";
import {
  ensureTopicCategoryAndStorylineLinks,
  rankTopicCandidatesFromSummary,
  syncStorylineAssignmentsForDate,
} from "../services/editorial-pipeline/storyline-taxonomy";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

const WIKI_SOURCE_URL = "https://en.bitcoin.it/wiki/Category:History";
const CSV_PATH = path.resolve("tmp/bitcoin-wiki-milestone-crosscheck.csv");

type CrosscheckRow = {
  date: string;
  wikiMilestone: string;
  dbSummary: string;
  verdict: string;
  notes: string;
};

type ProcessedRow = {
  date: string;
  wikiMilestone: string;
  oldSummary: string;
  newSummary: string;
  topic: string;
  charCount: number;
  topicOverridden: boolean;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = args.includes("--dry-run") || !apply;
  const dateIdx = args.indexOf("--date");
  const limitIdx = args.indexOf("--limit");
  const singleDate = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;
  if (singleDate && !/^\d{4}-\d{2}-\d{2}$/.test(singleDate)) {
    throw new Error(`Invalid --date value: ${singleDate}`);
  }
  if (limitIdx >= 0 && (!Number.isFinite(limit) || (limit ?? 0) < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  return { dryRun, apply, singleDate, limit };
}

/** Minimal RFC-style CSV parser for quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
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
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
}

function loadCrosscheckRows(): CrosscheckRow[] {
  const raw = fs.readFileSync(CSV_PATH, "utf8").trim();
  const lines = raw.split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const [date, wikiMilestone, dbSummary, verdict, notes] = parseCsvLine(line);
    return {
      date: date?.trim() ?? "",
      wikiMilestone: wikiMilestone?.trim() ?? "",
      dbSummary: dbSummary?.trim() ?? "",
      verdict: verdict?.trim() ?? "",
      notes: notes?.trim() ?? "",
    };
  });
}

function truncate(text: string, max = 48): string {
  const t = text.trim();
  if (!t) return "(empty)";
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function inferTopicFromMilestone(
  date: string,
  wikiMilestone: string,
  summary: string,
): { topic: string; overridden: boolean } {
  const milestone = wikiMilestone.toLowerCase();
  const keywordRules: Array<{ test: RegExp; topic: string }> = [
    { test: /\b(mtgox|mt\.?\s*gox|bitmarket|britcoin|virwox|bitcoin market|exchange opens?)\b/i, topic: "Exchanges" },
    { test: /\b(v0\.|bitcoin core|bitcoin-qt|bitcoind|bloom filter|release|upgrade|exploit|microtransaction)\b/i, topic: "Protocol & upgrades" },
    { test: /\b(difficulty|gpu|cuda|opencl|fpga|mining pool|p2pool|deepbit|coinotron|artforz|miner|jgarzik|split-reward)\b/i, topic: "Bitcoin mining" },
    { test: /\b(block \d+|btc generated|million btc)\b/i, topic: "Bitcoin mining" },
    { test: /\b(fincen|foundation formed|eff stops)\b/i, topic: "Bitcoin regulation" },
    { test: /\b(conference|room77|vehicle offered|weusecoins|video|adoption|donation|brick-and-mortar)\b/i, topic: "Bitcoin adoption" },
    { test: /\b(price|parity|\$|ath|market cap|touched \$|breaks \$|short sale|put option)\b/i, topic: "Bitcoin price & cycles" },
    { test: /\b(linode|hack|stolen|ddos|phishing|overflow bug)\b/i, topic: "Enforcement & crime" },
    { test: /\b(satoshi dice|nfc|ipad|wiki page|irc|#bitcoin|otc|tonal bitcoin|satoshi emails?)\b/i, topic: "Early Bitcoin history" },
    { test: /\b(wikipedia|reddit|slashdot|forum|history of bitcoin)\b/i, topic: "Early Bitcoin history" },
  ];

  for (const rule of keywordRules) {
    if (rule.test.test(milestone) || rule.test.test(summary)) {
      return { topic: rule.topic, overridden: true };
    }
  }

  const ranking = rankTopicCandidatesFromSummary({
    summary: `${wikiMilestone}. ${summary}`,
    tags: [],
  });
  if (ranking.primary && ranking.confidence !== "low") {
    return { topic: ranking.primary, overridden: false };
  }
  if (ranking.candidates[0]?.leaf) {
    return { topic: ranking.candidates[0].leaf, overridden: ranking.primary == null };
  }

  const year = Number.parseInt(date.slice(0, 4), 10);
  if (year < 2013) {
    return { topic: "Early Bitcoin history", overridden: true };
  }
  return { topic: "Early Bitcoin history", overridden: true };
}

async function generateWikiMilestoneSummary(
  date: string,
  wikiMilestone: string,
  priorIssue?: string | null,
): Promise<string> {
  if (!isSummaryAgentEnabled()) {
    throw new Error("OPENAI_API_KEY missing or SUMMARY_AGENT_DISABLED=1");
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = getModelForAgent("SummaryAgent");
  const system = `You write ONE factual historical timeline summary for a Bitcoin Wiki milestone.
Rules (strict):
- Exactly 100-110 characters after your edit
- Active voice, one event only, past tense OK
- Name the milestone event clearly
- No calendar date tokens in the summary
- No trailing period or ending punctuation
- Never use ", and"
- Forbidden symbols: ; : ? " - " | — – / &
- Capitalize Bitcoin and all proper names (MtGox, Satoshi, Hal Finney, etc.)
Return ONLY the summary text, nothing else.`;

  const user = JSON.stringify({
    calendar_date: date,
    wiki_milestone: wikiMilestone,
    quality_feedback: priorIssue ?? null,
  });

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    max_completion_tokens: 180,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return normalizeEditorialSummaryText(completion.choices[0]?.message?.content ?? "");
}

async function expandSummaryToTarget(date: string, wikiMilestone: string, summary: string): Promise<string> {
  if (!isSummaryAgentEnabled()) return summary;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = getModelForAgent("SummaryAgent");
  const need = 100 - summary.length;
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    max_completion_tokens: 180,
    messages: [
      {
        role: "system",
        content:
          "Expand the timeline one-line summary to exactly 100-110 characters. Keep the same event. Active voice, no date tokens, no trailing period, capitalize Bitcoin and other proper names. Return ONLY the expanded summary text.",
      },
      {
        role: "user",
        content: JSON.stringify({
          calendar_date: date,
          wiki_milestone: wikiMilestone,
          current_summary: summary,
          current_length: summary.length,
          add_about: need,
        }),
      },
    ],
  });
  return normalizeEditorialSummaryText(completion.choices[0]?.message?.content ?? summary);
}

async function trimSummaryToTarget(date: string, wikiMilestone: string, summary: string): Promise<string> {
  const coerced = coerceEditorialSummaryLength(summary);
  if (coerced) return coerced;
  if (!isSummaryAgentEnabled()) return summary.slice(0, 110).trim();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = getModelForAgent("SummaryAgent");
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    max_completion_tokens: 180,
    messages: [
      {
        role: "system",
        content:
          "Shorten the timeline one-line summary to exactly 100-110 characters. Keep the same event. Active voice, no date tokens, no trailing period. Return ONLY the shortened summary text.",
      },
      {
        role: "user",
        content: JSON.stringify({
          calendar_date: date,
          wiki_milestone: wikiMilestone,
          current_summary: summary,
          current_length: summary.length,
        }),
      },
    ],
  });
  return normalizeEditorialSummaryText(completion.choices[0]?.message?.content ?? summary);
}

async function produceValidSummary(date: string, wikiMilestone: string): Promise<string> {
  let lastIssue: string | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let summary = await generateWikiMilestoneSummary(date, wikiMilestone, lastIssue);
    if (!summary) continue;

    for (let fixRound = 0; fixRound < 3; fixRound += 1) {
      summary = summary.replace(/, and/g, " and");
      const coerced = coerceEditorialSummaryLength(summary);
      if (coerced) summary = coerced;

      const issue = evaluateSummaryQuality(summary);
      if (!issue) return summary;

      lastIssue = issue.message;
      if (issue.code === "too_short") {
        summary = await expandSummaryToTarget(date, wikiMilestone, summary);
      } else if (issue.code === "too_long") {
        summary = await trimSummaryToTarget(date, wikiMilestone, summary);
      } else if (issue.code === "disallowed_symbols" && summary.includes(", and")) {
        summary = summary.replace(/, and/g, " and");
      } else {
        break;
      }
    }
  }
  throw new Error(`Failed to produce valid summary after retries (${lastIssue ?? "unknown issue"})`);
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

async function saveManualEntryBypassingLock(opts: {
  date: string;
  summary: string;
  sourceUrl: string;
  topic: string;
  wikiMilestone: string;
}): Promise<string[]> {
  const { summary, topicLabel } = validateManualDayEntryInputs({
    date: opts.date,
    summary: opts.summary,
    topic: opts.topic,
  });
  const sourceUrl = normalizeManualSourceUrl(opts.sourceUrl);
  const manualArticle = buildManualArticle({
    date: opts.date,
    sourceUrl,
    summary,
    title: "Bitcoin Wiki History",
  });
  const linkedTopics = [topicLabel];
  const keywordTags = extractWikiMilestoneKeywordTags(opts.wikiMilestone, summary);
  const dbRow = buildManualAnalysisDbRow({
    date: opts.date,
    summary,
    sourceUrl,
    topicCategories: linkedTopics,
    manualArticle,
    tagsVersion2: keywordTags,
  });

  const supabaseAdmin = getSupabaseAdmin();
  if (supabaseAdmin) {
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("historical_news_analyses")
      .select("id")
      .eq("date", opts.date)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);

    let analysisId: string;
    if (existing?.id) {
      const { data, error } = await supabaseAdmin
        .from("historical_news_analyses")
        .update(dbRow)
        .eq("date", opts.date)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error(`Update returned no row for ${opts.date}`);
      analysisId = data.id;
    } else {
      const { data, error } = await supabaseAdmin
        .from("historical_news_analyses")
        .insert(dbRow)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error(`Insert returned no row for ${opts.date}`);
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
    await syncStorylineAssignmentsForDate(opts.date, [topicLabel]);
    await syncTagsForAnalysis(opts.date, keywordTags);
    return topicCategories;
  }

  const linked = await ensureTopicCategoryAndStorylineLinks(opts.date, linkedTopics);
  await syncStorylineAssignmentsForDate(opts.date, [topicLabel]);

  const analysisPayload: InsertHistoricalNewsAnalysis = {
    date: opts.date,
    summary,
    topArticleId: sourceUrl,
    isManualOverride: true,
    isOrphan: false,
    aiProvider: "manual",
    reasoning: "Manual override from Bitcoin Wiki milestone cross-check",
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
    tagsVersion2: keywordTags,
  };

  const existingAnalysis = await storage.getAnalysisByDate(opts.date);
  if (existingAnalysis) {
    await storage.updateAnalysis(opts.date, analysisPayload);
  } else {
    await storage.createAnalysis(analysisPayload);
  }
  await syncTagsForAnalysis(opts.date, keywordTags);
  return linked;
}

function printProgressTable(rows: ProcessedRow[]) {
  const dateW = 12;
  const oldW = 50;
  const newW = 50;
  const topicW = 28;
  const charsW = 5;
  console.log(
    `${"date".padEnd(dateW)} | ${"old summary".padEnd(oldW)} | ${"new summary".padEnd(newW)} | ${"topic".padEnd(topicW)} | chars`,
  );
  console.log("-".repeat(dateW + oldW + newW + topicW + charsW + 13));
  for (const row of rows) {
    const topicSuffix = row.topicOverridden ? "*" : "";
    console.log(
      `${row.date.padEnd(dateW)} | ${truncate(row.oldSummary, oldW - 1).padEnd(oldW)} | ${truncate(row.newSummary, newW - 1).padEnd(newW)} | ${(row.topic + topicSuffix).padEnd(topicW)} | ${row.charCount}`,
    );
  }
  if (rows.some((r) => r.topicOverridden)) {
    console.log("\n* topic set via milestone keyword override or pre-2013 fallback");
  }
}

async function main() {
  const { dryRun, singleDate, limit } = parseArgs();
  const allRows = loadCrosscheckRows().filter((row) => {
    if (!["partial", "mismatch"].includes(row.verdict)) return false;
    if (singleDate && row.date !== singleDate) return false;
    return true;
  });

  const selected = typeof limit === "number" ? allRows.slice(0, limit) : allRows;
  console.log(
    dryRun
      ? `=== Wiki milestone manual entries (DRY RUN) — ${selected.length}/${allRows.length} row(s) ===`
      : `=== Wiki milestone manual entries (APPLY) — ${selected.length}/${allRows.length} row(s) ===`,
  );

  const processed: ProcessedRow[] = [];
  const failures: Array<{ date: string; error: string }> = [];
  const topicOverrides: Array<{ date: string; topic: string; wikiMilestone: string }> = [];
  let applied = 0;

  for (const row of selected) {
    try {
      const newSummary = await produceValidSummary(row.date, row.wikiMilestone);
      const { topic, overridden } = inferTopicFromMilestone(row.date, row.wikiMilestone, newSummary);
      if (overridden) {
        topicOverrides.push({ date: row.date, topic, wikiMilestone: row.wikiMilestone });
      }

      const entry: ProcessedRow = {
        date: row.date,
        wikiMilestone: row.wikiMilestone,
        oldSummary: row.dbSummary,
        newSummary,
        topic,
        charCount: newSummary.length,
        topicOverridden: overridden,
      };
      processed.push(entry);

      if (!dryRun) {
        await saveManualEntryBypassingLock({
          date: row.date,
          summary: newSummary,
          sourceUrl: WIKI_SOURCE_URL,
          topic,
          wikiMilestone: row.wikiMilestone,
        });
        applied += 1;
      }
    } catch (error) {
      failures.push({
        date: row.date,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  printProgressTable(processed);

  console.log("\n---");
  console.log(`Processed: ${processed.length}`);
  console.log(`Applied: ${dryRun ? 0 : applied}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Skipped: ${selected.length - processed.length - failures.length}`);

  if (topicOverrides.length) {
    console.log("\nTopic overrides:");
    for (const item of topicOverrides) {
      console.log(`  ${item.date}: ${item.topic} — ${truncate(item.wikiMilestone, 60)}`);
    }
  }

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

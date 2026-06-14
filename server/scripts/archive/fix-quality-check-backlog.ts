/**
 * Directly fix Events Manager quality-check backlog (no review queue).
 *
 * Usage:
 *   npx tsx server/scripts/fix-quality-check-backlog.ts --dry-run
 *   npx tsx server/scripts/fix-quality-check-backlog.ts --apply
 *   npx tsx server/scripts/fix-quality-check-backlog.ts --apply --only untagged
 */
import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";

import { isValidPipelineTopArticleId } from "../services/editorial-pipeline/editorial-quality";
import { buildStoredArticleCandidates, resolveStoredWinningArticle } from "../services/editorial-pipeline/run";
import { regenerateSummaryWithAgent } from "../services/editorial-pipeline/summary-agent";
import {
  ensureTopicCategoryAndStorylineLinks,
  rankTopicCandidatesFromSummary,
  syncStorylineAssignmentsForDate,
} from "../services/editorial-pipeline/storyline-taxonomy";
import { suggestTopicsWithAgent } from "../services/editorial-pipeline/topic-agent";
import { invalidTopicReasons } from "../services/editorial-pipeline/topic-validation";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { entityExtractor } from "../services/entity-extractor";
import { storage } from "../storage";

dotenv.config({ path: path.resolve("client/.env") });

type FixKind = "empty-summary" | "untagged" | "topic";

function parseArgs() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;
  const onlyIdx = process.argv.indexOf("--only");
  const only =
    onlyIdx >= 0 ? (process.argv[onlyIdx + 1] as FixKind | "all" | undefined) : "all";
  if (only && !["all", "empty-summary", "untagged", "topic"].includes(only)) {
    throw new Error(`Invalid --only value: ${only}`);
  }
  return { dryRun, only: only ?? "all" };
}

function hasSummary(summary: string | null | undefined): boolean {
  return Boolean(summary?.trim());
}

async function syncTagsForAnalysis(date: string, tagNames: string[]): Promise<void> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) throw new Error(`No analysis for ${date}`);

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

function fallbackTagsFromSummary(summary: string): string[] {
  const tags: string[] = [];
  if (/\bbitcoin\b|\bbtc\b/i.test(summary)) tags.push("Bitcoin");
  const skip = new Set(["The", "This", "That", "Bitcoin", "SEC", "US", "U.S.", "UK", "EU"]);
  const proper = summary.match(/\b[A-Z][A-Za-z0-9.&'-]{2,}\b/g) ?? [];
  for (const word of proper) {
    if (skip.has(word) || tags.includes(word)) continue;
    tags.push(word);
    if (tags.length >= 2) break;
  }
  if (tags.length === 0) tags.push("Bitcoin");
  return tags.slice(0, 2);
}

function pickStoredArticle(row: Awaited<ReturnType<typeof storage.getAnalysisByDate>>) {
  if (!row) return null;
  const candidates = buildStoredArticleCandidates({ ...row, targetDate: row.date });
  if (!candidates.length) return null;
  const recommended = candidates.find((c) => c.recommended);
  return recommended ?? candidates[0] ?? null;
}

async function assignSingleTopic(
  date: string,
  summary: string,
  tags: string[],
  currentTopics: string[],
): Promise<string> {
  const agent = await suggestTopicsWithAgent({
    date,
    summary,
    tags,
    currentTopics,
  });
  const fromAgent = agent.proposed[0] ?? agent.recommended ?? null;
  if (fromAgent) return fromAgent;

  const ranking = rankTopicCandidatesFromSummary({ summary, tags });
  if (ranking.primary) return ranking.primary;
  if (ranking.candidates[0]?.leaf) return ranking.candidates[0].leaf;

  const legacy = currentTopics[0]?.toLowerCase() ?? "";
  if (legacy.includes("enterprise blockchain")) return "Smart contracts & L1s";
  if (legacy.includes("regulation")) return "Bitcoin regulation";
  throw new Error("Could not infer topic leaf");
}

async function fixEmptySummary(date: string, dryRun: boolean): Promise<{ ok: boolean; message: string }> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) return { ok: false, message: "missing row" };

  if (!isValidPipelineTopArticleId(analysis.topArticleId)) {
    const picked = pickStoredArticle(analysis);
    if (!picked) {
      return { ok: false, message: "Top article id missing and no stored candidates" };
    }
    if (dryRun) {
      return { ok: true, message: `would pick "${picked.title.slice(0, 50)}" then regenerate` };
    }
    await storage.updateAnalysis(date, {
      topArticleId: picked.id,
      winningTier: picked.tier,
      analyzedArticles: [picked as never],
    });
  } else if (dryRun) {
    return { ok: true, message: "would regenerate summary" };
  }

  const out = await regenerateSummaryWithAgent(date);
  return { ok: out.ok, message: out.message ?? `summary ${out.summaryLength} chars` };
}

async function fixUntagged(
  date: string,
  summary: string,
  dryRun: boolean,
): Promise<{ ok: boolean; message: string }> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) return { ok: false, message: "missing row" };

  let articleContent = "";
  if (isValidPipelineTopArticleId(analysis.topArticleId)) {
    const resolved = resolveStoredWinningArticle({
      topArticleId: analysis.topArticleId,
      tieredArticles: analysis.tieredArticles,
      analyzedArticles: analysis.analyzedArticles,
      winningTier: analysis.winningTier,
    });
    if (resolved) {
      articleContent = (resolved.article.text || resolved.article.summary || "").slice(0, 4000);
    }
  }

  if (dryRun) {
    return { ok: true, message: `would extract tags${articleContent ? " with article context" : ""}` };
  }

  const tagNames =
    articleContent.trim().length > 0
      ? await entityExtractor.extractEntitiesWithContext(summary, articleContent)
      : await entityExtractor.extractEntities(summary);

  const cleaned = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))].slice(0, 5);
  const finalTags = cleaned.length > 0 ? cleaned : fallbackTagsFromSummary(summary);
  if (finalTags.length === 0) {
    return { ok: false, message: "tag extractor returned no entities" };
  }

  await syncTagsForAnalysis(date, finalTags);
  return { ok: true, message: finalTags.join(", ") };
}

async function fixTopic(
  date: string,
  summary: string,
  tags: string[],
  currentTopics: string[],
  dryRun: boolean,
): Promise<{ ok: boolean; message: string }> {
  if (dryRun) return { ok: true, message: "would assign single topic" };
  const topic = await assignSingleTopic(date, summary, tags, currentTopics);
  const linked = await ensureTopicCategoryAndStorylineLinks(date, [topic]);
  await syncStorylineAssignmentsForDate(date, linked);
  await storage.updateAnalysis(date, { topicCategories: linked });
  return { ok: true, message: linked[0] ?? topic };
}

async function main() {
  const { dryRun, only } = parseArgs();
  console.log(dryRun ? "=== Quality-check backlog fix (DRY RUN) ===" : "=== Quality-check backlog fix (APPLY) ===");

  const analyses = await storage.getAllAnalyses();
  const emptyRows = analyses.filter((a) => !hasSummary(a.summary));
  const untaggedRows = analyses.filter(
    (a) => hasSummary(a.summary) && (!a.tagsVersion2 || a.tagsVersion2.length === 0),
  );
  const topicRows = analyses.filter((a) => {
    if (!hasSummary(a.summary)) return false;
    const topics = topicLabelsFromRow(a.topicCategories);
    return invalidTopicReasons(topics).length > 0;
  });

  console.log(
    `Found: ${emptyRows.length} empty summaries, ${untaggedRows.length} untagged, ${topicRows.length} topic issues`,
  );

  const stats = {
    empty: { ok: 0, fail: 0 },
    untagged: { ok: 0, fail: 0 },
    topic: { ok: 0, fail: 0 },
  };
  const failures: string[] = [];

  if (only === "all" || only === "empty-summary") {
    console.log("\n--- Empty summaries ---");
    for (const row of emptyRows.sort((a, b) => a.date.localeCompare(b.date))) {
      try {
        const result = await fixEmptySummary(row.date, dryRun);
        if (result.ok) {
          stats.empty.ok += 1;
          console.log(`✓ ${row.date}: ${result.message}`);
        } else {
          stats.empty.fail += 1;
          failures.push(`${row.date} (empty): ${result.message}`);
          console.log(`✗ ${row.date}: ${result.message}`);
        }
      } catch (error) {
        stats.empty.fail += 1;
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${row.date} (empty): ${msg}`);
        console.log(`✗ ${row.date}: ${msg}`);
      }
    }
  }

  if (only === "all" || only === "untagged") {
    console.log("\n--- Untagged ---");
    for (const row of untaggedRows.sort((a, b) => a.date.localeCompare(b.date))) {
      try {
        const result = await fixUntagged(row.date, row.summary!.trim(), dryRun);
        if (result.ok) {
          stats.untagged.ok += 1;
          console.log(`✓ ${row.date}: ${result.message}`);
        } else {
          stats.untagged.fail += 1;
          failures.push(`${row.date} (untagged): ${result.message}`);
          console.log(`✗ ${row.date}: ${result.message}`);
        }
      } catch (error) {
        stats.untagged.fail += 1;
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${row.date} (untagged): ${msg}`);
        console.log(`✗ ${row.date}: ${msg}`);
      }
    }
  }

  if (only === "all" || only === "topic") {
    console.log("\n--- Topic issues ---");
    for (const row of topicRows.sort((a, b) => a.date.localeCompare(b.date))) {
      const topics = topicLabelsFromRow(row.topicCategories);
      const tags = row.tagsVersion2 ?? [];
      try {
        const result = await fixTopic(row.date, row.summary!.trim(), tags, topics, dryRun);
        if (result.ok) {
          stats.topic.ok += 1;
          console.log(`✓ ${row.date}: ${result.message}`);
        } else {
          stats.topic.fail += 1;
          failures.push(`${row.date} (topic): ${result.message}`);
          console.log(`✗ ${row.date}: ${result.message}`);
        }
      } catch (error) {
        stats.topic.fail += 1;
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${row.date} (topic): ${msg}`);
        console.log(`✗ ${row.date}: ${msg}`);
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Empty: ${stats.empty.ok} ok, ${stats.empty.fail} failed`);
  console.log(`Untagged: ${stats.untagged.ok} ok, ${stats.untagged.fail} failed`);
  console.log(`Topic: ${stats.topic.ok} ok, ${stats.topic.fail} failed`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

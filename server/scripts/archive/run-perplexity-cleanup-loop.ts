/**
 * @deprecated Use run-perplexity-cleanup-coordinator.ts + run-perplexity-cleanup-leaf.ts
 * for parallel per-leaf cleanup. This serial loop processes up to 10 uncertain + 10 no
 * rows per leaf per pass and is kept for reference only.
 *
 * Parallel cleanup worker for Perplexity bulk verification.
 * When a leaf is fully checked (unchecked=0), processes its no/uncertain rows:
 *   1. Ensure winning article exists (pick stored candidate or refetch via Exa)
 *   2. Summary agent (100–110 chars) when weak or article changed
 *   3. Topic agent + tag agent (1–2 grounded entity tags)
 *   4. Re-verify with Perplexity
 *
 * Usage:
 *   npx tsx server/scripts/run-perplexity-cleanup-loop.ts
 *   npx tsx server/scripts/run-perplexity-cleanup-loop.ts --delay-ms 250
 */

import "dotenv/config";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.resolve("client/.env") });

import { evaluateGoogleCheckRetrospectiveHeuristic } from "../../shared/google-check-heuristics";
import {
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
} from "../../shared/topic-hierarchy";
import {
  evaluateSummaryQuality,
  isValidPipelineTopArticleId,
  normalizeEditorialSummaryText,
} from "../services/editorial-pipeline/editorial-quality";
import {
  editorialTagKey,
  filterEditorialTagAdds,
  isEditorialEntityTagCandidate,
} from "../services/editorial-pipeline/editorial-tag-rules";
import type { ArticleCandidate } from "../services/editorial-pipeline/review-package";
import { buildStoredArticleCandidates, resolveStoredWinningArticle } from "../services/editorial-pipeline/run";
import { fetchCandidatesForDate } from "../services/editorial-pipeline/source-finder-v2";
import {
  evaluateSummaryWithAgent,
  expandShortSummaryWithAgent,
  regenerateSummaryWithAgent,
} from "../services/editorial-pipeline/summary-agent";
import { ensureTopicCategoryAndStorylineLinks, syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";
import { suggestTagsWithAgent } from "../services/editorial-pipeline/tag-agent";
import {
  findGroundedTaxonomyTagsMissingFromRow,
  groundAndCanonicaliseTags,
  isTagGroundedInTexts,
  loadCanonicalTagIndex,
} from "../services/editorial-pipeline/tag-grounding";
import { suggestTopicsWithAgent } from "../services/editorial-pipeline/topic-agent";
import type { ArticleData } from "@shared/schema";
import { runGoogleCheckSingleWithRetry } from "../services/homepage-checks/google-check";
import { storage } from "../storage";

const LOG_DIR = path.resolve("tmp/perplexity-batch");
const LOG_FILE = path.join(LOG_DIR, "cleanup.log");
const STATE_FILE = path.join(LOG_DIR, "cleanup-state.json");

const MAX_UNCERTAIN_PER_LEAF = 10;
const MAX_NO_PER_LEAF = 10;
const IDLE_WAIT_MS = 60_000;
const BETWEEN_PASS_MS = 1_000;

/** Leaves seen as fully checked — used to prioritize newly completed leaves. */
const readyLeavesSeen = new Set<string>();

type CleanupState = {
  /** `${leaf}\t${date}` keys upgraded to yes — only these are skipped on future passes. */
  resolvedKeys: string[];
  /** @deprecated legacy flat dates — ignored; kept for migration visibility only */
  processedDates?: string[];
  stats: {
    attempted: number;
    upgradedToYes: number;
    stillNo: number;
    stillUncertain: number;
    summaryFixed: number;
    topicFixed: number;
    tagsFixed: number;
    articlesEnsured: number;
    retaggedOff: number;
    errors: number;
  };
};

type Args = {
  delayMs: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const readFlagValue = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const delayRaw = readFlagValue("--delay-ms");
  const delayMs = delayRaw != null ? Number(delayRaw) : randomDelayMs();
  return { delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0 };
}

function randomDelayMs(): number {
  return Math.floor(Math.random() * 501);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logLine(message: string): void {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(LOG_FILE, `${line}\n`);
}

const emptyStats = (): CleanupState["stats"] => ({
  attempted: 0,
  upgradedToYes: 0,
  stillNo: 0,
  stillUncertain: 0,
  summaryFixed: 0,
  topicFixed: 0,
  tagsFixed: 0,
  articlesEnsured: 0,
  retaggedOff: 0,
  errors: 0,
});

function loadState(): CleanupState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { resolvedKeys: [], stats: emptyStats() };
    }
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as CleanupState;
    return {
      resolvedKeys: Array.isArray(raw.resolvedKeys) ? raw.resolvedKeys : [],
      processedDates: Array.isArray(raw.processedDates) ? raw.processedDates : undefined,
      stats: {
        attempted: raw.stats?.attempted ?? 0,
        upgradedToYes: raw.stats?.upgradedToYes ?? 0,
        stillNo: raw.stats?.stillNo ?? 0,
        stillUncertain: raw.stats?.stillUncertain ?? 0,
        summaryFixed: raw.stats?.summaryFixed ?? 0,
        topicFixed: raw.stats?.topicFixed ?? 0,
        tagsFixed: raw.stats?.tagsFixed ?? 0,
        articlesEnsured: raw.stats?.articlesEnsured ?? 0,
        retaggedOff: raw.stats?.retaggedOff ?? 0,
        errors: raw.stats?.errors ?? 0,
      },
    };
  } catch {
    return { resolvedKeys: [], stats: emptyStats() };
  }
}

function saveState(state: CleanupState): void {
  ensureLogDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function resolvedKey(leaf: string, date: string): string {
  return `${leaf}\t${date}`;
}

function resolvedSet(state: CleanupState): Set<string> {
  return new Set(state.resolvedKeys);
}

function markResolved(state: CleanupState, leaf: string, date: string): void {
  const key = resolvedKey(leaf, date);
  if (!state.resolvedKeys.includes(key)) {
    state.resolvedKeys.push(key);
  }
}

async function leafUncheckedCount(leaf: string): Promise<number> {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  return rows.filter((row) => row.googleCheckHappened == null).length;
}

async function isLeafReadyForCleanup(leaf: string): Promise<boolean> {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  if (rows.length === 0) return false;
  return rows.every((row) => row.googleCheckHappened != null);
}

function pickFlaggedRows(
  leaf: string,
  rows: Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>,
  resolved: Set<string>,
) {
  const uncertain = rows
    .filter(
      (row) =>
        row.googleCheckHappened === "uncertain" && !resolved.has(resolvedKey(leaf, row.date)),
    )
    .slice(0, MAX_UNCERTAIN_PER_LEAF);
  const no = rows
    .filter(
      (row) => row.googleCheckHappened === "no" && !resolved.has(resolvedKey(leaf, row.date)),
    )
    .slice(0, MAX_NO_PER_LEAF);
  return [...uncertain, ...no];
}

function currentTopics(row: Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>[number]): string[] {
  const cats = row.topicCategories;
  if (Array.isArray(cats)) {
    return cats.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  }
  return [];
}

function currentTags(row: Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>[number]): string[] {
  const tags = row.tagsVersion2;
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

type ArticleContext = {
  articleTitle: string | null;
  articleSnippet: string | null;
  topArticleId: string | null;
};

function candidateToArticleData(candidate: ArticleCandidate): ArticleData {
  let host: string | undefined;
  try {
    host = new URL(candidate.url).hostname;
  } catch {
    host = undefined;
  }
  return {
    id: candidate.id,
    title: candidate.title,
    url: candidate.url,
    publishedDate: candidate.publishedDate ?? new Date().toISOString(),
    text: typeof candidate.summary === "string" ? candidate.summary : "",
    score: 0,
    summary: candidate.summary ?? "",
    source: candidate.source ?? host ?? "EXA",
  } as ArticleData;
}

function tieredArticlesFromCandidates(candidates: ArticleCandidate[]) {
  const out: { bitcoin: ArticleData[]; crypto: ArticleData[]; macro: ArticleData[] } = {
    bitcoin: [],
    crypto: [],
    macro: [],
  };
  for (const candidate of candidates) {
    out[candidate.tier].push(candidateToArticleData(candidate));
  }
  return out;
}

function articleContextFromResolved(
  resolved: NonNullable<ReturnType<typeof resolveStoredWinningArticle>>,
): ArticleContext {
  const snippet = `${resolved.article.title}\n${resolved.article.text || resolved.article.summary || ""}`.slice(0, 500);
  return {
    articleTitle: resolved.article.title ?? null,
    articleSnippet: snippet || null,
    topArticleId: String(resolved.article.id ?? "").trim() || null,
  };
}

function pickStoredArticleCandidate(
  row: NonNullable<Awaited<ReturnType<typeof storage.getAnalysisByDate>>>,
): ArticleCandidate | null {
  const candidates = buildStoredArticleCandidates({ ...row, targetDate: row.date });
  if (!candidates.length) return null;
  return candidates.find((c) => c.recommended) ?? candidates[0] ?? null;
}

/** Pick or refetch the winning article so summary/tag agents have source text. */
async function ensureWinningArticle(
  date: string,
  state: CleanupState,
): Promise<ArticleContext> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) {
    return { articleTitle: null, articleSnippet: null, topArticleId: null };
  }

  let resolved = isValidPipelineTopArticleId(analysis.topArticleId)
    ? resolveStoredWinningArticle({
        topArticleId: analysis.topArticleId,
        tieredArticles: analysis.tieredArticles,
        analyzedArticles: analysis.analyzedArticles,
        winningTier: analysis.winningTier,
      })
    : null;

  if (!resolved) {
    const picked = pickStoredArticleCandidate(analysis);
    if (picked) {
      const tiered = tieredArticlesFromCandidates([picked]);
      await storage.updateAnalysis(date, {
        topArticleId: picked.id,
        winningTier: picked.tier,
        tieredArticles: tiered,
        analyzedArticles: [candidateToArticleData(picked)],
      });
      state.stats.articlesEnsured += 1;
      logLine(`  picked stored article "${picked.title.slice(0, 60)}"`);
      resolved = resolveStoredWinningArticle({
        topArticleId: picked.id,
        tieredArticles: tiered,
        analyzedArticles: [candidateToArticleData(picked)],
        winningTier: picked.tier,
      });
    }
  }

  if (!resolved) {
    const pool = await fetchCandidatesForDate(date, {
      requestId: `cleanup-refetch-${date}-${Date.now()}`,
      source: "perplexity-cleanup-refetch",
    });
    if (pool.hasCandidates) {
      const picked = pool.candidates.find((c) => c.recommended) ?? pool.candidates[0] ?? null;
      if (picked) {
        const tiered = tieredArticlesFromCandidates(pool.candidates);
        await storage.updateAnalysis(date, {
          topArticleId: picked.id,
          winningTier: picked.tier,
          tieredArticles: tiered,
          analyzedArticles: pool.candidates.map(candidateToArticleData),
          totalArticlesFetched: pool.candidates.length,
          uniqueArticlesAnalyzed: pool.candidates.length,
        });
        state.stats.articlesEnsured += 1;
        logLine(`  refetched ${pool.candidates.length} article(s); picked "${picked.title.slice(0, 60)}"`);
        resolved = resolveStoredWinningArticle({
          topArticleId: picked.id,
          tieredArticles: tiered,
          analyzedArticles: pool.candidates.map(candidateToArticleData),
          winningTier: picked.tier,
        });
      }
    } else {
      logLine(`  no articles found for ${date} — proceeding with summary only`);
    }
  }

  return resolved ? articleContextFromResolved(resolved) : {
    articleTitle: null,
    articleSnippet: null,
    topArticleId: analysis.topArticleId,
  };
}

async function applyTopicFix(date: string, topic: string | null, state: CleanupState): Promise<string | null> {
  if (!topic) {
    await syncStorylineAssignmentsForDate(date, []);
    await storage.updateAnalysis(date, { topicCategories: [] });
    state.stats.retaggedOff += 1;
    return null;
  }

  const linked = await ensureTopicCategoryAndStorylineLinks(date, [topic]);
  await storage.updateAnalysis(date, { topicCategories: linked });
  state.stats.topicFixed += 1;
  return linked[0] ?? topic;
}

async function applyTagsWithAgent(
  date: string,
  summary: string,
  existingTags: string[],
  state: CleanupState,
): Promise<string[]> {
  const index = await loadCanonicalTagIndex();
  const tagAgent = await suggestTagsWithAgent({
    date,
    summary,
    tags: existingTags,
    allowedAddCandidates: findGroundedTaxonomyTagsMissingFromRow({
      texts: [summary],
      currentTags: existingTags,
      index,
      limit: 12,
    }).filter(isEditorialEntityTagCandidate),
  });

  let tags = [...existingTags];
  if (tagAgent.dropTags.length > 0) {
    const dropKeys = new Set(
      tagAgent.dropTags.map((tag) => editorialTagKey(tag)).filter(Boolean),
    );
    const filtered = tags.filter((tag) => !dropKeys.has(editorialTagKey(tag) ?? ""));
    if (filtered.length !== tags.length) {
      tags = filtered;
    }
  }

  if (tagAgent.confidence === "high" && tagAgent.addTags.length > 0) {
    const adds = tagAgent.addTags.filter((tag) => isTagGroundedInTexts(tag, [summary]));
    tags = filterEditorialTagAdds([...tags, ...adds], tags);
  }

  const grounded = groundAndCanonicaliseTags({
    proposed: tags,
    texts: [summary],
    index,
  }).kept.slice(0, 2);

  const normalizedExisting = existingTags.slice(0, 2);
  const finalTags = grounded.length > 0 ? grounded : normalizedExisting;
  const changed =
    finalTags.length !== normalizedExisting.length ||
    finalTags.some((tag, idx) => tag !== normalizedExisting[idx]);

  if (changed) {
    await storage.updateAnalysis(date, { tagsVersion2: finalTags });
    state.stats.tagsFixed += 1;
    if (tagAgent.source === "llm") {
      logLine(`  tags agent → ${finalTags.join(", ") || "(none)"}`);
    }
  }
  return finalTags;
}

async function fixSummary(
  date: string,
  state: CleanupState,
  articleCtx: ArticleContext,
): Promise<string> {
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) return "";

  let summary = normalizeEditorialSummaryText(String(analysis.summary ?? "").trim());
  const quality = evaluateSummaryQuality(summary);

  if (quality?.code === "too_short") {
    const expanded = await expandShortSummaryWithAgent(date);
    if (expanded.ok) {
      const refreshed = await storage.getAnalysisByDate(date);
      summary = normalizeEditorialSummaryText(String(refreshed?.summary ?? summary).trim());
      state.stats.summaryFixed += 1;
      logLine(`  summary expanded → ${summary.length} chars`);
      return summary;
    }
  }

  const agent = await evaluateSummaryWithAgent({
    date,
    summary,
    articleTitle: articleCtx.articleTitle,
    articleSnippet: articleCtx.articleSnippet,
    topArticleId: articleCtx.topArticleId ?? analysis.topArticleId,
  });

  if (agent.suggestedSummary) {
    await storage.updateAnalysis(date, { summary: agent.suggestedSummary });
    summary = agent.suggestedSummary;
    state.stats.summaryFixed += 1;
    logLine(`  summary agent rewrite → ${summary.length} chars`);
    return summary;
  }

  if (agent.needsRegeneration) {
    const regen = await regenerateSummaryWithAgent(date);
    if (regen.ok) {
      const refreshed = await storage.getAnalysisByDate(date);
      summary = normalizeEditorialSummaryText(String(refreshed?.summary ?? summary).trim());
      state.stats.summaryFixed += 1;
      logLine(`  summary regenerated → ${summary.length} chars`);
      return summary;
    }
    if (regen.message?.includes("Top article id missing") || regen.message?.includes("Winning article missing")) {
      logLine(`  summary regen skipped — ${regen.message}`);
    }
  }

  if (quality) {
    logLine(`  summary still weak (${quality.message}) — proceeding with verify`);
  }

  return summary;
}

async function processFlaggedRow(
  leaf: string,
  date: string,
  priorVerdict: "no" | "uncertain",
  state: CleanupState,
  delayMs: number,
): Promise<void> {
  state.stats.attempted += 1;
  logLine(`CLEANUP AGENT ${leaf} · ${date} · was ${priorVerdict}`);

  try {
    const analysis = await storage.getAnalysisByDate(date);
    if (!analysis) {
      logLine(`  skip — no analysis row`);
      return;
    }

    const articleCtx = await ensureWinningArticle(date, state);

    let summary = normalizeEditorialSummaryText(String(analysis.summary ?? "").trim());
    const retrospective = evaluateGoogleCheckRetrospectiveHeuristic(summary);
    if (retrospective.isRetrospective) {
      logLine(`  retrospective heuristic (${retrospective.reason ?? "retrospective"}) — clearing topic`);
      await applyTopicFix(date, null, state);
    }

    summary = await fixSummary(date, state, articleCtx);

    const tags = currentTags(analysis);
    const topics = currentTopics(analysis);
    const topicResult = await suggestTopicsWithAgent({
      date,
      summary,
      tags,
      currentTopics: topics,
      expectedLeaf: leaf,
    });

    let topicForVerify = leaf;
    if (topicResult.recommended && topicResult.recommended !== leaf) {
      logLine(`  topic ${leaf} → ${topicResult.recommended} (${topicResult.reason || "agent"})`);
      const applied = await applyTopicFix(date, topicResult.recommended, state);
      topicForVerify = applied ?? topicResult.recommended;
    } else if (
      (!topicResult.recommended && topicResult.confidence === "low") ||
      (!topicResult.recommended && priorVerdict === "no")
    ) {
      logLine(`  no good topic fit — clearing assignment`);
      await applyTopicFix(date, null, state);
      topicForVerify = leaf;
    } else if (topics.length === 0 && topicResult.recommended) {
      await applyTopicFix(date, topicResult.recommended, state);
      topicForVerify = topicResult.recommended;
    }

    await applyTagsWithAgent(date, summary, tags, state);

    const refreshed = await storage.getAnalysisByDate(date);
    summary = normalizeEditorialSummaryText(String(refreshed?.summary ?? summary).trim());

    const verify = await runGoogleCheckSingleWithRetry(
      { date, summary, topicLeaf: topicForVerify },
      { delayAfterMs: delayMs },
    );

    await storage.updateAnalysisGoogleCheck(date, {
      googleCheckHappened: verify.happened,
      googleCheckCheckedAt: new Date(),
    });

    if (verify.happened === "yes") {
      state.stats.upgradedToYes += 1;
      markResolved(state, leaf, date);
    } else if (verify.happened === "no") {
      state.stats.stillNo += 1;
    } else {
      state.stats.stillUncertain += 1;
    }

    logLine(`  ✓ re-verify → ${verify.happened} · ${summary.length} chars`);
  } catch (error) {
    state.stats.errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    logLine(`  ✗ error: ${message}`);
  } finally {
    saveState(state);
  }
}

async function runCleanupPass(state: CleanupState, delayMs: number): Promise<number> {
  const resolved = resolvedSet(state);
  let worked = 0;

  const readyLeaves: string[] = [];
  const notReadyLeaves: string[] = [];
  const leafRows = new Map<string, Awaited<ReturnType<typeof storage.getAnalysesForStorylineLeaf>>>();

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    const ready = await isLeafReadyForCleanup(leaf);
    if (ready) {
      readyLeaves.push(leaf);
      leafRows.set(leaf, await storage.getAnalysesForStorylineLeaf(leaf));
    } else {
      notReadyLeaves.push(leaf);
    }
  }

  const newlyReady = readyLeaves.filter((leaf) => !readyLeavesSeen.has(leaf));
  if (newlyReady.length > 0) {
    logLine(
      `NEWLY COMPLETED: ${newlyReady.map((leaf) => formatTopicLeafWithGroup(leaf)).join(", ")}`,
    );
  }
  for (const leaf of readyLeaves) {
    readyLeavesSeen.add(leaf);
  }

  const orderedReadyLeaves = [
    ...newlyReady,
    ...readyLeaves.filter((leaf) => !newlyReady.includes(leaf)),
  ];

  for (const leaf of notReadyLeaves) {
    const unchecked = await leafUncheckedCount(leaf);
    if (unchecked > 0) {
      logLine(`SKIP ${formatTopicLeafWithGroup(leaf)} · ${unchecked} unchecked (bulk still running on leaf)`);
    }
  }

  for (const leaf of orderedReadyLeaves) {
    const rows = leafRows.get(leaf) ?? [];
    const uncertainTotal = rows.filter((row) => row.googleCheckHappened === "uncertain").length;
    const noTotal = rows.filter((row) => row.googleCheckHappened === "no").length;
    const flagged = pickFlaggedRows(leaf, rows, resolved);
    if (flagged.length === 0) continue;

    const uncertainQueued = flagged.filter((row) => row.googleCheckHappened === "uncertain").length;
    const noQueued = flagged.filter((row) => row.googleCheckHappened === "no").length;
    logLine(
      `AGENT ${leaf}: ${uncertainQueued} uncertain, ${noQueued} no queued (${uncertainTotal} uncertain · ${noTotal} no on leaf)`,
    );

    for (const row of flagged) {
      const verdict = row.googleCheckHappened === "no" ? "no" : "uncertain";
      await processFlaggedRow(leaf, row.date, verdict, state, delayMs);
      worked += 1;
      await sleep(randomDelayMs());
    }
  }

  return worked;
}

function logStats(state: CleanupState): void {
  const s = state.stats;
  logLine(
    `STATS attempted=${s.attempted} upgraded_yes=${s.upgradedToYes} still_no=${s.stillNo} still_uncertain=${s.stillUncertain} summary_fixed=${s.summaryFixed} topic_fixed=${s.topicFixed} tags_fixed=${s.tagsFixed} articles_ensured=${s.articlesEnsured} retagged_off=${s.retaggedOff} errors=${s.errors}`,
  );
}

async function main() {
  const args = parseArgs();

  if (!process.env.PERPLEXITY_API_KEY?.trim()) {
    console.error("PERPLEXITY_API_KEY is required (client/.env)");
    process.exit(1);
  }

  ensureLogDir();
  const state = loadState();

  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    if (await isLeafReadyForCleanup(leaf)) {
      readyLeavesSeen.add(leaf);
    }
  }

  logLine("=== Perplexity cleanup loop started ===");
  logLine(`Delay after verify: ${args.delayMs}ms (0-500ms jitter between rows)`);
  logStats(state);

  while (true) {
    const worked = await runCleanupPass(state, args.delayMs);
    logStats(state);

    if (worked === 0) {
      logLine(`No new flagged rows on completed leaves — sleeping ${IDLE_WAIT_MS / 1000}s`);
      await sleep(IDLE_WAIT_MS);
    } else {
      await sleep(BETWEEN_PASS_MS);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logLine(`FATAL: ${message}`);
  console.error("Cleanup loop failed:", message);
  process.exit(1);
});

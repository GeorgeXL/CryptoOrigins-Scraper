import type { HistoricalNewsAnalysis } from "@shared/schema";

import { cacheManager } from "./cache-manager";
import { entityExtractor } from "./entity-extractor";
import { storage } from "../storage";

const MAX_CONCURRENT = 8;

function invalidateTagCatalogCache() {
  cacheManager.invalidate("tags:catalog-v2");
  cacheManager.invalidate("tags:catalog-v2:manual");
}

type BatchJobState = {
  shouldStop: boolean;
  isRunning: boolean;
  processed: number;
  total: number;
};

function createJobState(): BatchJobState {
  return {
    shouldStop: false,
    isRunning: false,
    processed: 0,
    total: 0,
  };
}

const batchTagging = createJobState();
const contextTagging = createJobState();

function filterEligibleAnalyses(
  allAnalyses: HistoricalNewsAnalysis[],
  dates?: string[] | null,
): HistoricalNewsAnalysis[] {
  const hasSummary = (analysis: HistoricalNewsAnalysis) =>
    Boolean(analysis.summary && analysis.summary.trim().length > 0);

  const isUntagged = (analysis: HistoricalNewsAnalysis) =>
    !analysis.tagsVersion2 ||
    (Array.isArray(analysis.tagsVersion2) && analysis.tagsVersion2.length === 0);

  if (dates && Array.isArray(dates) && dates.length > 0) {
    return allAnalyses.filter(
      (analysis) => dates.includes(analysis.date) && hasSummary(analysis) && isUntagged(analysis),
    );
  }

  return allAnalyses.filter((analysis) => hasSummary(analysis) && isUntagged(analysis));
}

async function runConcurrentBatch(
  analyses: HistoricalNewsAnalysis[],
  state: BatchJobState,
  processAnalysis: (analysis: HistoricalNewsAnalysis, currentIndex: number) => Promise<{ success: boolean; date: string }>,
  label: string,
): Promise<void> {
  let processed = 0;
  let failed = 0;
  const failedDates: string[] = [];
  const running = new Map<string, Promise<{ success: boolean; date: string }>>();
  let index = 0;

  const runOne = async (analysis: HistoricalNewsAnalysis) => {
    const currentIndex = processed + failed + 1;
    try {
      const result = await processAnalysis(analysis, currentIndex);
      if (result.success) {
        processed++;
      } else {
        failed++;
        failedDates.push(analysis.date);
      }
      state.processed = processed + failed;
      return result;
    } catch (error) {
      console.error(`❌ Error tagging ${analysis.date}:`, error);
      failed++;
      failedDates.push(analysis.date);
      state.processed = processed + failed;
      return { success: false, date: analysis.date };
    }
  };

  while (index < analyses.length || running.size > 0) {
    if (state.shouldStop) {
      console.log(`🛑 ${label} stopped by user after ${processed} analyses (${failed} failed)`);
      break;
    }

    while (running.size < MAX_CONCURRENT && index < analyses.length) {
      const analysis = analyses[index];
      const promise = runOne(analysis);
      running.set(analysis.date, promise);
      index++;
    }

    if (running.size > 0) {
      const completed = await Promise.race(
        Array.from(running.entries()).map(([date, promise]) =>
          promise
            .then((result) => ({ result, date }))
            .catch((error) => {
              console.error(`Promise error for ${date}:`, error);
              return { result: { success: false, date }, date };
            }),
        ),
      );
      running.delete(completed.date);

      if (index < analyses.length && running.size < MAX_CONCURRENT) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  console.log(`✅ ${label} completed: ${processed} successful, ${failed} failed`);
  if (failedDates.length > 0) {
    console.log(`❌ Failed dates: ${failedDates.join(", ")}`);
  }

  invalidateTagCatalogCache();
  state.isRunning = false;
}

async function getArticleContent(analysis: HistoricalNewsAnalysis): Promise<string | null> {
  try {
    if (!analysis.topArticleId || analysis.topArticleId === "none") {
      return null;
    }

    const tieredArticles = analysis.tieredArticles as Record<string, Array<Record<string, unknown>>> | null;
    if (tieredArticles && typeof tieredArticles === "object") {
      for (const tier of ["bitcoin", "crypto", "macro"] as const) {
        const tierArticles = tieredArticles[tier] || [];
        const article = tierArticles.find((item) => item.id === analysis.topArticleId);
        if (article) {
          return (
            (article.text as string | undefined) ||
            (article.summary as string | undefined) ||
            (article.content as string | undefined) ||
            null
          );
        }
      }
    }

    if (analysis.analyzedArticles && Array.isArray(analysis.analyzedArticles)) {
      const article = analysis.analyzedArticles.find((item: { id?: string }) => item.id === analysis.topArticleId);
      if (article) {
        return article.text || article.summary || article.content || null;
      }
    }

    return null;
  } catch (error) {
    console.error(`Error fetching article for ${analysis.date}:`, error);
    return null;
  }
}

export async function startBatchTagging(dates?: string[] | null) {
  if (batchTagging.isRunning) {
    throw new Error("Batch tagging already running. Please stop the current one first.");
  }

  const allAnalyses = await storage.getAllAnalyses();
  const eligibleAnalyses = filterEligibleAnalyses(allAnalyses, dates);
  batchTagging.total = eligibleAnalyses.length;
  batchTagging.processed = 0;
  batchTagging.shouldStop = false;
  batchTagging.isRunning = true;

  void runConcurrentBatch(
    eligibleAnalyses,
    batchTagging,
    async (analysis, currentIndex) => {
      console.log(`🏷️ [${currentIndex}/${batchTagging.total}] Extracting tags for ${analysis.date}...`);
      const tagNames = await entityExtractor.extractEntities(analysis.summary);
      await storage.updateAnalysis(analysis.date, { tagsVersion2: tagNames });
      console.log(
        `✅ Tagged ${analysis.date} with ${tagNames.length} tags: ${tagNames.slice(0, 5).join(", ")}${tagNames.length > 5 ? "..." : ""}`,
      );
      return { success: true, date: analysis.date };
    },
    "Batch tagging",
  );

  return { total: batchTagging.total };
}

export function stopBatchTagging() {
  if (!batchTagging.isRunning) {
    throw new Error("No batch tagging process is currently running");
  }

  batchTagging.shouldStop = true;
  return {
    processed: batchTagging.processed,
    total: batchTagging.total,
  };
}

export function getBatchTaggingStatus() {
  return {
    isRunning: batchTagging.isRunning,
    processed: batchTagging.processed,
    total: batchTagging.total,
    progress:
      batchTagging.total > 0
        ? Math.round((batchTagging.processed / batchTagging.total) * 100)
        : 0,
  };
}

export async function startContextTagging(dates?: string[] | null) {
  if (contextTagging.isRunning) {
    throw new Error("Context tagging already running. Please stop the current one first.");
  }

  const allAnalyses = await storage.getAllAnalyses();
  const eligibleAnalyses = filterEligibleAnalyses(allAnalyses, dates);
  contextTagging.total = eligibleAnalyses.length;
  contextTagging.processed = 0;
  contextTagging.shouldStop = false;
  contextTagging.isRunning = true;

  void runConcurrentBatch(
    eligibleAnalyses,
    contextTagging,
    async (analysis, currentIndex) => {
      console.log(`🏷️ [${currentIndex}/${contextTagging.total}] Extracting tags with context for ${analysis.date}...`);
      const articleContent = await getArticleContent(analysis);
      let tagNames: string[];

      if (articleContent && articleContent.trim().length > 0) {
        tagNames = await entityExtractor.extractEntitiesWithContext(analysis.summary, articleContent);
        console.log(`   📰 Using article context (${articleContent.length} chars)`);
      } else {
        console.log("   ⚠️ No article content found, using summary only");
        tagNames = await entityExtractor.extractEntities(analysis.summary);
      }

      await storage.updateAnalysis(analysis.date, { tagsVersion2: tagNames });
      console.log(
        `✅ Tagged ${analysis.date} with ${tagNames.length} tags: ${tagNames.slice(0, 5).join(", ")}${tagNames.length > 5 ? "..." : ""}`,
      );
      return { success: true, date: analysis.date };
    },
    "Context tagging",
  );

  return { total: contextTagging.total };
}

export function stopContextTagging() {
  if (!contextTagging.isRunning) {
    throw new Error("No context tagging process is currently running");
  }

  contextTagging.shouldStop = true;
  return {
    processed: contextTagging.processed,
    total: contextTagging.total,
  };
}

export function getContextTaggingStatus() {
  return {
    isRunning: contextTagging.isRunning,
    processed: contextTagging.processed,
    total: contextTagging.total,
    progress:
      contextTagging.total > 0
        ? Math.round((contextTagging.processed / contextTagging.total) * 100)
        : 0,
  };
}

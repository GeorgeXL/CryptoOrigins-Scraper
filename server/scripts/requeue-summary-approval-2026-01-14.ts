import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses, humanReviewQueue, pipelineRuns, type ArticleData } from "@shared/schema";
import { entityExtractor } from "../services/entity-extractor";
import { groundAndCanonicaliseTags, loadCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";
import { normalizeTagValue, normalizeTopicList } from "../services/editorial-pipeline/tools";

const DATE = "2026-01-14";
const DEFAULT_TOPICS = ["industry-news"];

function companyTagsFromTitle(title: string): string[] {
  const t = title.trim();
  if (!t) return [];
  const m = t.match(
    /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,4})\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC)\b/,
  );
  if (!m) return [];
  const core = m[1]?.trim();
  return core ? [core] : [];
}

function dedupeSemanticTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim();
    if (!t) continue;
    const key = normalizeTagValue(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function parseTopTitle(topArticleId: string | null, tieredArticles: unknown, analyzedArticles: unknown): string {
  const pickFrom = (arr: unknown): string | null => {
    if (!Array.isArray(arr)) return null;
    for (const a of arr as ArticleData[]) {
      if (a?.id === topArticleId && typeof a.title === "string" && a.title.trim()) return a.title.trim();
    }
    return null;
  };
  if (tieredArticles && typeof tieredArticles === "object") {
    const t = tieredArticles as Record<string, unknown>;
    return (
      pickFrom(t.bitcoin) ??
      pickFrom(t.crypto) ??
      pickFrom(t.macro) ??
      pickFrom(analyzedArticles) ??
      "Winning article"
    );
  }
  return pickFrom(analyzedArticles) ?? "Winning article";
}

async function main() {
  const [day] = await db
    .select({
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      tierUsed: historicalNewsAnalyses.tierUsed,
      tieredArticles: historicalNewsAnalyses.tieredArticles,
      analyzedArticles: historicalNewsAnalyses.analyzedArticles,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, DATE))
    .limit(1);
  if (!day) throw new Error(`No day row for ${DATE}`);

  const alreadyPending = await db
    .select({ id: humanReviewQueue.id })
    .from(humanReviewQueue)
    .where(and(eq(humanReviewQueue.eventDate, DATE), eq(humanReviewQueue.status, "pending")))
    .limit(1);
  if (alreadyPending.length) {
    console.log(`Pending item already exists: ${alreadyPending[0].id}`);
    return;
  }

  const [latestRun] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  if (!latestRun) throw new Error("No pipeline run found");

  const summary = (day.summary ?? "").trim();
  const topTitle = parseTopTitle(day.topArticleId, day.tieredArticles, day.analyzedArticles);

  let proposedTags: string[] = [];
  try {
    const raw = await entityExtractor.extractEntitiesWithContext(summary, topTitle);
    const index = await loadCanonicalTagIndex();
    const grounded = groundAndCanonicaliseTags({ proposed: raw, texts: [summary], index });
    proposedTags = grounded.kept;
  } catch {
    proposedTags = [];
  }
  for (const extra of companyTagsFromTitle(topTitle)) {
    if (!proposedTags.some((t) => t.toLowerCase() === extra.toLowerCase())) proposedTags.push(extra);
  }
  proposedTags = dedupeSemanticTags(proposedTags);

  const pkg = {
    phase: "awaiting_summary_approval",
    triage: {
      date: DATE,
      route: "missing_day",
      reasons: ["manual requeue for summary approval"],
      hasRow: true,
      summaryLength: summary.length,
      topArticleId: day.topArticleId,
      tagsVersion2Before: [],
      topicCategoriesBefore: [],
    },
    winningArticle: {
      id: day.topArticleId ?? `manual-${DATE}`,
      title: topTitle,
      url: day.topArticleId ?? "https://example.com",
      tier: (day.tierUsed === "crypto" || day.tierUsed === "macro" ? day.tierUsed : "bitcoin") as
        | "bitcoin"
        | "crypto"
        | "macro",
    },
    generatedSummary: summary,
    proposedTags,
    proposedTopics: normalizeTopicList(DEFAULT_TOPICS),
    note: "Requeued summary approval after fallback tag/topic fix.",
  };

  const inserted = await db
    .insert(humanReviewQueue)
    .values({
      runId: latestRun.id,
      stepId: null,
      status: "pending",
      priority: 88,
      eventDate: DATE,
      package: pkg,
      reviewer: null,
      reviewedAt: null,
      reviewNotes: null,
    })
    .returning({ id: humanReviewQueue.id });

  console.log({ insertedId: inserted[0]?.id, proposedTags, proposedTopics: pkg.proposedTopics });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

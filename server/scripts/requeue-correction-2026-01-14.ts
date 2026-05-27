import "dotenv/config";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses, humanReviewQueue, pipelineRuns, type ArticleData } from "@shared/schema";
import { buildCorrectionProposals } from "../services/editorial-pipeline/proposals";
import { loadCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";

const DATE = "2026-01-14";

function articleTextFromRow(tieredArticles: unknown, analyzedArticles: unknown): string {
  const parts: string[] = [];
  const push = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const article of arr as ArticleData[]) {
      if (typeof article.title === "string") parts.push(article.title);
      if (typeof article.summary === "string") parts.push(article.summary);
      if (typeof article.text === "string") parts.push(article.text);
    }
  };
  if (tieredArticles && typeof tieredArticles === "object") {
    const t = tieredArticles as Record<string, unknown>;
    push(t.bitcoin);
    push(t.crypto);
    push(t.macro);
  }
  push(analyzedArticles);
  return parts.join("\n");
}

async function main() {
  await db.execute(sql.raw(`delete from human_review_queue where event_date = '${DATE}' and status = 'pending'`));

  const [row] = await db
    .select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, DATE))
    .limit(1);
  if (!row) throw new Error(`No analysis row for ${DATE}`);

  const [latestRun] = await db.select({ id: pipelineRuns.id }).from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(1);
  if (!latestRun) throw new Error("No pipeline run available");

  const canonicalTagIndex = await loadCanonicalTagIndex();
  const proposals = buildCorrectionProposals({
    date: DATE,
    summary: row.summary,
    topArticleId: row.topArticleId,
    isOrphan: row.isOrphan,
    isFlagged: row.isFlagged,
    tagsVersion2: row.tagsVersion2,
    topicCategories: row.topicCategories,
    legacyTags: row.tags,
    articleText: articleTextFromRow(row.tieredArticles, row.analyzedArticles),
    canonicalTagIndex,
  });

  const pkg = {
    phase: "awaiting_correction_approval",
    triage: {
      date: DATE,
      route: "existing_needs_correction",
      reasons: proposals.map((p) => p.rationale),
      analysisId: row.id,
      confidence: 0.75,
      requiredAgents: ["TagManagerAgent", "FinalEditorAgent"],
    },
    proposals,
    note: `Pipeline detected ${proposals.length} suggested fix(es). Each is opt-in below.`,
  };

  const inserted = await db
    .insert(humanReviewQueue)
    .values({
      runId: latestRun.id,
      stepId: null,
      status: "pending",
      priority: 75,
      eventDate: DATE,
      package: pkg,
      reviewer: null,
      reviewNotes: null,
      reviewedAt: null,
    })
    .returning({ id: humanReviewQueue.id });

  console.log({ insertedId: inserted[0]?.id, proposals: proposals.map((p) => p.kind) });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });


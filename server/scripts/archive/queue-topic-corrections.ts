/**
 * Scan historical days with invalid/legacy topics and queue correction packages
 * (Topic Agent suggestions via buildCorrectionProposalsAsync).
 *
 * Usage:
 *   npx tsx server/scripts/queue-topic-corrections.ts --from 2009-01-01 --to 2009-12-31
 *   npx tsx server/scripts/queue-topic-corrections.ts --from 2009-01-01 --to 2009-12-31 --dry-run
 *   npx tsx server/scripts/queue-topic-corrections.ts --from 2009-01-01 --to 2009-12-31 --limit 20 --queue
 *
 * Flags:
 *   --from / --to   Date range (inclusive, YYYY-MM-DD)
 *   --limit N       Max days to process (default 50)
 *   --dry-run       Print scan results only (default when --queue omitted)
 *   --queue         Insert pending human_review_queue rows
 *   --skip-pending  Skip dates that already have a pending queue item (default true)
 */
import "dotenv/config";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db";
import {
  historicalNewsAnalyses,
  humanReviewQueue,
  pipelineRuns,
  type ArticleData,
} from "@shared/schema";
import { buildCorrectionProposalsAsync } from "../services/editorial-pipeline/proposals";
import { loadCanonicalTagIndex } from "../services/editorial-pipeline/tag-grounding";
import { topicLabelsFromRow } from "../services/editorial-pipeline/tools";
import { invalidTopicReasons } from "../services/editorial-pipeline/topic-validation";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    from: get("--from") ?? "2009-01-01",
    to: get("--to") ?? "2009-12-31",
    limit: Number(get("--limit") ?? "50"),
    dryRun: !argv.includes("--queue"),
    skipPending: !argv.includes("--include-pending"),
  };
}

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

async function hasPendingQueue(date: string): Promise<boolean> {
  const [row] = await db
    .select({ id: humanReviewQueue.id })
    .from(humanReviewQueue)
    .where(and(eq(humanReviewQueue.eventDate, date), eq(humanReviewQueue.status, "pending")))
    .limit(1);
  return Boolean(row);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error("--limit must be a positive number");
  }

  console.log(
    JSON.stringify(
      {
        from: args.from,
        to: args.to,
        limit: args.limit,
        mode: args.dryRun ? "dry-run" : "queue",
        skipPending: args.skipPending,
        topicAgentDisabled: process.env.TOPIC_AGENT_DISABLED === "1",
      },
      null,
      2,
    ),
  );

  const rows = await db
    .select()
    .from(historicalNewsAnalyses)
    .where(
      and(
        gte(historicalNewsAnalyses.date, args.from),
        lte(historicalNewsAnalyses.date, args.to),
      ),
    )
    .orderBy(asc(historicalNewsAnalyses.date));

  const candidates: typeof rows = [];
  for (const row of rows) {
    const topics = topicLabelsFromRow(row.topicCategories);
    const issues = invalidTopicReasons(topics);
    if (issues.length === 0) continue;
    if (args.skipPending && (await hasPendingQueue(row.date))) continue;
    candidates.push(row);
    if (candidates.length >= args.limit) break;
  }

  console.log(`\nFound ${candidates.length} day(s) with topic issues in range (limit ${args.limit}).\n`);

  if (candidates.length === 0) {
    return;
  }

  const [latestRun] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  if (!latestRun && !args.dryRun) {
    throw new Error("No pipeline run available — create a run before queuing");
  }

  const canonicalTagIndex = await loadCanonicalTagIndex();
  let queued = 0;

  for (const row of candidates) {
    const topics = topicLabelsFromRow(row.topicCategories);
    const issues = invalidTopicReasons(topics);
    const proposals = await buildCorrectionProposalsAsync({
      date: row.date,
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

    const topicProposal = proposals.find((p) => p.kind === "set_topic_categories");
    const summaryLine = {
      date: row.date,
      issues,
      topics,
      proposalKinds: proposals.map((p) => p.kind),
      topicAgentSource:
        topicProposal?.kind === "set_topic_categories" ? topicProposal.topicAgentSource ?? null : null,
      proposed:
        topicProposal?.kind === "set_topic_categories" ? topicProposal.proposed?.slice(0, 3) : [],
      rationale: topicProposal?.kind === "set_topic_categories" ? topicProposal.rationale?.slice(0, 120) : null,
    };
    console.log(JSON.stringify(summaryLine));

    if (args.dryRun || proposals.length === 0) continue;

    const pkg = {
      phase: "awaiting_correction_approval" as const,
      triage: {
        date: row.date,
        route: "existing_needs_correction" as const,
        reasons: [`Topic backfill: ${issues.join("; ")}`],
        analysisId: row.id,
        confidence: 0.72,
        requiredAgents: ["TopicValidatorAgent", "FinalEditorAgent"],
      },
      proposals,
      note: `Bulk topic backfill — ${issues.join("; ")}. Approve set_topic_categories to fix.`,
    };

    await db.insert(humanReviewQueue).values({
      runId: latestRun!.id,
      stepId: null,
      status: "pending",
      priority: 72,
      eventDate: row.date,
      package: pkg,
      reviewer: null,
      reviewNotes: null,
      reviewedAt: null,
    });
    queued += 1;
  }

  console.log(`\nDone. ${args.dryRun ? "Would queue" : "Queued"} ${args.dryRun ? candidates.length : queued} day(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

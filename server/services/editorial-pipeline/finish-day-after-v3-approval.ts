/**
 * After v3 summary approval (or full final-agent pipeline), run Google Check →
 * lock (on yes) → rarity when eligible.
 */

import { and, count, eq } from "drizzle-orm";
import { db } from "../../db";
import { humanReviewQueue } from "@shared/schema";
import { storage } from "../../storage";
import { isDayLocked } from "../day-lock";
import { runGoogleCheckSingleWithRetry } from "../homepage-checks/google-check";
import { persistRarityResults, runRarityBatch } from "../homepage-checks/rarity-check";
import { ALL_PIPELINE_CHECK_SCOPES } from "./contracts";
import { getEditorialPipelineRun, startEditorialPipelineRun } from "./run";
import { normalizedTagsFromRow, topicLabelsFromRow } from "./tools";

const POLL_MS = 1500;
const PIPELINE_TIMEOUT_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countPendingReviewForDate(date: string): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(humanReviewQueue)
    .where(and(eq(humanReviewQueue.eventDate, date), eq(humanReviewQueue.status, "pending")));
  return Number(row?.c ?? 0);
}

async function waitForPipelineRun(runId: string): Promise<{ status: string }> {
  const start = Date.now();
  while (Date.now() - start < PIPELINE_TIMEOUT_MS) {
    const detail = await getEditorialPipelineRun(runId);
    if (!detail) throw new Error(`Pipeline run ${runId} not found`);
    const status = (detail.run as { status?: string }).status ?? "unknown";
    if (status !== "running") {
      return { status };
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Pipeline run ${runId} timed out after ${PIPELINE_TIMEOUT_MS}ms`);
}

export type FinishDayAfterV3Result = {
  ok: boolean;
  phase:
    | "skipped_locked"
    | "pipeline_failed"
    | "queued_review"
    | "tags_missing"
    | "topics_missing"
    | "google_check"
    | "complete";
  runId?: string;
  message: string;
  googleHappened?: "yes" | "no" | "uncertain";
  rarity?: string | null;
};

/** Google Check → rarity tail (no pipeline re-run). */
export async function runGoogleCheckAndRarityForDay(opts: {
  date: string;
  runId?: string;
}): Promise<FinishDayAfterV3Result> {
  const { date, runId } = opts;

  if (await isDayLocked(date)) {
    const row = await storage.getAnalysisByDate(date);
    if (row?.googleCheckHappened === "yes" && row.isLocked) {
      const batch = await runRarityBatch([{ date, summary: row.summary }]);
      await persistRarityResults(batch);
      const rarityResult = batch.results[date]?.rarity ?? row.rarity ?? null;
      return {
        ok: true,
        phase: "complete",
        runId,
        googleHappened: "yes",
        rarity: rarityResult,
        message: `${date}: already locked with Google Check yes${rarityResult ? `, rarity=${rarityResult}` : ""}.`,
      };
    }
    return {
      ok: true,
      phase: "skipped_locked",
      message: `${date} is locked — skipped final-agent finish.`,
    };
  }

  const pendingCount = await countPendingReviewForDate(date);
  if (pendingCount > 0) {
    return {
      ok: true,
      phase: "queued_review",
      runId,
      message: `${date}: ${pendingCount} review item(s) still pending — resolve in Agents, then run Final Agent for Google Check + rarity.`,
    };
  }

  const row = await storage.getAnalysisByDate(date);
  const tags = row ? normalizedTagsFromRow(row.tagsVersion2) : [];
  if (!row?.summary?.trim()) {
    return {
      ok: true,
      phase: "tags_missing",
      runId,
      message: `${date}: summary is empty — add a summary on the day page, then run Final Agent.`,
    };
  }
  if (tags.length === 0) {
    return {
      ok: true,
      phase: "tags_missing",
      runId,
      message: `${date}: tags are empty — add tags on the day page, then run Final Agent.`,
    };
  }

  const topics = topicLabelsFromRow(row.topicCategories);
  if (topics.length === 0) {
    return {
      ok: true,
      phase: "topics_missing",
      runId,
      message: `${date}: no storyline topic assigned — pick a topic on the day page, then run Final Agent.`,
    };
  }
  const topicLeaf = topics[0] ?? null;

  try {
    const google = await runGoogleCheckSingleWithRetry({
      date,
      summary: row.summary,
      topicLeaf,
    });
    await storage.updateAnalysisGoogleCheck(date, {
      googleCheckHappened: google.happened,
      googleCheckCheckedAt: new Date(),
    });

    if (google.happened !== "yes") {
      return {
        ok: true,
        phase: "google_check",
        runId,
        googleHappened: google.happened,
        message: `${date}: Google Check → ${google.happened}. Day not locked; rarity skipped.`,
      };
    }

    const refreshed = await storage.getAnalysisByDate(date);
    if (!refreshed?.isLocked) {
      return {
        ok: true,
        phase: "google_check",
        runId,
        googleHappened: "yes",
        message: `${date}: Google Check yes but day not locked (needs a valid storyline topic) — rarity skipped.`,
      };
    }

    const batch = await runRarityBatch([{ date, summary: refreshed.summary }]);
    await persistRarityResults(batch);
    const rarityResult = batch.results[date]?.rarity ?? null;

    return {
      ok: true,
      phase: "complete",
      runId,
      googleHappened: "yes",
      rarity: rarityResult,
      message: `${date}: final-agent finish complete — Google Check yes${rarityResult ? `, rarity=${rarityResult}` : ", rarity not assigned"}.`,
    };
  } catch (err) {
    return {
      ok: false,
      phase: "google_check",
      runId,
      message: `${date}: Google Check/rarity failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Full pipeline then Google Check + rarity (bulk final-agent from quality check). */
export async function runFullFinalAgentForDay(opts: {
  date: string;
  reviewer?: string | null;
}): Promise<FinishDayAfterV3Result> {
  const { date, reviewer } = opts;

  if (await isDayLocked(date)) {
    return runGoogleCheckAndRarityForDay({ date });
  }

  const pendingBeforeRun = await countPendingReviewForDate(date);
  if (pendingBeforeRun > 0) {
    return {
      ok: true,
      phase: "queued_review",
      message: `${date}: skipped — ${pendingBeforeRun} review item(s) already pending in Agents. Resolve those first, then re-run Final Agent.`,
    };
  }

  let runId: string;
  try {
    const started = await startEditorialPipelineRun({
      dateFrom: date,
      dateTo: date,
      maxDaysToConsider: 1,
      requestedBy: `final-agent:${reviewer ?? "anon"}`,
      checkScopes: [...ALL_PIPELINE_CHECK_SCOPES],
      targetDates: [date],
      ignoreDayLock: true,
    });
    runId = started.runId;
  } catch (err) {
    return {
      ok: false,
      phase: "pipeline_failed",
      message: `Failed to start final-agent pipeline for ${date}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  console.log(`[final-agent] ${date}: started pipeline runId=${runId}`);

  let pipelineStatus: string;
  try {
    const waited = await waitForPipelineRun(runId);
    pipelineStatus = waited.status;
  } catch (err) {
    return {
      ok: false,
      phase: "pipeline_failed",
      runId,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (pipelineStatus !== "completed") {
    return {
      ok: pipelineStatus !== "error",
      phase: "pipeline_failed",
      runId,
      message: `Final-agent pipeline for ${date} ended with status=${pipelineStatus}. Google Check skipped.`,
    };
  }

  return runGoogleCheckAndRarityForDay({ date, runId });
}

/**
 * After operator approves summary on the Agents page — do NOT re-run pipeline
 * (that re-queues review items). Continue with Google Check → rarity only.
 */
export async function finishDayAfterV3SummaryApproval(opts: {
  date: string;
  reviewer?: string | null;
}): Promise<FinishDayAfterV3Result> {
  console.log(`[v3-summary-finish] ${opts.date}: continuing with Google Check + rarity`);
  return runGoogleCheckAndRarityForDay({ date: opts.date });
}

export function metadataApprovalPhaseWantsFinishTail(phase: string | null | undefined): boolean {
  return phase === "awaiting_summary_approval" || phase === "awaiting_correction_approval";
}

/** Fire-and-forget wrapper so summary-approval HTTP responses stay fast. */
export function scheduleFinishDayAfterV3SummaryApproval(opts: {
  date: string;
  reviewer?: string | null;
}): void {
  void finishDayAfterV3SummaryApproval(opts)
    .then((result) => {
      console.log(`[v3-summary-finish] ${opts.date}: ${result.message}`);
    })
    .catch((err) => {
      console.error(`[v3-summary-finish] ${opts.date} failed:`, err);
    });
}

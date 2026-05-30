import { Router } from "express";
import { asc, desc, eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses, humanReviewQueue, pipelineRuns } from "@shared/schema";
import { requireAgentSecret } from "../services/agents-sdk/auth";
import {
  ALL_PIPELINE_CHECK_SCOPES,
  pipelineAgentSchema,
  pipelineCheckScopeSchema,
  type PipelineCheckScope,
} from "../services/editorial-pipeline/contracts";
import {
  getEditorialCutoverStatus,
  getEditorialPipelineRun,
  getEditorialResumeOptions,
  continueExistingDayChecksAfterKeepingStoryline,
  pauseEditorialPipelineRun,
  resumeEditorialPipelineRun,
  shadowValidatePipelineWindow,
  startEditorialPipelineResumeSlice,
  startEditorialPipelineRun,
  stopEditorialPipelineRun,
} from "../services/editorial-pipeline/run";
import {
  executeApprovedReviewItem,
  rerunPipelineForDate,
  type CalendarDecisionInput,
  type DuplicateDecisionInput,
} from "../services/editorial-pipeline/approved-writer";
import { evaluateCandidateStorySanity } from "../services/editorial-pipeline/source-finder-v2";
import { detectMilestoneGapsInWindow } from "../services/editorial-pipeline/milestones";
import { isValidPipelineTopArticleId } from "../services/editorial-pipeline/editorial-quality";
import {
  type ArticleCandidate,
  isArticlePickPackage,
  isCalendarDecisionPackage,
  isCorrectionApprovalPackage,
  isDuplicateDecisionPackage,
  isSummaryApprovalPackage,
} from "../services/editorial-pipeline/review-package";
import { computeOperatorActionPlan } from "../services/editorial-pipeline/operator-action";
import type { TriageRoute } from "../services/editorial-pipeline/contracts";

const CALENDAR_DECISIONS: CalendarDecisionInput[] = ["move_to_canonical", "keep_as_is", "delete"];
const DUPLICATE_DECISIONS: DuplicateDecisionInput[] = [
  "keep_both",
  "delete_focal",
  "delete_neighbor",
  "differentiate",
  "find_another_event",
];

function isTransientDbNetworkError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    /getaddrinfo|timeout|connection terminated/i.test(message)
  );
}

async function withTransientDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientDbNetworkError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 350));
    return await fn();
  }
}

function suppressionNoteForCandidate(candidate: ArticleCandidate | null | undefined, reason: string): string | null {
  if (!candidate) return null;
  const id = candidate.id?.trim();
  const url = candidate.url?.trim();
  if (!id && !url) return null;
  return `candidate-suppress:id=${id || ""};url=${url || ""};reason=${reason}`;
}

function betterStorylineWaiverNote(reason: string): string {
  return `better-storyline-waived:${reason}`;
}

function preferredCandidateForSuppression(candidates: ArticleCandidate[]): ArticleCandidate | null {
  return candidates.find((candidate) => candidate.recommended) ?? candidates[0] ?? null;
}

function pickPhaseFromPackage(pkg: unknown): string {
  if (isArticlePickPackage(pkg)) return "awaiting_article_pick";
  if (isCorrectionApprovalPackage(pkg)) return "awaiting_correction_approval";
  if (isSummaryApprovalPackage(pkg)) return "awaiting_summary_approval";
  if (isCalendarDecisionPackage(pkg)) return "awaiting_calendar_decision";
  if (isDuplicateDecisionPackage(pkg)) return "awaiting_duplicate_decision";
  return "legacy";
}

function refreshArticlePickCandidatesForResponse(candidates: ArticleCandidate[], targetDate: string): ArticleCandidate[] {
  const refreshed = candidates.map((candidate) => {
    const story = evaluateCandidateStorySanity({
      targetDate,
      title: candidate.title,
      summary: candidate.summary ?? "",
      text: candidate.summary ?? "",
    });
    if (story.ok) return { ...candidate, recommended: false };
    return {
      ...candidate,
      calendarSanityOk: false,
      calendarSanityNotes: [...(candidate.calendarSanityNotes ?? []), ...story.notes].filter(
        (note, index, arr) => arr.indexOf(note) === index,
      ),
      relevanceScore: Math.max(0, Math.round(((candidate.relevanceScore ?? 0) - 0.55) * 1000) / 1000),
      relevanceNotes: [...(candidate.relevanceNotes ?? []), "current story-sanity rule blocks this as a dated event"],
      recommended: false,
    };
  });

  refreshed.sort((a, b) => {
    if (a.calendarSanityOk !== b.calendarSanityOk) return a.calendarSanityOk ? -1 : 1;
    const scoreDiff = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.rank - b.rank;
  });

  // Only re-mark `recommended` on a candidate that passes the *current* story
  // sanity rules. A stale queue item where every candidate now fails sanity
  // shows zero recommendations on purpose — operator must pick + override.
  const recommended = refreshed.find((candidate) => candidate.calendarSanityOk);
  if (recommended) recommended.recommended = true;
  return refreshed;
}

const router = Router();

type Articleish = { id?: string; title?: string; url?: string };

function collectTieredArticles(tiered: unknown): Articleish[] {
  if (!tiered || typeof tiered !== "object") return [];
  const t = tiered as Record<string, unknown>;
  const out: Articleish[] = [];
  for (const key of ["bitcoin", "crypto", "macro"] as const) {
    const arr = t[key];
    if (!Array.isArray(arr)) continue;
    for (const a of arr) {
      if (a && typeof a === "object" && "id" in (a as object)) out.push(a as Articleish);
    }
  }
  return out;
}

function resolveDayTopArticle(row: {
  topArticleId: string | null;
  tieredArticles: unknown;
  analyzedArticles: unknown;
}): { title: string; url: string } | null {
  const id = row.topArticleId?.trim();
  if (!id || id === "none" || id.includes("no-news-")) return null;
  const fromTiered = collectTieredArticles(row.tieredArticles).find((a) => a.id === id);
  if (fromTiered?.url && typeof fromTiered.title === "string") {
    return { title: fromTiered.title, url: fromTiered.url };
  }
  if (Array.isArray(row.analyzedArticles)) {
    const a = (row.analyzedArticles as Articleish[]).find((x) => x.id === id);
    if (a?.url && typeof a.title === "string") return { title: a.title, url: a.url };
  }
  return null;
}

const SOURCE_ARTICLE_CAP = 12;

function collectDaySourceArticles(row: {
  tieredArticles: unknown;
  analyzedArticles: unknown;
}): { title: string; url: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  const push = (a: Articleish) => {
    const url = typeof a.url === "string" ? a.url.trim() : "";
    const title = typeof a.title === "string" ? a.title.trim() : "";
    if (!url || !title) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ title, url });
  };
  for (const a of collectTieredArticles(row.tieredArticles)) {
    push(a);
    if (out.length >= SOURCE_ARTICLE_CAP) return out;
  }
  if (Array.isArray(row.analyzedArticles)) {
    for (const a of row.analyzedArticles as Articleish[]) {
      push(a);
      if (out.length >= SOURCE_ARTICLE_CAP) return out;
    }
  }
  return out;
}

function topicCategoryLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const s = x.trim();
      if (s) out.push(s);
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.label === "string" && o.label.trim()) out.push(o.label.trim());
      else if (typeof o.name === "string" && o.name.trim()) out.push(o.name.trim());
      else if (typeof o.slug === "string" && o.slug.trim()) out.push(o.slug.trim());
    }
  }
  return out;
}

type DayAnalysisPreview = {
  summary: string;
  topArticle: { title: string; url: string } | null;
  tags: string[];
  topicCategories: string[];
  totalArticlesFetched: number | null;
  tierUsed: string | null;
  winningTier: string | null;
  sourceArticles: { title: string; url: string }[];
  redoSummaryAvailable: boolean;
};

function buildDayAnalysisPreview(row: {
  summary: string | null;
  topArticleId: string | null;
  tieredArticles: unknown;
  analyzedArticles: unknown;
  topicCategories: unknown;
  tagsVersion2: string[] | null;
  totalArticlesFetched: number | null;
  tierUsed: string | null;
  winningTier: string | null;
}): DayAnalysisPreview {
  const tiered = row.tieredArticles;
  const analyzed = row.analyzedArticles;
  return {
    summary: row.summary ?? "",
    topArticle: resolveDayTopArticle({
      topArticleId: row.topArticleId,
      tieredArticles: tiered,
      analyzedArticles: analyzed,
    }),
    tags: Array.isArray(row.tagsVersion2)
      ? row.tagsVersion2.filter((t): t is string => typeof t === "string" && t.trim() !== "")
      : [],
    topicCategories: topicCategoryLabels(row.topicCategories),
    totalArticlesFetched: row.totalArticlesFetched ?? null,
    tierUsed: row.tierUsed?.trim() || null,
    winningTier: row.winningTier?.trim() || null,
    sourceArticles: collectDaySourceArticles({ tieredArticles: tiered, analyzedArticles: analyzed }),
    redoSummaryAvailable: isValidPipelineTopArticleId(row.topArticleId),
  };
}

function normalizeEventDate(d: unknown): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d.length >= 10 ? d.slice(0, 10) : null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

router.post("/api/agent/pipeline/run", async (req, res) => {
  try {
    requireAgentSecret(req);
    const { dateFrom, dateTo, maxDaysToConsider } = req.body || {};
    if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
      return res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
    }
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (dateFrom > dateTo) {
      return res.status(400).json({ error: "dateFrom must be <= dateTo" });
    }
    const rawCheckScopes = Array.isArray(req.body?.checkScopes) ? req.body.checkScopes : ALL_PIPELINE_CHECK_SCOPES;
    const checkScopes: PipelineCheckScope[] = Array.from(
      new Set(
        rawCheckScopes.filter((scope: unknown): scope is PipelineCheckScope =>
          pipelineCheckScopeSchema.safeParse(scope).success,
        ),
      ),
    );
    if (checkScopes.length === 0) {
      return res.status(400).json({ error: "Select at least one pipeline check" });
    }

    const out = await startEditorialPipelineRun({
      dateFrom,
      dateTo,
      maxDaysToConsider: Number(maxDaysToConsider) || 60,
      requestedBy: "admin-ui",
      checkScopes,
    });

    res.json({
      ...out,
      status: "running",
      note: "Triage-first pipeline run started (existing search/summarization flows preserved).",
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Pipeline run failed" });
  }
});

router.get("/api/agent/pipeline/runs/:id", async (req, res) => {
  try {
    requireAgentSecret(req);
    const out = await getEditorialPipelineRun(req.params.id);
    if (!out) return res.status(404).json({ error: "Run not found" });
    res.json(out);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to fetch pipeline run" });
  }
});

router.post("/api/agent/pipeline/runs/:id/stop", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const stopped = stopEditorialPipelineRun(id);
    if (!stopped) {
      return res.status(409).json({ error: "Run is not active in this runtime", status: "not-stoppable" });
    }
    res.json({ success: true, status: "stopped" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to stop pipeline run" });
  }
});

router.post("/api/agent/pipeline/runs/:id/pause", async (req, res) => {
  try {
    requireAgentSecret(req);
    const paused = pauseEditorialPipelineRun(req.params.id);
    if (!paused) return res.status(409).json({ error: "Run is not active in this runtime" });
    res.json({ success: true, status: "paused" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to pause run" });
  }
});

router.post("/api/agent/pipeline/runs/:id/resume", async (req, res) => {
  try {
    requireAgentSecret(req);
    const out = await resumeEditorialPipelineRun(req.params.id);
    res.json({ success: true, ...out, status: "running" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to resume run" });
  }
});

/** GET triage + valid `startAgent` values for `POST .../resume-slice` (operator UI). */
router.get("/api/agent/pipeline/resume-options", async (req, res) => {
  try {
    requireAgentSecret(req);
    const date = req.query.date as string;
    if (!date || !isIsoDate(date)) {
      return res.status(400).json({ error: "Query ?date=YYYY-MM-DD is required" });
    }
    const out = await getEditorialResumeOptions(date);
    res.json(out);
  } catch (e: any) {
    const msg = e.message || "Failed to load resume options";
    const code = /No triage/i.test(msg) ? 400 : e.status || 500;
    res.status(code).json({ error: msg });
  }
});

/**
 * Start a **new** single-day run that executes only the triage chain suffix from `startAgent`
 * (e.g. after fixing taxonomy, call `startAgent: "TagConsistencyAgent"`).
 */
router.post("/api/agent/pipeline/resume-slice", async (req, res) => {
  try {
    requireAgentSecret(req);
    const { date, startAgent } = req.body || {};
    if (!date || typeof date !== "string" || !isIsoDate(date)) {
      return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    }
    if (!startAgent || typeof startAgent !== "string") {
      return res.status(400).json({ error: "startAgent is required (pipeline agent name)" });
    }
    const parsed = pipelineAgentSchema.safeParse(startAgent);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid startAgent", details: parsed.error.flatten() });
    }
    const out = await startEditorialPipelineResumeSlice({
      date,
      startAgent: parsed.data,
      requestedBy: (req.body?.requestedBy as string) || "admin-ui",
    });
    res.json({ success: true, ...out, status: "running" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "resume-slice failed" });
  }
});

router.post("/api/agent/pipeline/shadow-validate", async (req, res) => {
  try {
    requireAgentSecret(req);
    const { dateFrom, dateTo, maxDaysToConsider } = req.body || {};
    if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
      return res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
    }
    const out = await shadowValidatePipelineWindow({
      dateFrom,
      dateTo,
      maxDaysToConsider: Number(maxDaysToConsider) || 60,
    });
    res.json(out);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Shadow validation failed" });
  }
});

router.get("/api/agent/pipeline/milestones/gaps", async (req, res) => {
  try {
    requireAgentSecret(req);
    const dateFrom = (req.query.dateFrom as string) || "2009-01-01";
    const dateTo = (req.query.dateTo as string) || new Date().toISOString().slice(0, 10);
    const gaps = await detectMilestoneGapsInWindow(dateFrom, dateTo);
    res.json({ gaps, count: gaps.length });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to detect milestone gaps" });
  }
});

router.get("/api/agent/pipeline/cutover-status", async (req, res) => {
  try {
    requireAgentSecret(req);
    res.json(getEditorialCutoverStatus());
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to get cutover status" });
  }
});

router.get("/api/agent/pipeline/runs/:id/evidence", async (req, res) => {
  try {
    requireAgentSecret(req);
    const run = await getEditorialPipelineRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const steps = (run.steps as any[]).map((s) => ({
      stepId: s.id,
      agentName: s.agentName,
      evidence: s.evidence ?? null,
      output: s.output ?? null,
    }));
    res.json({ runId: req.params.id, steps });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to load evidence" });
  }
});

router.get("/api/agent/pipeline/review", async (req, res) => {
  try {
    requireAgentSecret(req);
    const status = (req.query.status as string) || "pending";
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const items = await withTransientDbRetry(async () => {
    const rows = await db
      .select()
      .from(humanReviewQueue)
      .where(eq(humanReviewQueue.status, status))
      .orderBy(desc(humanReviewQueue.priority), asc(humanReviewQueue.createdAt))
      .limit(limit);

    const dates = [
      ...new Set(rows.map((r) => normalizeEventDate(r.eventDate)).filter((x): x is string => Boolean(x))),
    ];

    const analysisByDate = new Map<string, DayAnalysisPreview>();
    if (dates.length) {
      const analyses = await db
        .select({
          date: historicalNewsAnalyses.date,
          summary: historicalNewsAnalyses.summary,
          topArticleId: historicalNewsAnalyses.topArticleId,
          tieredArticles: historicalNewsAnalyses.tieredArticles,
          analyzedArticles: historicalNewsAnalyses.analyzedArticles,
          topicCategories: historicalNewsAnalyses.topicCategories,
          tagsVersion2: historicalNewsAnalyses.tagsVersion2,
          totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
          tierUsed: historicalNewsAnalyses.tierUsed,
          winningTier: historicalNewsAnalyses.winningTier,
        })
        .from(historicalNewsAnalyses)
        .where(inArray(historicalNewsAnalyses.date, dates));

      for (const a of analyses) {
        const ymd = normalizeEventDate(a.date);
        if (!ymd) continue;
        analysisByDate.set(ymd, buildDayAnalysisPreview(a));
      }
    }

    const mappedItems = rows.map((r) => {
      const ymd = normalizeEventDate(r.eventDate);
      const extra = ymd ? analysisByDate.get(ymd) : undefined;
      const pkg = r.package;
      const phase = pickPhaseFromPackage(pkg);
      const articlePick = isArticlePickPackage(pkg) ? pkg : null;
      const refreshedCandidates =
        articlePick && ymd ? refreshArticlePickCandidatesForResponse(articlePick.candidates, ymd) : null;
      const correctionPkg = isCorrectionApprovalPackage(pkg) ? pkg : null;
      const summaryPkg = isSummaryApprovalPackage(pkg) ? pkg : null;
      const calendarPkg = isCalendarDecisionPackage(pkg) ? pkg : null;
      const duplicatePkg = isDuplicateDecisionPackage(pkg) ? pkg : null;
      const triage = (pkg as { triage?: { route?: TriageRoute; reasons?: unknown } } | null)?.triage;
      const route = (triage?.route as TriageRoute | undefined) ?? "existing_needs_correction";
      const reasons = Array.isArray(triage?.reasons) ? (triage!.reasons as string[]).filter((x) => typeof x === "string") : [];
      const actionPlan = computeOperatorActionPlan({
        route,
        reasons,
        daySnapshot: extra
          ? {
              hasSummary: !!extra.summary?.trim(),
              hasTopArticle: !!extra.topArticle,
              tagCount: extra.tags.length,
            }
          : undefined,
      });
      return {
        ...r,
        daySummary: extra?.summary ?? null,
        dayTopArticle: extra?.topArticle ?? null,
        dayTags: extra?.tags ?? null,
        dayTopicCategories: extra?.topicCategories ?? null,
        dayTotalArticlesFetched: extra?.totalArticlesFetched ?? null,
        dayTierUsed: extra?.tierUsed ?? null,
        dayWinningTier: extra?.winningTier ?? null,
        daySourceArticles: extra?.sourceArticles ?? null,
        dayRedoSummaryAvailable: extra?.redoSummaryAvailable ?? null,
        // Discriminator for the UI: which phase this review item is in.
        reviewPhase: phase,
        scenario: articlePick ? articlePick.scenario : null,
        candidates: refreshedCandidates,
        hasCandidates: articlePick ? articlePick.hasCandidates : null,
        // Correction proposals (each carries current + proposed values).
        proposals: correctionPkg ? correctionPkg.proposals : null,
        // Summary approval second-gate payload.
        summaryApproval: summaryPkg
          ? {
              winningArticle: summaryPkg.winningArticle,
              generatedSummary: summaryPkg.generatedSummary,
              proposedTags: summaryPkg.proposedTags,
              proposedTopics: summaryPkg.proposedTopics,
            }
          : null,
        // Calendar mismatch decision.
        calendarDecision: calendarPkg
          ? {
              currentDate: calendarPkg.currentDate,
              expectedDate: calendarPkg.expectedDate,
              ruleId: calendarPkg.ruleId,
              reason: calendarPkg.reason,
              canonicalDateOccupied: calendarPkg.canonicalDateOccupied,
            }
          : null,
        // Duplicate decision.
        duplicateDecision: duplicatePkg
          ? {
              focal: duplicatePkg.focal,
              neighbors: duplicatePkg.neighbors,
            }
          : null,
        /** Derived operator-facing plan: what Approve will do, what still needs hand-fixing. */
        actionPlan,
      };
    });

    return mappedItems;
    });

    res.json({ items });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to load review queue" });
  }
});

router.post("/api/agent/pipeline/review/:id/approve", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin-ui";
    const notes = (req.body?.notes as string) || null;

    const selectedArticleId =
      typeof req.body?.selectedArticleId === "string" && req.body.selectedArticleId.trim()
        ? (req.body.selectedArticleId as string).trim()
        : undefined;
    const keepCurrentSummary = req.body?.keepCurrentSummary === true;
    const acceptedProposalIds = Array.isArray(req.body?.acceptedProposalIds)
      ? (req.body.acceptedProposalIds as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const proposalTagSelections =
      req.body?.proposalTagSelections && typeof req.body.proposalTagSelections === "object"
        ? Object.fromEntries(
            Object.entries(req.body.proposalTagSelections as Record<string, unknown>).map(([proposalId, value]) => [
              proposalId,
              Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [],
            ]),
          )
        : undefined;
    const proposalTopicSelections =
      req.body?.proposalTopicSelections && typeof req.body.proposalTopicSelections === "object"
        ? Object.fromEntries(
            Object.entries(req.body.proposalTopicSelections as Record<string, unknown>).map(([proposalId, value]) => [
              proposalId,
              Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [],
            ]),
          )
        : undefined;
    const calendarDecision =
      typeof req.body?.calendarDecision === "string" &&
      (CALENDAR_DECISIONS as string[]).includes(req.body.calendarDecision)
        ? (req.body.calendarDecision as CalendarDecisionInput)
        : undefined;
    const duplicateDecision =
      typeof req.body?.duplicateDecision === "string" &&
      (DUPLICATE_DECISIONS as string[]).includes(req.body.duplicateDecision)
        ? (req.body.duplicateDecision as DuplicateDecisionInput)
        : undefined;
    const duplicateNeighborDate =
      typeof req.body?.duplicateNeighborDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.duplicateNeighborDate)
        ? (req.body.duplicateNeighborDate as string)
        : undefined;
    const editedSummary =
      typeof req.body?.editedSummary === "string" ? (req.body.editedSummary as string) : undefined;
    const editedTags = Array.isArray(req.body?.editedTags)
      ? (req.body.editedTags as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const editedTopics = Array.isArray(req.body?.editedTopics)
      ? (req.body.editedTopics as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;

    // Pre-flight: phase-specific required args.
    const [existing] = await db
      .select()
      .from(humanReviewQueue)
      .where(and(eq(humanReviewQueue.id, id), eq(humanReviewQueue.status, "pending")))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Pending review item not found" });

    const keepCurrentBetterStoryline =
      isArticlePickPackage(existing.package) &&
      existing.package.scenario === "better_storyline" &&
      keepCurrentSummary;

    const suppressionNote =
      keepCurrentBetterStoryline && isArticlePickPackage(existing.package)
        ? suppressionNoteForCandidate(
            preferredCandidateForSuppression(existing.package.candidates),
            "keep-current-summary",
          )
        : null;
    const betterStorylineWaiver =
      keepCurrentBetterStoryline ? betterStorylineWaiverNote("keep-current-summary") : null;

    if (isArticlePickPackage(existing.package) && !selectedArticleId && !keepCurrentBetterStoryline) {
      return res.status(400).json({
        error: "selectedArticleId is required when approving an article-pick review item",
        scenario: existing.package.scenario,
        candidateCount: existing.package.candidates.length,
      });
    }
    const forceLowQualityPick = req.body?.forceLowQualityPick === true;
    const overrideReason =
      typeof req.body?.overrideReason === "string" && req.body.overrideReason.trim().length > 0
        ? (req.body.overrideReason as string).trim()
        : null;

    if (isArticlePickPackage(existing.package) && selectedArticleId) {
      const date = normalizeEventDate(existing.eventDate) ?? existing.package.triage.date;
      const selected = existing.package.candidates.find((candidate) => candidate.id === selectedArticleId);
      const story = selected
        ? evaluateCandidateStorySanity({
            targetDate: date,
            title: selected.title,
            summary: selected.summary ?? "",
            text: selected.summary ?? "",
          })
        : null;
      const offsetDays =
        typeof selected?.publishedDateOffsetDays === "number" ? selected.publishedDateOffsetDays : null;
      const offsetTooFar = offsetDays !== null && Math.abs(offsetDays) > 7;
      const blockingNotes: string[] = [];
      if (story && !story.ok) blockingNotes.push(...story.notes);
      if (offsetTooFar) {
        blockingNotes.push(
          `Article published ${Math.abs(offsetDays as number)} day(s) ${
            (offsetDays as number) > 0 ? "after" : "before"
          } target date`,
        );
      }
      // Stored sanity from when the package was generated — surface it too so
      // stale queue items can't quietly approve a candidate that already failed.
      if (selected && selected.calendarSanityOk === false) {
        const storedNotes = (selected.calendarSanityNotes ?? []).filter(
          (note) => !blockingNotes.includes(note),
        );
        blockingNotes.push(...storedNotes);
      }
      if (blockingNotes.length > 0 && !forceLowQualityPick) {
        return res.status(400).json({
          error:
            "Selected article is blocked by current story/date sanity rules. Pass { forceLowQualityPick: true, overrideReason } to approve anyway.",
          notes: blockingNotes,
          requiresOverride: true,
        });
      }
      if (blockingNotes.length > 0 && forceLowQualityPick) {
        // Append the override decision into reviewer notes so the audit trail
        // shows this approval bypassed sanity on purpose.
        const override = `forceLowQualityPick=true${overrideReason ? `: ${overrideReason}` : ""}; bypassed: ${blockingNotes.join(" | ")}`;
        // notes is captured below into reviewNotes; merge here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any)._sanityOverrideNote = override;
      }
    }
    if (isCalendarDecisionPackage(existing.package) && !calendarDecision) {
      return res.status(400).json({
        error: "calendarDecision is required (move_to_canonical | keep_as_is | delete)",
      });
    }
    if (isDuplicateDecisionPackage(existing.package) && !duplicateDecision) {
      return res.status(400).json({
        error: "duplicateDecision is required (keep_both | delete_focal | delete_neighbor | differentiate | find_another_event)",
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sanityOverrideNote: string | undefined = (req as any)._sanityOverrideNote;
    const mergedNotes = [notes, sanityOverrideNote, suppressionNote, betterStorylineWaiver]
      .filter((x): x is string => Boolean(x))
      .join(" | ") || null;

    const updated = await db
      .update(humanReviewQueue)
      .set({
        status: "approved",
        reviewer,
        reviewNotes: mergedNotes,
        reviewedAt: new Date(),
      })
      .where(and(eq(humanReviewQueue.id, id), eq(humanReviewQueue.status, "pending")))
      .returning({ id: humanReviewQueue.id, runId: humanReviewQueue.runId });
    if (!updated.length) return res.status(404).json({ error: "Pending review item not found" });
    if (keepCurrentBetterStoryline && isArticlePickPackage(existing.package)) {
      const date = normalizeEventDate(existing.eventDate) ?? existing.package.triage.date;
      const continuation = await continueExistingDayChecksAfterKeepingStoryline({
        runId: updated[0].runId,
        stepId: existing.stepId,
        date,
        triage: existing.package.triage,
        reviewer,
      });
      return res.json({
        success: true,
        itemId: updated[0].id,
        runId: updated[0].runId,
        execution: continuation,
      });
    }
    const execution = await executeApprovedReviewItem(updated[0].id, {
      selectedArticleId,
      acceptedProposalIds,
      proposalTagSelections,
      proposalTopicSelections,
      calendarDecision,
      duplicateDecision,
      duplicateNeighborDate,
      editedSummary,
      editedTags,
      editedTopics,
      reviewer,
    });
    res.json({ success: true, itemId: updated[0].id, runId: updated[0].runId, execution });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Approve review failed" });
  }
});

router.post("/api/agent/pipeline/review/:id/reject", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin-ui";
    const notes = (req.body?.notes as string) || null;
    const andRerunDate = req.body?.andRerunDate === true;
    const [existing] = await db
      .select({ eventDate: humanReviewQueue.eventDate, package: humanReviewQueue.package })
      .from(humanReviewQueue)
      .where(and(eq(humanReviewQueue.id, id), eq(humanReviewQueue.status, "pending")))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Pending review item not found" });
    const suppressionNote =
      isArticlePickPackage(existing.package) && existing.package.scenario === "better_storyline"
        ? suppressionNoteForCandidate(
            preferredCandidateForSuppression(existing.package.candidates),
            "rejected-better-storyline",
          )
        : null;
    const mergedNotes = [notes, suppressionNote].filter((x): x is string => Boolean(x)).join(" | ") || null;
    const updated = await db
      .update(humanReviewQueue)
      .set({
        status: "rejected",
        reviewer,
        reviewNotes: mergedNotes,
        reviewedAt: new Date(),
      })
      .where(and(eq(humanReviewQueue.id, id), eq(humanReviewQueue.status, "pending")))
      .returning({ id: humanReviewQueue.id, runId: humanReviewQueue.runId });
    if (!updated.length) return res.status(404).json({ error: "Pending review item not found" });
    let rerun: { ok: boolean; runId?: string; message: string } | null = null;
    const dateForRerun = normalizeEventDate(existing.eventDate);
    if (andRerunDate && dateForRerun) {
      rerun = await rerunPipelineForDate({ date: dateForRerun, reviewer });
    }
    res.json({
      success: true,
      itemId: updated[0].id,
      runId: updated[0].runId,
      rerun: rerun ?? undefined,
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Reject review failed" });
  }
});

/** Permanently remove a queue row (any status). Audit trail in pipeline_steps is unchanged. */
router.delete("/api/agent/pipeline/review/:id", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const removed = await db
      .delete(humanReviewQueue)
      .where(eq(humanReviewQueue.id, id))
      .returning({ id: humanReviewQueue.id });
    if (!removed.length) return res.status(404).json({ error: "Review item not found" });
    res.json({ success: true, id: removed[0].id });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Delete review item failed" });
  }
});

/** Clear all pipeline artifacts (runs, steps, handoffs, evidence, review queue) via FK cascade. */
router.post("/api/agent/pipeline/clear-artifacts", async (req, res) => {
  try {
    requireAgentSecret(req);
    await db.delete(pipelineRuns);
    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to clear pipeline artifacts" });
  }
});

/**
 * Operator-triggered "rerun this date". Starts a new single-day v3 pipeline
 * run for the date attached to a review item. Used when:
 *  - calendar-delete left the day empty (auto-fired by the writer)
 *  - operator wants to retry an article-pick that had no good options
 *  - the day got mangled and they want a clean slate
 */
router.post("/api/agent/pipeline/review/:id/rerun-date", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin-ui";
    const [existing] = await db
      .select({ eventDate: humanReviewQueue.eventDate })
      .from(humanReviewQueue)
      .where(eq(humanReviewQueue.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Review item not found" });
    const date = normalizeEventDate(existing.eventDate);
    if (!date) {
      return res.status(400).json({ error: "Review item has no event date attached; cannot rerun." });
    }
    const out = await rerunPipelineForDate({ date, reviewer });
    if (!out.ok) return res.status(500).json({ error: out.message });
    res.json({ success: true, date, runId: out.runId, message: out.message });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Rerun date failed" });
  }
});

export default router;

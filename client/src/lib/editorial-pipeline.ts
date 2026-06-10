/** Client helpers for `/api/agent/pipeline/*` (Agents V2 + admin). */

const jsonHeaders: HeadersInit = { "Content-Type": "application/json" };

export type EditorialReviewPhase =
  | "legacy"
  | "awaiting_article_pick"
  | "awaiting_summary_approval"
  | "awaiting_correction_approval"
  | "awaiting_calendar_decision"
  | "awaiting_duplicate_decision";

export type ArticleCandidate = {
  id: string;
  title: string;
  url: string;
  publishedDate?: string | null;
  tier: "bitcoin" | "crypto" | "macro";
  source?: string;
  summary?: string;
  rank: number;
  publishedDateOffsetDays: number | null;
  calendarSanityOk: boolean;
  calendarSanityNotes: string[];
  relevanceScore?: number;
  recommended?: boolean;
  relevanceNotes?: string[];
};

export type CorrectionProposal =
  | { id: string; kind: "promote_v1_to_v2_tags"; current: string[]; proposed: string[]; rationale: string }
  | {
      id: string;
      kind: "set_topic_categories";
      current: string[];
      proposed: string[];
      rationale: string;
      topicAgentSource?: "llm" | "rules" | "skipped";
      topicAgentConfidence?: "high" | "medium" | "low";
    }
  | { id: string; kind: "redo_summary"; currentSummary: string; rationale: string }
  | {
      id: string;
      kind: "edit_summary";
      currentSummary: string;
      targetMin: number;
      targetMax: number;
      rationale: string;
    }
  | { id: string; kind: "clear_orphan_flag"; rationale: string }
  | { id: string; kind: "clear_manual_flag"; rationale: string }
  | { id: string; kind: "fix_tag_conflict"; conflictingTags: string[]; proposedDrop: string[]; rationale: string }
  | { id: string; kind: "drop_ungrounded_tags"; proposedDrop: string[]; suggestedFocusTags?: string[]; rationale: string }
  | { id: string; kind: "add_grounded_tags"; proposedAdd: string[]; suppressed?: string[]; rationale: string }
  | { id: string; kind: "merge_redundant_tags"; merges: Array<{ from: string; to: string }>; rationale: string };

export type OperatorActionPlan = {
  route: "existing_ok" | "existing_needs_correction" | "missing_day" | "empty_day";
  headline: string;
  reasonEntries: Array<{ code: string; message: string }>;
  autoFixes: Array<{ code: string; label: string }>;
  manualFixes: Array<{ code: string; label: string; suggestion: string }>;
  approveSummary: string;
  approveEnabled: boolean;
};

export type EditorialReviewItem = {
  id: string;
  runId: string;
  stepId: string | null;
  status: "pending" | "approved" | "rejected" | string;
  priority: number;
  eventDate: string | null;
  reviewer: string | null;
  reviewNotes: string | null;
  package: unknown;
  createdAt: string | null;
  reviewedAt: string | null;
  daySummary?: string | null;
  dayTopArticle?: { title: string; url: string } | null;
  dayTags?: string[] | null;
  dayTopicCategories?: string[] | null;
  dayTotalArticlesFetched?: number | null;
  dayRedoSummaryAvailable?: boolean | null;
  reviewPhase?: EditorialReviewPhase | string | null;
  scenario?: "empty_day" | "missing_day" | "better_storyline" | null;
  candidates?: ArticleCandidate[] | null;
  hasCandidates?: boolean | null;
  proposals?: CorrectionProposal[] | null;
  summaryApproval?: {
    winningArticle: { id: string; title: string; url: string; tier: "bitcoin" | "crypto" | "macro" };
    generatedSummary: string;
    proposedTags: string[];
    proposedTopics: string[];
  } | null;
  calendarDecision?: {
    currentDate: string;
    expectedDate: string;
    ruleId: string;
    reason: string;
    canonicalDateOccupied: boolean;
    expectedDateSummary?: string | null;
    expectedDateTags?: string[] | null;
    expectedDateTopics?: string[] | null;
    chronologyHint?: {
      likelyEventDate: string;
      duplicateDate: string;
      confidence: "high" | "medium" | "low";
      rationale: string;
      reciprocalConflict: boolean;
      keepDate: string;
      removeDate: string;
    } | null;
  } | null;
  calendarReciprocalPair?: {
    pairKey: string;
    sideA: {
      queueItemId?: string;
      date: string;
      summary: string;
      tags: string[];
      topics: string[];
      pointsAtDate: string;
    };
    sideB: {
      queueItemId?: string;
      date: string;
      summary: string;
      tags: string[];
      topics: string[];
      pointsAtDate: string;
    };
    chronology: {
      likelyEventDate: string;
      duplicateDate: string;
      confidence: "high" | "medium" | "low";
      rationale: string;
      reciprocalConflict: boolean;
      keepDate: string;
      removeDate: string;
    };
  } | null;
  duplicateDecision?: {
    focal: { date: string; summaryPreview: string; tags: string[]; topics: string[] };
    neighbors: Array<{
      date: string;
      summaryPreview: string;
      sharedTags: string[];
      sharedTopics: string[];
      tokenJaccard: number;
    }>;
  } | null;
  removedDayContext?: {
    reason: string;
    removedAt: string;
    source?: "calendar_group_remove" | "calendar_keep_rerun" | "calendar_delete";
    previousSummary?: string;
    previousArticle?: {
      id: string;
      title: string;
      url: string;
      tier?: "bitcoin" | "crypto" | "macro";
    };
  } | null;
  actionPlan?: OperatorActionPlan | null;
  knownEventContext?: {
    isKnownEvent: boolean;
    kind: string | null;
    label: string | null;
    description?: string | null;
    explanation: string | null;
    referenceText?: string | null;
  } | null;
  correctionSummarySource?: {
    current: {
      id: string;
      title: string;
      url: string;
      preview: string;
      tier: "bitcoin" | "crypto" | "macro";
    } | null;
    alternateCandidates: ArticleCandidate[];
    hasRedoSummary: boolean;
    hasEditSummary: boolean;
  } | null;
};

export type ApproveReviewOpts = {
  selectedArticleId?: string;
  /** Correction queue: swap winning article and re-run summary + tags + topics (summary approval gate). */
  replaceArticleId?: string;
  keepCurrentSummary?: boolean;
  acceptedProposalIds?: string[];
  proposalTagSelections?: Record<string, string[]>;
  proposalTopicSelections?: Record<string, string[]>;
  calendarDecision?: "move_to_canonical" | "keep_as_is" | "delete";
  calendarPairResolution?: "accept_chronology" | "keep_both";
  calendarKeepDate?: string;
  calendarRerunDate?: string;
  calendarGroupDates?: string[];
  calendarRemoveDates?: string[];
  duplicateDecision?: "keep_both" | "delete_focal" | "delete_neighbor" | "differentiate" | "find_another_event";
  duplicateNeighborDate?: string;
  editedSummary?: string;
  editedTags?: string[];
  editedTopics?: string[];
};

export type PipelineAgentName =
  | "NewsManager"
  | "MilestoneAgent"
  | "SourceFinderAgent"
  | "RelevanceCheckerAgent"
  | "VerificationAgent"
  | "TopicValidatorAgent"
  | "TopicManagerAgent"
  | "TagManagerAgent"
  | "TopicApplierAgent"
  | "TagApplierAgent"
  | "DuplicateCheckerAgent"
  | "SummaryAgent"
  | "DateConsistencyAgent"
  | "TagConsistencyAgent"
  | "FinalEditorAgent";

export type PipelineCheckScope = "relevance" | "summary" | "topics" | "tags" | "duplicates" | "date";

export type PipelineRunDetail = {
  run: {
    id: string;
    status: string;
    dateFrom: string;
    dateTo: string;
    model: string;
    startedAt: string | null;
    completedAt: string | null;
    stats?: Record<string, unknown>;
  };
  steps: Array<{
    id: string;
    stepIndex: number;
    agentName: string;
    status: string;
    rejectionReason?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    input?: unknown;
  }>;
  humanReviewItems?: Array<{
    id: string;
    stepId: string | null;
    eventDate?: string | null;
    status: string;
    createdAt?: string | null;
  }>;
  handoffs: unknown[];
  live?: { activeInThisRuntime: boolean };
};

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: string };
    return j.error ?? text ?? res.statusText;
  } catch {
    return text || res.statusText;
  }
}

export type ReviewQueuePage = {
  items: EditorialReviewItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export async function fetchReviewQueue(
  status: "pending" | "approved" | "rejected" | "all",
  opts?: { limit?: number; offset?: number; phase?: string },
): Promise<ReviewQueuePage> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const params = new URLSearchParams({
    status,
    limit: String(limit),
    offset: String(offset),
  });
  if (opts?.phase && opts.phase !== "all") {
    params.set("phase", opts.phase);
  }
  const res = await fetch(`/api/agent/pipeline/review?${params.toString()}`, {
    headers: jsonHeaders,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as Partial<ReviewQueuePage>;
  return {
    items: data.items ?? [],
    total: data.total ?? data.items?.length ?? 0,
    limit: data.limit ?? limit,
    offset: data.offset ?? offset,
    hasMore: data.hasMore ?? false,
  };
}

export async function startPipelineRun(body: {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
  checkScopes?: PipelineCheckScope[];
  /** When set, only these calendar days are processed inside the window. */
  targetDates?: string[];
}) {
  const res = await fetch("/api/agent/pipeline/run", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { runId: string; status?: string };
}

export async function fetchPipelineRun(runId: string) {
  const res = await fetch(`/api/agent/pipeline/runs/${runId}`, {
    headers: jsonHeaders,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as PipelineRunDetail;
}

export async function stopPipelineRun(runId: string) {
  const res = await fetch(`/api/agent/pipeline/runs/${runId}/stop`, {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function approveReviewItem(id: string, opts?: ApproveReviewOpts) {
  const body: Record<string, unknown> = { reviewer: "agents-v2-ui", ...opts };
  const res = await fetch(`/api/agent/pipeline/review/${id}/approve`, {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function rejectReviewItem(id: string, notes?: string) {
  const res = await fetch(`/api/agent/pipeline/review/${id}/reject`, {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify({ reviewer: "agents-v2-ui", notes: notes ?? null }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function deleteReviewQueueItem(id: string) {
  const res = await fetch(`/api/agent/pipeline/review/${id}`, {
    method: "DELETE",
    headers: jsonHeaders,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ success?: boolean; id?: string }>;
}

export async function rerunReviewDate(id: string) {
  const res = await fetch(`/api/agent/pipeline/review/${id}/rerun-date`, {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify({ reviewer: "agents-v2-ui" }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function clearPipelineArtifacts() {
  const res = await fetch("/api/agent/pipeline/clear-artifacts", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify({ reviewer: "agents-v2-ui" }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ success?: boolean }>;
}

export async function fetchResumeOptions(date: string) {
  const res = await fetch(`/api/agent/pipeline/resume-options?date=${encodeURIComponent(date)}`, {
    headers: jsonHeaders,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{
    triage: { route: string; reasons: string[] };
    resumeStartsAvailable: PipelineAgentName[];
  }>;
}

export async function resumePipelineSlice(body: { date: string; startAgent: PipelineAgentName }) {
  const res = await fetch("/api/agent/pipeline/resume-slice", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify({ ...body, requestedBy: "agents-v2-ui" }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { runId: string; success?: boolean };
}

export async function shadowValidatePipeline(body: {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
}) {
  const res = await fetch("/api/agent/pipeline/shadow-validate", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<Record<string, unknown>>;
}

export const AGENTS_V2_LAST_RUN_KEY = "agents-v2-last-run-id";

export function rememberLastPipelineRunId(runId: string) {
  try {
    sessionStorage.setItem(AGENTS_V2_LAST_RUN_KEY, runId);
  } catch {
    /* ignore */
  }
}

export function readLastPipelineRunId(): string | null {
  try {
    return sessionStorage.getItem(AGENTS_V2_LAST_RUN_KEY);
  } catch {
    return null;
  }
}

export type CorpusOverviewMetrics = {
  totalDays: number;
  emptySummaryDays: number;
  summaryTooShort: number;
  summaryTooLong: number;
  summaryInTarget: number;
  orphanDays: number;
  flaggedDays: number;
  reviewQueue: {
    pending: number;
    approved: number;
    rejected: number;
    pendingByPhase: Record<string, number>;
  };
  yearCounts: Array<{ year: number; count: number }>;
  computedAt: string;
};

export type CorpusMetricsSampleReport = {
  sampled: number;
  usefulTopicSuggestionPct: number;
  legacyTopicPct: number;
  modelReasonPct: number;
  autoPassPct: number;
  phaseCounts: Record<string, number>;
  samples: Array<{
    date: string;
    phase: string;
    hasTopicSuggestion: boolean;
    hasModelTopicReason: boolean;
    legacyTopic: boolean;
    wouldAutoApply: number;
    wouldQueue: number;
  }>;
  dateFrom?: string;
  dateTo?: string;
  seed?: string;
};

export type VerificationCheckStatus = "pass" | "warn" | "fail";

export type DayVerificationResult = {
  date: string;
  mode: "quick" | "full";
  passed: boolean;
  checks: Array<{
    id: string;
    label: string;
    status: VerificationCheckStatus;
    message: string;
  }>;
  summaryPreview: string | null;
  topics: string[];
  tags: string[];
  corpusPhase?: string;
  wouldQueue?: string[];
};

export async function fetchCorpusOverviewMetrics() {
  const res = await fetch("/api/agent/pipeline/metrics/overview", {
    headers: jsonHeaders,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as CorpusOverviewMetrics;
}

export async function fetchCorpusMetricsSample(body: {
  dateFrom: string;
  dateTo: string;
  count: number;
  seed?: string;
}) {
  const res = await fetch("/api/agent/pipeline/metrics/sample", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as CorpusMetricsSampleReport;
}

export async function verifyEditorialDay(date: string, mode: "quick" | "full" = "quick") {
  const res = await fetch("/api/agent/pipeline/verify-day", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify({ date, mode }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as DayVerificationResult;
}

export async function checkCalendarDatesWithGoogle(
  entries: Array<{ date: string; summary: string }>,
): Promise<{ removeDates: string[] }> {
  const res = await fetch("/api/agent/pipeline/calendar-check-google", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { removeDates: string[] };
}

export async function checkArticlePickWithGoogle(body: {
  date: string;
  scenario?: "empty_day" | "missing_day" | "better_storyline";
  currentSummary?: string;
  candidates: Array<{
    id: string;
    title: string;
    publishedDate?: string | null;
    tier: string;
    summary?: string;
  }>;
}): Promise<{ pickId: string | null }> {
  const res = await fetch("/api/agent/pipeline/article-pick-check-google", {
    method: "POST",
    headers: jsonHeaders,
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { pickId: string | null };
}

export type LeafCoverageMatched = {
  date: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  sourceUrl?: string;
  summary: string;
  wasLocked: boolean;
  newlyLocked: boolean;
};

export type LeafCoverageMissing = {
  date: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  sourceUrl?: string;
};

export type LeafCoverageMisplaced = {
  date: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  sourceUrl?: string;
  currentLeaf: string;
  currentLeafLabel: string;
  summary: string;
  isLocked: boolean;
};

export type MainEventsGeminiCacheMeta = {
  cached: boolean;
  fetchedAt: string | null;
  geminiModel: string | null;
  canonicalCount: number;
  cacheVersion: string | null;
};

export type LeafCoverageResult = {
  leaf: string;
  leafLabel: string;
  group: string | null;
  notes?: string;
  corpusCount: number;
  canonicalCount: number;
  geminiSource: "cache" | "gemini";
  geminiFetchedAt: string | null;
  geminiModel: string | null;
  matched: LeafCoverageMatched[];
  missing: LeafCoverageMissing[];
  misplaced: LeafCoverageMisplaced[];
  extra: Array<{
    date: string;
    summary: string;
    isLocked: boolean;
  }>;
  skippedCanonical: Array<{
    date: string;
    event: string;
    importance: "landmark" | "major" | "notable";
  }>;
  newlyLockedCount: number;
  dismissed: {
    misplaced: LeafCoverageMisplaced[];
    missing: LeafCoverageMissing[];
    extra: Array<{
      date: string;
      summary: string;
      isLocked: boolean;
    }>;
  };
};

export type LeafCorpusStats = {
  leaf: string;
  leafLabel: string;
  corpusCount: number;
  lockedCount: number;
  geminiCache: MainEventsGeminiCacheMeta;
};

export type MainEventsCheckSnapshot = {
  stats: LeafCorpusStats;
  preview: LeafCoverageResult | null;
};

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // ignore
  }
  return res.statusText || "Request failed";
}

export type MainEventsGeminiCacheResult = {
  leaf: string;
  skipped: boolean;
  canonicalCount: number;
  fetchedAt: string | null;
  geminiModel: string | null;
};

export type MainEventsCacheOverview = {
  totalLeaves: number;
  cachedCount: number;
  uncachedLeaves: string[];
  preparedLeaves: string[];
};

export type VerificationLockAction = "locked" | "unlocked" | "pending";

export type VerificationLockOutcome = {
  date: string;
  action: VerificationLockAction;
  reason: string;
};

export type MainEventsLeafStatus = {
  leaf: string;
  group: string | null;
  status: "matched" | "pending";
  pendingReason: "not_prepared" | "needs_review" | null;
  geminiCached: boolean;
  canonicalCount: number;
  matchedCount: number;
  misplacedCount: number;
  missingCount: number;
  extraCount: number;
  verificationPendingCount: number;
  corpusCount: number;
  fetchedAt: string | null;
};

export type MainEventsLeavesStatusOverview = {
  totalLeaves: number;
  matchedCount: number;
  pendingCount: number;
  matchedLeaves: MainEventsLeafStatus[];
  pendingLeaves: MainEventsLeafStatus[];
};

export type MainEventsAlignmentMismatch = {
  date: string;
  kind: "matched" | "misplaced";
  geminiLeaf: string;
  geminiLeafLabel: string;
  geminiEvent: string;
  dbLeaf: string;
  dbLeafLabel: string;
  recommendedLeaf: string | null;
  recommendedLeafLabel: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  summaryPreview: string;
};

export type MainEventsAlignmentReport = {
  scanned: number;
  aligned: number;
  mismatches: MainEventsAlignmentMismatch[];
  pending: number;
  skippedLeaves: string[];
  locked: number;
  unlocked: number;
  lockActions: VerificationLockOutcome[];
  verificationMatched: number;
  verificationPending: number;
};

export type MainEventsReviewDecision = "accepted" | "rejected" | "pending";

export type MainEventsReviewDbStatus = "in_db" | "missing" | "wrong_leaf" | "untagged";

export type MainEventsReviewItem = {
  date: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  sourceUrl?: string;
  dbStatus: MainEventsReviewDbStatus;
  dbSummary?: string;
  wrongLeafLabel?: string;
  isLocked?: boolean;
  reviewStatus: "pending" | "accepted" | "rejected";
};

export type MainEventsReviewQueue = {
  leaf: string;
  leafLabel: string;
  items: MainEventsReviewItem[];
  counts: {
    pending: number;
    accepted: number;
    rejected: number;
    total: number;
  };
};

export async function fetchMainEventsReviewQueue(leaf: string): Promise<MainEventsReviewQueue> {
  const res = await fetch(`/api/main-events-check/review/${encodeURIComponent(leaf)}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function setMainEventsReviewDecision(opts: {
  leaf: string;
  date: string;
  decision: MainEventsReviewDecision;
}): Promise<MainEventsReviewQueue> {
  const res = await fetch("/api/main-events-check/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMainEventsCacheOverview(): Promise<MainEventsCacheOverview> {
  const res = await fetch("/api/main-events-check/cache-overview");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMainEventsLeavesStatus(): Promise<MainEventsLeavesStatusOverview> {
  const res = await fetch("/api/main-events-check/leaves-status");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type MainEventsSummaryAlignmentMismatch = {
  date: string;
  geminiLeaf: string;
  geminiLeafLabel: string;
  geminiEvent: string;
  dbSummaryPreview: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  tokenOverlap: number;
};

export type MainEventsSummaryAlignmentReport = {
  scanned: number;
  aligned: number;
  mismatches: MainEventsSummaryAlignmentMismatch[];
  pending: number;
  skippedLeaves: string[];
  locked: number;
  unlocked: number;
  lockActions: VerificationLockOutcome[];
  verificationMatched: number;
  verificationPending: number;
};

export async function verifyMainEventsTopicAlignment(opts?: {
  leaf?: string;
  maxItems?: number;
  applyLockPolicy?: boolean;
  persistResults?: boolean;
}): Promise<MainEventsAlignmentReport> {
  const res = await fetch("/api/main-events-check/verify-alignment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function verifyMainEventsSummaryAlignment(opts?: {
  leaf?: string;
  maxItems?: number;
  applyLockPolicy?: boolean;
  persistResults?: boolean;
}): Promise<MainEventsSummaryAlignmentReport> {
  const res = await fetch("/api/main-events-check/verify-summaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function cacheMainEventsGeminiForLeaf(opts: {
  leaf: string;
  force?: boolean;
}): Promise<MainEventsGeminiCacheResult> {
  const res = await fetch("/api/main-events-check/cache-gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMainEventsCheckSnapshot(leaf: string): Promise<MainEventsCheckSnapshot> {
  const res = await fetch(`/api/main-events-check/snapshot/${encodeURIComponent(leaf)}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMainEventsCheckStats(leaf: string): Promise<LeafCorpusStats> {
  const res = await fetch(`/api/main-events-check/stats/${encodeURIComponent(leaf)}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMainEventsCheckPreview(leaf: string): Promise<LeafCoverageResult | null> {
  const res = await fetch(`/api/main-events-check/preview/${encodeURIComponent(leaf)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function runMainEventsCheck(opts: {
  leaf: string;
  autoLockMatches: boolean;
  refreshFromGemini?: boolean;
}): Promise<LeafCoverageResult> {
  const res = await fetch("/api/main-events-check/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type MainEventsDismissCategory = "misplaced" | "missing" | "extra";

export async function setMainEventsDismissal(opts: {
  leaf: string;
  category: MainEventsDismissCategory;
  date: string;
  dismissed?: boolean;
}): Promise<LeafCoverageResult> {
  const res = await fetch("/api/main-events-check/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...opts, dismissed: opts.dismissed !== false }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function promoteDayToLeaf(opts: {
  date: string;
  leaf: string;
  /** When true, unlock first if the day is locked so the topic can be changed. */
  unlockIfNeeded?: boolean;
  lock?: boolean;
}): Promise<{ topics: string[]; isLocked?: boolean }> {
  if (opts.unlockIfNeeded) {
    const unlockRes = await fetch(`/api/analysis/date/${encodeURIComponent(opts.date)}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: false }),
    });
    const unlockPayload = await unlockRes.json().catch(() => ({}));
    if (!unlockRes.ok) {
      throw new Error(typeof unlockPayload.error === "string" ? unlockPayload.error : "Failed to unlock day");
    }
  }

  const topicRes = await fetch(`/api/analysis/date/${encodeURIComponent(opts.date)}/topic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: opts.leaf }),
  });
  const topicPayload = await topicRes.json().catch(() => ({}));
  if (!topicRes.ok) {
    throw new Error(typeof topicPayload.error === "string" ? topicPayload.error : "Failed to move topic");
  }

  if (!opts.lock) {
    return { topics: Array.isArray(topicPayload.topics) ? topicPayload.topics : [opts.leaf] };
  }

  const lockRes = await fetch(`/api/analysis/date/${encodeURIComponent(opts.date)}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locked: true }),
  });
  const lockPayload = await lockRes.json().catch(() => ({}));
  if (!lockRes.ok) {
    throw new Error(typeof lockPayload.error === "string" ? lockPayload.error : "Topic moved but lock failed");
  }

  return {
    topics: Array.isArray(topicPayload.topics) ? topicPayload.topics : [opts.leaf],
    isLocked: Boolean(lockPayload.isLocked),
  };
}

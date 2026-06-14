import { formatTopicLeafWithGroup } from "./topic-hierarchy";
import { resolveStorylineLeafLabel } from "./topic-hierarchy-migration";
import { resolveMainEventsReviewItemLocked } from "./main-events-verification-lock";
import {
  EMPTY_MAIN_EVENTS_VERIFICATION_DATES,
  resolveMainEventsReviewStatus,
  type MainEventsReviewDecision,
  type MainEventsReviewItem,
  type MainEventsReviewQueue,
  type MainEventsVerificationDates,
  type MainEventsVerificationStatus,
} from "./leaf-agent-config";

export type CanonicalDateEntry = {
  date: string;
  event: string;
  importance: "landmark" | "major" | "notable";
  source_url?: string;
  sourceUrl?: string;
};

export type ReviewAnalysisRow = {
  date: string;
  summary: string | null;
  topicCategories: unknown;
  isLocked: boolean | null;
};

function parseDateList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
  );
}

export function parseVerificationDates(raw: unknown): MainEventsVerificationDates {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MAIN_EVENTS_VERIFICATION_DATES };
  }
  const row = raw as Record<string, unknown>;
  return {
    matched: parseDateList(row.matched).sort((a, b) => a.localeCompare(b)),
    pending: parseDateList(row.pending).sort((a, b) => a.localeCompare(b)),
    rejected: parseDateList(row.rejected).sort((a, b) => a.localeCompare(b)),
  };
}

export function normalizeMainEventsLeafKey(leaf: string): string {
  return leaf.trim().toLowerCase().replace(/\s+/g, " ");
}

function isDateAssignedToOtherLeaf(
  date: string,
  currentLeaf: string,
  assignments: Map<string, string>,
): boolean {
  const owner = assignments.get(date);
  if (!owner) return false;
  return normalizeMainEventsLeafKey(owner) !== normalizeMainEventsLeafKey(currentLeaf);
}

function readSourceUrl(entry: CanonicalDateEntry): string | undefined {
  return entry.sourceUrl ?? entry.source_url;
}

function topicLabelsFromCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const s = x.trim();
      if (s) out.push(s);
      continue;
    }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const label =
        typeof o.label === "string"
          ? o.label
          : typeof o.name === "string"
            ? o.name
            : typeof o.slug === "string"
              ? o.slug
              : "";
      if (label.trim()) out.push(label.trim());
    }
  }
  return out;
}

function normalizedTopicsForRow(raw: unknown): string[] {
  return topicLabelsFromCategories(raw).map((label) => {
    const resolved = resolveStorylineLeafLabel(label);
    return normalizeMainEventsLeafKey(resolved ?? label);
  });
}

function rowOnLeaf(raw: unknown, leaf: string): boolean {
  const target = normalizeMainEventsLeafKey(leaf);
  return normalizedTopicsForRow(raw).includes(target);
}

function displayLeafLabel(raw: unknown): string {
  const labels = topicLabelsFromCategories(raw);
  const first = labels[0];
  if (!first) return "Untagged";
  return formatTopicLeafWithGroup(resolveStorylineLeafLabel(first) ?? first);
}

/** Primary storyline leaf from a database row's topic_categories, if tagged. */
export function resolveDbOwnerLeafFromTopics(
  raw: unknown,
): { leaf: string; leafLabel: string } | null {
  const labels = topicLabelsFromCategories(raw);
  const first = labels[0];
  if (!first) return null;

  const leaf = resolveStorylineLeafLabel(first) ?? first.trim();
  if (!leaf) return null;

  return {
    leaf,
    leafLabel: formatTopicLeafWithGroup(leaf),
  };
}

export function crossCheckCanonicalDates(
  leaf: string,
  analyses: ReviewAnalysisRow[],
  canonical: CanonicalDateEntry[],
): {
  matched: Array<{ date: string; summary: string; isLocked: boolean }>;
  missing: string[];
  untagged: Array<{ date: string; summary: string; isLocked: boolean }>;
  misplaced: Array<{ date: string; summary: string; wrongLeafLabel: string; isLocked: boolean }>;
} {
  const byDate = new Map(analyses.map((row) => [row.date, row]));

  const matched: Array<{ date: string; summary: string; isLocked: boolean }> = [];
  const missing: string[] = [];
  const untagged: Array<{ date: string; summary: string; isLocked: boolean }> = [];
  const misplaced: Array<{ date: string; summary: string; wrongLeafLabel: string; isLocked: boolean }> =
    [];

  for (const entry of canonical) {
    const row = byDate.get(entry.date);
    if (!row) {
      missing.push(entry.date);
      continue;
    }

    if (rowOnLeaf(row.topicCategories, leaf)) {
      matched.push({
        date: entry.date,
        summary: (row.summary ?? "").trim(),
        isLocked: Boolean(row.isLocked),
      });
      continue;
    }

    const topics = normalizedTopicsForRow(row.topicCategories);
    if (topics.length === 0) {
      untagged.push({
        date: entry.date,
        summary: (row.summary ?? "").trim(),
        isLocked: Boolean(row.isLocked),
      });
      continue;
    }

    misplaced.push({
      date: entry.date,
      summary: (row.summary ?? "").trim(),
      wrongLeafLabel: displayLeafLabel(row.topicCategories),
      isLocked: Boolean(row.isLocked),
    });
  }

  return { matched, missing, untagged, misplaced };
}

export function buildMainEventsReviewQueue(opts: {
  leaf: string;
  canonical: CanonicalDateEntry[];
  analyses: ReviewAnalysisRow[];
  verification: MainEventsVerificationDates;
  crossLeafAssignments?: Map<string, string>;
}): MainEventsReviewQueue {
  const crossLeafAssignments = opts.crossLeafAssignments ?? new Map<string, string>();
  const crossCheck = crossCheckCanonicalDates(opts.leaf, opts.analyses, opts.canonical);
  const matchedByDate = new Map(crossCheck.matched.map((row) => [row.date, row]));
  const untaggedByDate = new Map(crossCheck.untagged.map((row) => [row.date, row]));
  const misplacedByDate = new Map(crossCheck.misplaced.map((row) => [row.date, row]));
  const missingDates = new Set(crossCheck.missing);

  const items: MainEventsReviewItem[] = [];

  for (const entry of opts.canonical) {
    if (isDateAssignedToOtherLeaf(entry.date, opts.leaf, crossLeafAssignments)) {
      continue;
    }

    const matched = matchedByDate.get(entry.date);
    const misplaced = misplacedByDate.get(entry.date);
    const sourceUrl = readSourceUrl(entry);

    const reviewStatus = resolveMainEventsReviewStatus(entry.date, opts.verification);

    if (matched) {
      items.push({
        date: entry.date,
        event: entry.event,
        importance: entry.importance,
        ...(sourceUrl ? { sourceUrl } : {}),
        dbStatus: "in_db",
        dbSummary: matched.summary || undefined,
        isLocked: resolveMainEventsReviewItemLocked({ isLocked: matched.isLocked, reviewStatus }),
        reviewStatus,
      });
      continue;
    }

    if (misplaced) {
      items.push({
        date: entry.date,
        event: entry.event,
        importance: entry.importance,
        ...(sourceUrl ? { sourceUrl } : {}),
        dbStatus: "wrong_leaf",
        dbSummary: misplaced.summary || undefined,
        wrongLeafLabel: misplaced.wrongLeafLabel,
        isLocked: resolveMainEventsReviewItemLocked({ isLocked: misplaced.isLocked, reviewStatus }),
        reviewStatus,
      });
      continue;
    }

    const untagged = untaggedByDate.get(entry.date);
    if (untagged) {
      items.push({
        date: entry.date,
        event: entry.event,
        importance: entry.importance,
        ...(sourceUrl ? { sourceUrl } : {}),
        dbStatus: "untagged",
        dbSummary: untagged.summary || undefined,
        isLocked: resolveMainEventsReviewItemLocked({ isLocked: untagged.isLocked, reviewStatus }),
        reviewStatus,
      });
      continue;
    }

    if (missingDates.has(entry.date)) {
      items.push({
        date: entry.date,
        event: entry.event,
        importance: entry.importance,
        ...(sourceUrl ? { sourceUrl } : {}),
        dbStatus: "missing",
        isLocked: resolveMainEventsReviewItemLocked({ reviewStatus }),
        reviewStatus,
      });
      continue;
    }

    items.push({
      date: entry.date,
      event: entry.event,
      importance: entry.importance,
      ...(sourceUrl ? { sourceUrl } : {}),
      dbStatus: "missing",
      isLocked: resolveMainEventsReviewItemLocked({ reviewStatus }),
      reviewStatus,
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));

  return {
    leaf: opts.leaf,
    leafLabel: formatTopicLeafWithGroup(opts.leaf),
    items,
    counts: {
      pending: items.filter((item) => item.reviewStatus === "pending").length,
      accepted: items.filter((item) => item.reviewStatus === "accepted").length,
      rejected: items.filter((item) => item.reviewStatus === "rejected").length,
      total: items.length,
    },
  };
}

export function reviewDecisionToVerificationStatus(
  decision: MainEventsReviewDecision,
): MainEventsVerificationStatus {
  if (decision === "accepted") return "matched";
  if (decision === "rejected") return "rejected";
  return "pending";
}

/** Optimistically move one queue item to accepted/rejected/pending and refresh counts. */
export function applyReviewDecisionToQueue(
  queue: MainEventsReviewQueue,
  date: string,
  decision: MainEventsReviewDecision,
): MainEventsReviewQueue {
  const reviewStatus: MainEventsReviewItem["reviewStatus"] =
    decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "pending";

  const items = queue.items.map((item) => {
    if (item.date !== date) return item;
    return {
      ...item,
      reviewStatus,
      isLocked: resolveMainEventsReviewItemLocked({
        isLocked: item.isLocked,
        reviewStatus,
      }),
    };
  });

  return {
    ...queue,
    items,
    counts: {
      total: items.length,
      pending: items.filter((item) => item.reviewStatus === "pending").length,
      accepted: items.filter((item) => item.reviewStatus === "accepted").length,
      rejected: items.filter((item) => item.reviewStatus === "rejected").length,
    },
  };
}

export function applyVerificationDecision(
  current: MainEventsVerificationDates,
  date: string,
  decision: MainEventsReviewDecision,
): MainEventsVerificationDates {
  const status = reviewDecisionToVerificationStatus(decision);
  const matched = new Set(current.matched);
  const pending = new Set(current.pending);
  const rejected = new Set(current.rejected);

  matched.delete(date);
  pending.delete(date);
  rejected.delete(date);

  if (status === "matched") matched.add(date);
  else if (status === "rejected") rejected.add(date);
  else pending.add(date);

  return {
    matched: [...matched].sort((a, b) => a.localeCompare(b)),
    pending: [...pending].sort((a, b) => a.localeCompare(b)),
    rejected: [...rejected].sort((a, b) => a.localeCompare(b)),
  };
}

export function countCorpusOnLeaf(analyses: ReviewAnalysisRow[], leaf: string): {
  corpusCount: number;
  lockedCount: number;
} {
  let corpusCount = 0;
  let lockedCount = 0;
  for (const row of analyses) {
    if (!rowOnLeaf(row.topicCategories, leaf)) continue;
    corpusCount += 1;
    if (row.isLocked) lockedCount += 1;
  }
  return { corpusCount, lockedCount };
}

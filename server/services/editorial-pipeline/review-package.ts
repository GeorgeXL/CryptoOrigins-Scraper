import { z } from "zod";
import { triageItemSchema } from "./contracts";

/**
 * Review phases for the staged "fetch → human pick → summarize → human approve" flow.
 *
 * The pipeline writes ONE human_review_queue row per phase. Approving advances to
 * the next phase (which may immediately auto-complete if no further human input
 * is required).
 */
export const reviewPhaseSchema = z.enum([
  /** Day already passes all checks; no operator action required (auto-approved). */
  "auto_pass",
  /** Empty / missing day: we fetched candidates from Exa, human must pick one before any summary is written. */
  "awaiting_article_pick",
  /** Operator picked an article; summary + tags + topics were generated and need a final human OK. */
  "awaiting_summary_approval",
  /** Day exists but agents detected fixes (tag conflicts, weak summary, mismatched topics) — proposals attached. */
  "awaiting_correction_approval",
  /** Agent detected calendar mismatch (story belongs to a different date). */
  "awaiting_calendar_decision",
  /** Day appears to duplicate a neighbor. Human must merge/delete/differentiate. */
  "awaiting_duplicate_decision",
  /** Operator explicitly confirmed there is no significant news for this day. */
  "empty_confirmed",
]);

export type ReviewPhase = z.infer<typeof reviewPhaseSchema>;

/** Single candidate article returned by Exa, ready for human selection. */
export const articleCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
  publishedDate: z.string().nullable().optional(),
  tier: z.enum(["bitcoin", "crypto", "macro"]),
  source: z.string().optional(),
  summary: z.string().optional(),
  /** Tier-relative ranking (lower = better within tier). */
  rank: z.number().int().nonnegative(),
  /** Calendar sanity: how far the publishedDate is from the target date, in days. Null when no date available. */
  publishedDateOffsetDays: z.number().int().nullable(),
  /** True when calendar checks pass for this candidate (close to target, no famous-event mismatch). */
  calendarSanityOk: z.boolean(),
  /** Human-readable reasons surfaced from calendar checks. */
  calendarSanityNotes: z.array(z.string()).default([]),
  /** Composite 0..1 relevance score (tier weight + recency + keyword overlap). Helps operator pick. */
  relevanceScore: z.number().min(0).max(1).optional(),
  /** True when this candidate is the strongest of its tier and overall. UI highlights it. */
  recommended: z.boolean().optional(),
  /** Human-readable rationale lines for why this candidate scored well. */
  relevanceNotes: z.array(z.string()).optional(),
});

export type ArticleCandidate = z.infer<typeof articleCandidateSchema>;

export const removedDayContextSchema = z.object({
  reason: z.string(),
  removedAt: z.string(),
  source: z.enum(["calendar_group_remove", "calendar_keep_rerun", "calendar_delete"]).optional(),
  previousSummary: z.string().optional(),
  previousArticle: z
    .object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      tier: z.enum(["bitcoin", "crypto", "macro"]).optional(),
    })
    .optional(),
});

export type RemovedDayContext = z.infer<typeof removedDayContextSchema>;

export const articlePickPackageSchema = z.object({
  phase: z.literal("awaiting_article_pick"),
  scenario: z.enum(["empty_day", "missing_day", "better_storyline"]),
  triage: triageItemSchema,
  candidates: z.array(articleCandidateSchema),
  /** True when at least one candidate exists. False means truly empty — operator should confirm. */
  hasCandidates: z.boolean(),
  /** Optional operator-facing note. */
  note: z.string().optional(),
  /** Set when this day was cleared by calendar review and sent back to article pick. */
  removedDayContext: removedDayContextSchema.optional(),
});

export type ArticlePickPackage = z.infer<typeof articlePickPackageSchema>;

// ---------------------------------------------------------------------------
// Phase: awaiting_correction_approval
// Existing day with fixable issues. Each proposal carries `current` and
// `proposed` values so the UI can render a real diff and the writer can apply
// only the proposals the operator accepted.
// ---------------------------------------------------------------------------

export const correctionProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("promote_v1_to_v2_tags"),
    current: z.array(z.string()),
    proposed: z.array(z.string()),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("set_topic_categories"),
    current: z.array(z.string()),
    proposed: z.array(z.string()),
    rationale: z.string(),
    topicAgentSource: z.enum(["llm", "rules", "skipped"]).optional(),
    topicAgentConfidence: z.enum(["high", "medium", "low"]).optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("redo_summary"),
    currentSummary: z.string(),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("edit_summary"),
    currentSummary: z.string(),
    targetMin: z.number().int().default(100),
    targetMax: z.number().int().default(110),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("clear_orphan_flag"),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("clear_manual_flag"),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("fix_tag_conflict"),
    conflictingTags: z.array(z.string()),
    proposedDrop: z.array(z.string()),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("drop_ungrounded_tags"),
    /** Tags present on the row that don't appear in the summary or article text. */
    proposedDrop: z.array(z.string()),
    /** Taxonomy tags that appear in the text but are not on the row — operator hints. */
    suggestedFocusTags: z.array(z.string()).optional(),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("add_grounded_tags"),
    /** Tags that appear in the summary/article but are missing from the row. */
    proposedAdd: z.array(z.string()),
    /** Optional tags already suppressed by the operator for this date. */
    suppressed: z.array(z.string()).optional(),
    rationale: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("merge_redundant_tags"),
    /** Each pair: {from: redundant tag we drop, to: canonical we keep}. */
    merges: z.array(z.object({ from: z.string(), to: z.string() })),
    rationale: z.string(),
  }),
]);

export type CorrectionProposal = z.infer<typeof correctionProposalSchema>;

export const correctionApprovalPackageSchema = z.object({
  phase: z.literal("awaiting_correction_approval"),
  triage: triageItemSchema,
  proposals: z.array(correctionProposalSchema),
  /** Optional operator-facing note. */
  note: z.string().optional(),
});

export type CorrectionApprovalPackage = z.infer<typeof correctionApprovalPackageSchema>;

// ---------------------------------------------------------------------------
// Phase: awaiting_summary_approval (second gate in the v3 loop)
// After the operator picks an article we generate a summary + tag/topic
// proposals; this package is queued for a final human OK before the day is
// considered live.
// ---------------------------------------------------------------------------

export const summaryApprovalPackageSchema = z.object({
  phase: z.literal("awaiting_summary_approval"),
  triage: triageItemSchema,
  winningArticle: z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().url(),
    tier: z.enum(["bitcoin", "crypto", "macro"]),
  }),
  generatedSummary: z.string(),
  proposedTags: z.array(z.string()),
  proposedTopics: z.array(z.string()),
  note: z.string().optional(),
});

export type SummaryApprovalPackage = z.infer<typeof summaryApprovalPackageSchema>;

// ---------------------------------------------------------------------------
// Phase: awaiting_calendar_decision
// Detected canonical-date mismatch on an existing day. Operator decides what
// to do — move to canonical date, keep current date, or delete.
// ---------------------------------------------------------------------------

export const calendarDecisionPackageSchema = z.object({
  phase: z.literal("awaiting_calendar_decision"),
  triage: triageItemSchema,
  currentDate: z.string(),
  expectedDate: z.string(),
  ruleId: z.string(),
  reason: z.string(),
  /** Whether the canonical date is already occupied by another analysis row. */
  canonicalDateOccupied: z.boolean(),
  note: z.string().optional(),
});

export type CalendarDecisionPackage = z.infer<typeof calendarDecisionPackageSchema>;

// ---------------------------------------------------------------------------
// Phase: awaiting_duplicate_decision
// Strong taxonomy / token-jaccard overlap with a neighbor. Operator decides:
// keep both, delete focal, delete neighbor, or differentiate (manual).
// ---------------------------------------------------------------------------

export const duplicateNeighborSchema = z.object({
  date: z.string(),
  summaryPreview: z.string(),
  sharedTags: z.array(z.string()),
  sharedTopics: z.array(z.string()),
  tokenJaccard: z.number(),
});

export const duplicateDecisionPackageSchema = z.object({
  phase: z.literal("awaiting_duplicate_decision"),
  triage: triageItemSchema,
  focal: z.object({
    date: z.string(),
    summaryPreview: z.string(),
    tags: z.array(z.string()),
    topics: z.array(z.string()),
  }),
  neighbors: z.array(duplicateNeighborSchema),
  note: z.string().optional(),
});

export type DuplicateDecisionPackage = z.infer<typeof duplicateDecisionPackageSchema>;

/** Discriminated review package across every phase the v3 pipeline can emit. */
export const reviewPackageSchema = z.discriminatedUnion("phase", [
  articlePickPackageSchema,
  correctionApprovalPackageSchema,
  summaryApprovalPackageSchema,
  calendarDecisionPackageSchema,
  duplicateDecisionPackageSchema,
]);

export type ReviewPackage = z.infer<typeof reviewPackageSchema>;

// ---------------------------------------------------------------------------
// Type guards (the API + writer use these to branch on package shape).
// ---------------------------------------------------------------------------

function hasPhase(pkg: unknown, phase: string): boolean {
  return Boolean(pkg && typeof pkg === "object" && (pkg as { phase?: unknown }).phase === phase);
}

export function isArticlePickPackage(pkg: unknown): pkg is ArticlePickPackage {
  if (hasPhase(pkg, "awaiting_article_pick")) return true;
  /** Rows written before `phase` was always set: same payload shape, missing discriminator. */
  if (!pkg || typeof pkg !== "object") return false;
  const o = pkg as Record<string, unknown>;
  if (o.phase != null && o.phase !== "awaiting_article_pick") return false;
  const coerced = {
    phase: "awaiting_article_pick" as const,
    scenario: o.scenario,
    triage: o.triage,
    candidates: o.candidates,
    hasCandidates:
      typeof o.hasCandidates === "boolean" ?
        o.hasCandidates
      : Array.isArray(o.candidates) && o.candidates.length > 0,
    note: typeof o.note === "string" ? o.note : undefined,
  };
  return articlePickPackageSchema.safeParse(coerced).success;
}
export function isCorrectionApprovalPackage(pkg: unknown): pkg is CorrectionApprovalPackage {
  return hasPhase(pkg, "awaiting_correction_approval");
}
export function isSummaryApprovalPackage(pkg: unknown): pkg is SummaryApprovalPackage {
  return hasPhase(pkg, "awaiting_summary_approval");
}
export function isCalendarDecisionPackage(pkg: unknown): pkg is CalendarDecisionPackage {
  return hasPhase(pkg, "awaiting_calendar_decision");
}

/** True when a calendar flag involves exactly these two dates (either direction). */
export function calendarDecisionMatchesDatePair(
  pkg: CalendarDecisionPackage,
  dateA: string,
  dateB: string,
): boolean {
  return (
    (pkg.currentDate === dateA && pkg.expectedDate === dateB) ||
    (pkg.currentDate === dateB && pkg.expectedDate === dateA)
  );
}
export function isDuplicateDecisionPackage(pkg: unknown): pkg is DuplicateDecisionPackage {
  return hasPhase(pkg, "awaiting_duplicate_decision");
}

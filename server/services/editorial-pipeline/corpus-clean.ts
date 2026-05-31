/**
 * Unified corpus cleaning evaluation for one calendar day.
 * Mirrors the V3 existing-day path: date → duplicate → proposals → auto/manual split.
 * Used by pipeline runs and offline dry-run scripts.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { historicalNewsAnalyses } from "@shared/schema";
import type { TriageItem } from "./contracts";
import { evaluateDateConsistencyForDay } from "./date-consistency-llm";
import { isEditorialSummaryWeak } from "./editorial-quality";
import { buildCorrectionProposalsAsync } from "./proposals";
import type { CorrectionProposal } from "./review-package";
import { loadCanonicalTagIndex } from "./tag-grounding";
import { retriageSingleExistingDate } from "./triage";
import {
  getEditorialDuplicateNeighborContext,
  normalizedTagsFromRow,
  topicLabelsFromRow,
} from "./tools";
import { invalidTopicReasons } from "./topic-validation";
import {
  evaluateSemanticDuplicateForDay,
  isBorderlineDuplicateNeighbor,
} from "./duplicate-agent-llm";
import {
  evaluateRelevanceWithAgent,
  relevanceRequiresArticlePick,
} from "./relevance-agent";

export type CorpusCleanPhase =
  | "missing_day"
  | "auto_pass"
  | "awaiting_calendar_decision"
  | "awaiting_duplicate_decision"
  | "awaiting_article_pick"
  | "awaiting_correction_approval"
  | "needs_empty_day_path";

export type CorpusDayEvaluation = {
  date: string;
  triageRoute: TriageItem["route"];
  phase: CorpusCleanPhase;
  topicsBefore: string[];
  topicIssuesBefore: string[];
  dateCheck: Awaited<ReturnType<typeof evaluateDateConsistencyForDay>> | null;
  duplicateNeighbors: number;
  strongDuplicateNeighbors: number;
  proposals: CorrectionProposal[];
  autoProposals: CorrectionProposal[];
  manualProposals: CorrectionProposal[];
  wouldAutoApply: string[];
  wouldQueueForHuman: string[];
  topicAfterAuto: string | null;
  summaryPreview: string;
  relevanceClassification: string | null;
  relevanceReason: string | null;
};

const ALWAYS_AUTO_KINDS = new Set<CorrectionProposal["kind"]>([
  "clear_orphan_flag",
  "merge_redundant_tags",
  /** Same winning article — Summary Agent regen is trusted; no operator gate. */
  "redo_summary",
]);

const DUPLICATE_STRONG_THRESHOLDS: Array<{ j: number; sharedTags: number; sharedTopics?: number }> = [
  { j: 0.92, sharedTags: 1 },
  { j: 0.84, sharedTags: 2 },
  { j: 0.8, sharedTags: 2, sharedTopics: 1 },
  { j: 0.76, sharedTags: 3 },
];

export function isStrongDuplicateNeighbor(n: {
  tokenJaccard: number;
  sharedTags: string[];
  sharedTopics: string[];
}): boolean {
  for (const rule of DUPLICATE_STRONG_THRESHOLDS) {
    if (
      n.tokenJaccard >= rule.j &&
      n.sharedTags.length >= rule.sharedTags &&
      (rule.sharedTopics == null || n.sharedTopics.length >= rule.sharedTopics)
    ) {
      return true;
    }
  }
  return false;
}

/** Topic auto-apply only when exactly one leaf and agent/rules confidence is high. */
export function isHighConfidenceTopicAutoApply(proposal: CorrectionProposal): boolean {
  if (proposal.kind !== "set_topic_categories") return false;
  if (proposal.proposed.length !== 1) return false;
  return proposal.topicAgentConfidence === "high";
}

export function splitCorrectionProposalsForAutoApply(proposals: CorrectionProposal[]): {
  automatic: CorrectionProposal[];
  manual: CorrectionProposal[];
} {
  const automatic: CorrectionProposal[] = [];
  const manual: CorrectionProposal[] = [];
  for (const proposal of proposals) {
    if (proposal.kind === "set_topic_categories") {
      if (proposal.proposed.length === 0) {
        manual.push(proposal);
        continue;
      }
      if (isHighConfidenceTopicAutoApply(proposal)) automatic.push(proposal);
      else manual.push(proposal);
      continue;
    }
    if (ALWAYS_AUTO_KINDS.has(proposal.kind)) automatic.push(proposal);
    else manual.push(proposal);
  }
  return { automatic, manual };
}

function neighborHintsFromDuplicateContext(
  ctx: Awaited<ReturnType<typeof getEditorialDuplicateNeighborContext>> | null | undefined,
) {
  if (!ctx?.neighbors.length) return undefined;
  return ctx.neighbors.slice(0, 4).map((n) => ({
    date: n.date,
    topics: n.sharedTopics,
    summaryPreview: n.summaryPreview,
  }));
}

function collectArticleTextForGrounding(
  tieredArticles: unknown,
  analyzedArticles: unknown,
  cap = 20_000,
): string {
  const out: string[] = [];
  let remaining = cap;
  const pushPart = (s: unknown) => {
    if (remaining <= 0) return;
    if (typeof s !== "string") return;
    const trimmed = s.trim();
    if (!trimmed) return;
    const slice = trimmed.slice(0, remaining);
    out.push(slice);
    remaining -= slice.length;
  };
  if (tieredArticles && typeof tieredArticles === "object") {
    for (const key of ["bitcoin", "crypto", "macro"] as const) {
      const arr = (tieredArticles as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (!a || typeof a !== "object") continue;
        const o = a as Record<string, unknown>;
        pushPart(o.title);
        pushPart(o.summary);
        pushPart(o.text);
        if (remaining <= 0) break;
      }
      if (remaining <= 0) break;
    }
  }
  if (Array.isArray(analyzedArticles)) {
    for (const a of analyzedArticles) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      pushPart(o.title);
      pushPart(o.summary);
      pushPart(o.text);
      if (remaining <= 0) break;
    }
  }
  return out.join("\n");
}

function describeProposal(proposal: CorrectionProposal): string {
  if (proposal.kind === "set_topic_categories") {
    const topic = proposal.proposed[0] ?? "(pick manually)";
    return `topic→${topic}${proposal.topicAgentConfidence ? `[${proposal.topicAgentConfidence}]` : ""}`;
  }
  return proposal.kind;
}

function simulateTopicAfterAuto(
  currentTopics: string[],
  autoProposals: CorrectionProposal[],
): string | null {
  const topicProposal = autoProposals.find((p) => p.kind === "set_topic_categories");
  if (topicProposal?.kind === "set_topic_categories" && topicProposal.proposed.length === 1) {
    return topicProposal.proposed[0] ?? null;
  }
  if (currentTopics.length === 1 && invalidTopicReasons(currentTopics).length === 0) {
    return currentTopics[0] ?? null;
  }
  return null;
}

/**
 * Evaluate how the corpus cleaner would handle one day (no DB writes).
 */
export async function evaluateCorpusDay(date: string): Promise<CorpusDayEvaluation | null> {
  const [row] = await db
    .select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  if (!row) return null;

  const triage = await retriageSingleExistingDate(date);
  if (!triage) return null;

  const summary = String(row.summary ?? "").trim();
  const topicsBefore = topicLabelsFromRow(row.topicCategories);
  const topicIssuesBefore = invalidTopicReasons(topicsBefore);

  if (triage.route === "missing_day") {
    return {
      date,
      triageRoute: triage.route,
      phase: "missing_day",
      topicsBefore,
      topicIssuesBefore,
      dateCheck: null,
      duplicateNeighbors: 0,
      strongDuplicateNeighbors: 0,
      proposals: [],
      autoProposals: [],
      manualProposals: [],
      wouldAutoApply: [],
      wouldQueueForHuman: ["missing_day: gated article pick"],
      topicAfterAuto: null,
      summaryPreview: summary.slice(0, 100),
      relevanceClassification: null,
      relevanceReason: null,
    };
  }

  if (triage.route === "empty_day") {
    return {
      date,
      triageRoute: triage.route,
      phase: "awaiting_article_pick",
      topicsBefore,
      topicIssuesBefore,
      dateCheck: null,
      duplicateNeighbors: 0,
      strongDuplicateNeighbors: 0,
      proposals: [],
      autoProposals: [],
      manualProposals: [],
      wouldAutoApply: [],
      wouldQueueForHuman: ["empty_day: gated article pick"],
      topicAfterAuto: null,
      summaryPreview: summary.slice(0, 100),
      relevanceClassification: null,
      relevanceReason: null,
    };
  }

  // Date consistency
  let dateCheck: Awaited<ReturnType<typeof evaluateDateConsistencyForDay>> | null = null;
  if (summary.length >= 20 && triage.analysisId) {
    dateCheck = await evaluateDateConsistencyForDay({
      date,
      analysisId: triage.analysisId,
      summary,
    });
    const calendarExpected =
      dateCheck.status === "canonical"
        ? dateCheck.expectedDate
        : dateCheck.status === "mismatch" && dateCheck.duplicateOfDate
          ? dateCheck.duplicateOfDate
          : null;
    if (calendarExpected && calendarExpected !== date) {
      return {
        date,
        triageRoute: triage.route,
        phase: "awaiting_calendar_decision",
        topicsBefore,
      topicIssuesBefore,
        dateCheck,
        duplicateNeighbors: 0,
        strongDuplicateNeighbors: 0,
        proposals: [],
        autoProposals: [],
        manualProposals: [],
        wouldAutoApply: [],
        wouldQueueForHuman: [`calendar→${calendarExpected}`],
        topicAfterAuto: null,
        summaryPreview: summary.slice(0, 100),
        relevanceClassification: null,
        relevanceReason: null,
      };
    }
  }

  // Duplicate neighbors
  const duplicateCtx = summary
    ? await getEditorialDuplicateNeighborContext({
        date,
        analysisId: triage.analysisId ?? row.id,
        windowDays: 56,
        maxNeighbors: 6,
      })
    : null;
  const strongNeighbors = duplicateCtx?.neighbors.filter(isStrongDuplicateNeighbor) ?? [];
  if (strongNeighbors.length > 0) {
    return {
      date,
      triageRoute: triage.route,
      phase: "awaiting_duplicate_decision",
      topicsBefore,
      topicIssuesBefore,
      dateCheck,
      duplicateNeighbors: duplicateCtx?.neighbors.length ?? 0,
      strongDuplicateNeighbors: strongNeighbors.length,
      proposals: [],
      autoProposals: [],
      manualProposals: [],
      wouldAutoApply: [],
      wouldQueueForHuman: strongNeighbors.slice(0, 2).map((n) => `duplicate↔${n.date}`),
      topicAfterAuto: null,
      summaryPreview: summary.slice(0, 100),
      relevanceClassification: null,
      relevanceReason: null,
    };
  }

  // Semantic duplicate pass
  if (duplicateCtx?.neighbors.length) {
    for (const neighbor of duplicateCtx.neighbors.filter(isBorderlineDuplicateNeighbor).slice(0, 2)) {
      const semantic = await evaluateSemanticDuplicateForDay({
        date,
        summary,
        neighbor,
      });
      if (semantic.status === "duplicate") {
        return {
          date,
          triageRoute: triage.route,
          phase: "awaiting_duplicate_decision",
          topicsBefore,
          topicIssuesBefore,
          dateCheck,
          duplicateNeighbors: duplicateCtx.neighbors.length,
          strongDuplicateNeighbors: 1,
          proposals: [],
          autoProposals: [],
          manualProposals: [],
          wouldAutoApply: [],
          wouldQueueForHuman: [`duplicate↔${semantic.neighborDate} (semantic)`],
          topicAfterAuto: null,
          summaryPreview: summary.slice(0, 100),
          relevanceClassification: null,
          relevanceReason: null,
        };
      }
    }
  }

  const tags = normalizedTagsFromRow(row.tagsVersion2);
  const relevance = await evaluateRelevanceWithAgent({
    date,
    summary,
    tags,
    topics: topicsBefore,
    topArticleId: row.topArticleId,
  });
  if (relevanceRequiresArticlePick(relevance)) {
    return {
      date,
      triageRoute: triage.route,
      phase: "awaiting_article_pick",
      topicsBefore,
      topicIssuesBefore,
      dateCheck,
      duplicateNeighbors: duplicateCtx?.neighbors.length ?? 0,
      strongDuplicateNeighbors: 0,
      proposals: [],
      autoProposals: [],
      manualProposals: [],
      wouldAutoApply: [],
      wouldQueueForHuman: [`relevance:${relevance.classification} — pick a better article`],
      topicAfterAuto: null,
      summaryPreview: summary.slice(0, 100),
      relevanceClassification: relevance.classification,
      relevanceReason: relevance.classification,
    };
  }

  const canonicalTagIndex = await loadCanonicalTagIndex();
  const articleText = collectArticleTextForGrounding(row.tieredArticles, row.analyzedArticles);
  const proposals = await buildCorrectionProposalsAsync(
    {
      date,
      summary: row.summary,
      topArticleId: row.topArticleId,
      isOrphan: row.isOrphan,
      isFlagged: row.isFlagged,
      tagsVersion2: row.tagsVersion2,
      topicCategories: row.topicCategories,
      legacyTags: row.tags,
      articleText,
      canonicalTagIndex,
      suppressedGroundedTags: row.suppressedTagSuggestions,
    },
    { neighborHints: neighborHintsFromDuplicateContext(duplicateCtx) },
  );

  const { automatic: autoProposals, manual: manualProposals } =
    splitCorrectionProposalsForAutoApply(proposals);
  const wouldAutoApply = autoProposals.map(describeProposal);
  const wouldQueueForHuman = manualProposals.map(describeProposal);

  const topicAfterAuto = simulateTopicAfterAuto(topicsBefore, autoProposals);
  const topicStillInvalid =
    topicAfterAuto != null ? invalidTopicReasons([topicAfterAuto]).length > 0 : topicIssuesBefore.length > 0;

  let phase: CorpusCleanPhase = "auto_pass";
  if (manualProposals.length > 0 || (topicStillInvalid && topicIssuesBefore.length > 0)) {
    phase = "awaiting_correction_approval";
  } else if (
    triage.route === "existing_ok" &&
    proposals.length === 0 &&
    topicIssuesBefore.length === 0 &&
    !isEditorialSummaryWeak(summary)
  ) {
    phase = "auto_pass";
  } else if (autoProposals.length > 0 && manualProposals.length === 0 && !topicStillInvalid) {
    phase = "auto_pass";
  } else if (manualProposals.length === 0 && topicIssuesBefore.length === 0 && proposals.length === 0) {
    phase = "auto_pass";
  }

  if (phase === "awaiting_correction_approval" && wouldQueueForHuman.length === 0 && topicIssuesBefore.length > 0) {
    wouldQueueForHuman.push("topic: manual pick required");
  }

  return {
    date,
    triageRoute: triage.route,
    phase,
    topicsBefore,
    topicIssuesBefore,
    dateCheck,
    duplicateNeighbors: duplicateCtx?.neighbors.length ?? 0,
    strongDuplicateNeighbors: 0,
    proposals,
    autoProposals,
    manualProposals,
    wouldAutoApply,
    wouldQueueForHuman,
    topicAfterAuto,
    summaryPreview: summary.slice(0, 100),
    relevanceClassification: relevance.classification,
    relevanceReason: relevance.reason,
  };
}

/** Apply high-confidence auto proposals for one day (used by pipeline + batch scripts). */
export async function applyCorpusDayAutoFixes(
  date: string,
  autoProposals: CorrectionProposal[],
): Promise<string[]> {
  if (autoProposals.length === 0) return [];
  const { applyCorrectionProposals } = await import("./approved-writer");
  const result = await applyCorrectionProposals({
    date,
    proposals: autoProposals,
    acceptedIds: autoProposals.map((p) => p.id),
    reviewer: "corpus-clean:auto",
  });
  if (!result.ok) throw new Error(result.message);
  return result.applied;
}

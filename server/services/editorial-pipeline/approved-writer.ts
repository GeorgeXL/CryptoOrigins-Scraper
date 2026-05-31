/**
 * Approval writer for the editorial pipeline v3.
 *
 * Each `humanReviewQueue.package` carries an explicit `phase` (see
 * `review-package.ts`). The writer dispatches on phase to apply the operator's
 * decision to the underlying `historical_news_analyses` row and — for v3
 * gated-fetch — chains the next phase (e.g. article_pick → summary_approval).
 *
 * Legacy packages (just `{ triage: ... }`) keep their original behavior so the
 * v3 flag can be flipped on incrementally.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  historicalNewsAnalyses,
  humanReviewQueue,
  type ArticleData,
} from "@shared/schema";
import { storage } from "../../storage";
import { runExistingSearchAndSummaryForDate } from "./tools";
import {
  isArticlePickPackage,
  isCalendarDecisionPackage,
  isCorrectionApprovalPackage,
  isDuplicateDecisionPackage,
  isSummaryApprovalPackage,
  type ArticleCandidate,
  type CorrectionProposal,
  type SummaryApprovalPackage,
} from "./review-package";
import { computeOperatorActionPlan, type OperatorAutoFix } from "./operator-action";
import { normalizeTagList, normalizeTagValue, normalizeTopicList } from "./tools";
import type { TriageRoute } from "./contracts";
import {
  groundAndCanonicaliseTags,
  loadCanonicalTagIndex,
} from "./tag-grounding";
import { entityExtractor } from "../entity-extractor";
import { evaluateSummaryQuality, normalizeEditorialSummaryText } from "./editorial-quality";
import {
  ensureTopicCategoryAndStorylineLinks,
} from "./storyline-taxonomy";
import { suggestTopicsWithAgent } from "./topic-agent";
import { invalidTopicReasons } from "./topic-validation";
import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";

type ApprovedAction =
  | { kind: "reanalyze_date"; date: string }
  | { kind: "apply_corrections"; date: string }
  | { kind: "apply_correction_proposals"; date: string }
  | { kind: "apply_summary_approval"; date: string }
  | { kind: "apply_calendar_decision"; date: string }
  | { kind: "apply_duplicate_decision"; date: string }
  | { kind: "noop_review"; date: string }
  | { kind: "article_pick"; date: string };

export function determineApprovedAction(payload: unknown): { ok: boolean; action?: ApprovedAction; message?: string } {
  if (isArticlePickPackage(payload)) {
    return { ok: true, action: { kind: "article_pick", date: payload.triage.date } };
  }
  if (isCorrectionApprovalPackage(payload)) {
    return { ok: true, action: { kind: "apply_correction_proposals", date: payload.triage.date } };
  }
  if (isSummaryApprovalPackage(payload)) {
    return { ok: true, action: { kind: "apply_summary_approval", date: payload.triage.date } };
  }
  if (isCalendarDecisionPackage(payload)) {
    return { ok: true, action: { kind: "apply_calendar_decision", date: payload.triage.date } };
  }
  if (isDuplicateDecisionPackage(payload)) {
    return { ok: true, action: { kind: "apply_duplicate_decision", date: payload.triage.date } };
  }
  // Legacy: bare triage shape.
  const triage = (payload as any)?.triage;
  if (!triage?.date) return { ok: false, message: "Missing triage payload date" };
  if (triage.route === "missing_day" || triage.route === "empty_day") {
    return { ok: true, action: { kind: "reanalyze_date", date: triage.date } };
  }
  if (triage.route === "existing_needs_correction") {
    return { ok: true, action: { kind: "apply_corrections", date: triage.date } };
  }
  return { ok: true, action: { kind: "noop_review", date: triage.date } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidateToArticleData(c: ArticleCandidate): ArticleData {
  let host: string | undefined;
  try {
    host = new URL(c.url).hostname;
  } catch {
    host = undefined;
  }
  return {
    id: c.id,
    title: c.title,
    url: c.url,
    publishedDate: c.publishedDate ?? new Date().toISOString(),
    text: typeof c.summary === "string" ? c.summary : "",
    score: 0,
    summary: c.summary ?? "",
    source: c.source ?? host ?? "EXA",
  } as ArticleData;
}

const DEFAULT_TOPIC_SUGGESTION: string[] = [];

function tieredArticlesFromCandidates(candidates: ArticleCandidate[]) {
  const out: { bitcoin: ArticleData[]; crypto: ArticleData[]; macro: ArticleData[] } = {
    bitcoin: [],
    crypto: [],
    macro: [],
  };
  for (const c of candidates) out[c.tier].push(candidateToArticleData(c));
  return out;
}

function companyTagsFromTitle(title: string): string[] {
  const t = title.trim();
  if (!t) return [];
  const m = t.match(
    /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,4})\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|LLC)\b/,
  );
  if (!m) return [];
  const core = m[1]?.trim();
  // Prefer one canonical company label to avoid duplicates like
  // "Canaan" + "Canaan Inc" in the same suggestion set.
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

async function applyAutoFixesForDate(opts: {
  date: string;
  fixes: OperatorAutoFix[];
  reviewer?: string | null;
}): Promise<string[]> {
  const applied: string[] = [];
  if (!opts.fixes.length) return applied;
  const update: Record<string, unknown> = {};
  for (const fix of opts.fixes) {
    if (fix.code === "orphan_flag") {
      update.isOrphan = false;
      applied.push("cleared orphan flag");
    } else if (fix.code === "flagged") {
      update.isFlagged = false;
      update.flagReason = null;
      applied.push("cleared manual flag");
    } else if (fix.code === "low_confidence") {
      update.isManualOverride = true;
      applied.push("marked manual override (low confidence acknowledged)");
    }
  }
  if (Object.keys(update).length === 0) return applied;
  update.lastAnalyzed = new Date();
  await db.update(historicalNewsAnalyses).set(update).where(eq(historicalNewsAnalyses.date, opts.date));
  return applied;
}

// ---------------------------------------------------------------------------
// Phase: article pick — persist article, run summary, queue summary approval.
// ---------------------------------------------------------------------------

export async function applyArticlePickApproval(opts: {
  date: string;
  selectedArticleId: string;
  candidates: ArticleCandidate[];
  reviewer?: string | null;
  runId: string;
  triage: SummaryApprovalPackage["triage"];
  stepId: string | null;
}): Promise<{ ok: boolean; message: string; summary?: string; winningTier?: string }> {
  const candidate = opts.candidates.find((c) => c.id === opts.selectedArticleId);
  if (!candidate) {
    return {
      ok: false,
      message: `Selected article ${opts.selectedArticleId} is not in the candidate pool. Reject the review item and rerun the pipeline.`,
    };
  }
  if (candidate.calendarSanityOk === false) {
    const why = candidate.calendarSanityNotes?.length
      ? ` ${candidate.calendarSanityNotes.slice(0, 3).join("; ")}`
      : "";
    return {
      ok: false,
      message: `This article failed the date/story sanity check and cannot be approved as the winning article.${why}`,
    };
  }

  const requestId = `article-pick-${opts.date}-${Date.now()}`;
  const tiered = tieredArticlesFromCandidates(opts.candidates);
  const articleData = candidateToArticleData(candidate);

  const existing = await storage.getAnalysisByDate(opts.date);
  if (!existing) {
    await storage.createAnalysis({
      date: opts.date,
      summary: "",
      reasoning: `Created by editorial pipeline v3 article-pick (operator=${opts.reviewer ?? "unknown"})`,
      topArticleId: candidate.id,
      isManualOverride: true,
      isOrphan: true,
      tieredArticles: tiered,
      analyzedArticles: opts.candidates.map(candidateToArticleData),
      totalArticlesFetched: opts.candidates.length,
      uniqueArticlesAnalyzed: opts.candidates.length,
      aiProvider: "openai",
      winningTier: candidate.tier,
      tierUsed: candidate.tier,
    });
  } else {
    await storage.updateAnalysis(opts.date, {
      topArticleId: candidate.id,
      isManualOverride: true,
      isOrphan: true,
      tieredArticles: tiered,
      analyzedArticles: opts.candidates.map(candidateToArticleData),
      totalArticlesFetched: opts.candidates.length,
      uniqueArticlesAnalyzed: opts.candidates.length,
      aiProvider: "openai",
      winningTier: candidate.tier,
      tierUsed: candidate.tier,
    });
  }

  const { generateSummaryWithOpenAI } = await import("../analysis-modes");
  const summaryResult = await generateSummaryWithOpenAI(
    candidate.id,
    [articleData],
    opts.date,
    candidate.tier,
    requestId,
  );

  // Extract grounded tags from the generated summary text.
  // Anything that doesn't appear in the summary is dropped; near-duplicates ("Schnorr signatures")
  // are merged into existing taxonomy canonicals ("Schnorr").
  const articleText = typeof articleData.text === "string" ? articleData.text : "";
  let proposedTags: string[] = [];
  let extractedDropped: string[] = [];
  let extractedMerged: { from: string; to: string }[] = [];
  try {
    const rawEntities = await entityExtractor.extractEntitiesWithContext(
      summaryResult.summary,
      `${articleData.title}\n${articleText}`,
    );
    const index = await loadCanonicalTagIndex();
    const grounded = groundAndCanonicaliseTags({
      proposed: rawEntities,
      texts: [summaryResult.summary],
      index,
    });
    // Keep grounded tags as-is. We previously filtered publisher-like tokens
    // too aggressively, which dropped valid company entities (e.g. "Canaan")
    // when the source domain matched the company name.
    proposedTags = grounded.kept;
    const extras = companyTagsFromTitle(candidate.title);
    for (const extra of extras) {
      const key = extra.toLowerCase();
      if (!proposedTags.some((t) => t.toLowerCase() === key)) proposedTags.push(extra);
    }
    proposedTags = dedupeSemanticTags(proposedTags);
    extractedDropped = grounded.dropped.map((d) => d.name);
    extractedMerged = grounded.merged.map((m) => ({ from: m.from, to: m.to }));
  } catch (err) {
    // Tag extraction is best-effort — if it fails we still surface the summary
    // approval gate with an empty proposed list, and the operator can add tags
    // via the editable taxonomy field on the summary-approval panel.
    console.warn(`[article-pick] entity extraction failed for ${opts.date}:`, err);
  }

  const topicAgent = await suggestTopicsWithAgent({
    date: opts.date,
    summary: summaryResult.summary,
    tags: proposedTags,
    currentTopics: [],
    sourceSnippet: `${candidate.title}\n${articleText.slice(0, 500)}`,
  });
  const safeTopics = topicAgent.recommended
    ? [topicAgent.recommended]
    : topicAgent.proposed.length
      ? [topicAgent.proposed[0]]
      : [...DEFAULT_TOPIC_SUGGESTION];
  const topicNote =
    safeTopics.length > 0
      ? ` Topic: ${formatTopicLeafWithGroup(safeTopics[0])}.`
      : " No topic auto-assigned — pick one before approving.";

  await storage.updateAnalysis(opts.date, {
    summary: summaryResult.summary,
    reasoning: `Article-pick summary; tier=${candidate.tier}; operator=${opts.reviewer ?? "unknown"}`,
    confidenceScore: String(summaryResult.confidenceScore ?? 0),
    sentimentScore: String(summaryResult.sentimentScore ?? 0),
    sentimentLabel: summaryResult.sentimentLabel ?? "neutral",
    topicCategories: safeTopics,
  });

  // Queue the second gate so the operator can confirm/edit the generated
  // summary + tag set + topics before the day is declared "live" (orphan flag
  // stays on until then). The operator can edit each field inline; on approval
  // the writer persists what's on screen, not what the agent proposed.
  const mergedNote =
    extractedMerged.length > 0
      ? ` Merged: ${extractedMerged
          .slice(0, 3)
          .map((m) => `${m.from}→${m.to}`)
          .join(", ")}.`
      : "";
  const droppedNote =
    extractedDropped.length > 0
      ? ` Dropped ungrounded: ${extractedDropped.slice(0, 3).join(", ")}.`
      : "";
  const summaryPkg: SummaryApprovalPackage = {
    phase: "awaiting_summary_approval",
    triage: opts.triage,
    winningArticle: {
      id: candidate.id,
      title: candidate.title,
      url: candidate.url,
      tier: candidate.tier,
    },
    generatedSummary: summaryResult.summary,
    proposedTags,
    proposedTopics: topicAgent.proposed.length ? topicAgent.proposed : safeTopics,
    note: `Article picked and summary generated. Edit the summary, tags, or topics before approving.${mergedNote}${droppedNote}${topicNote}`,
  };
  await db.insert(humanReviewQueue).values({
    runId: opts.runId,
    stepId: opts.stepId,
    status: "pending",
    priority: 88,
    eventDate: opts.date,
    package: summaryPkg,
    reviewer: null,
    reviewedAt: null,
  });

  return {
    ok: true,
    message: `Article picked for ${opts.date}: "${candidate.title}". Summary generated (${summaryResult.summary.length} chars), ${proposedTags.length} tag(s) proposed. Queued for final operator approval.`,
    summary: summaryResult.summary,
    winningTier: candidate.tier,
  };
}

// ---------------------------------------------------------------------------
// Phase: correction proposals
// ---------------------------------------------------------------------------

export async function applyCorrectionProposals(opts: {
  date: string;
  proposals: CorrectionProposal[];
  acceptedIds: string[];
  proposalTagSelections?: Record<string, string[]>;
  proposalTopicSelections?: Record<string, string[]>;
  editedSummary?: string;
  reviewer?: string | null;
}): Promise<{ ok: boolean; applied: string[]; message: string }> {
  const accepted = new Set(opts.acceptedIds);
  const applied: string[] = [];
  const update: Record<string, unknown> = {};
  let redoSummaryRequested = false;

  for (const proposal of opts.proposals) {
    if (!accepted.has(proposal.id)) continue;

    switch (proposal.kind) {
      case "promote_v1_to_v2_tags": {
        update.tagsVersion2 = proposal.proposed;
        applied.push(`promoted ${proposal.proposed.length - proposal.current.length} legacy tag(s) to v2`);
        break;
      }
      case "set_topic_categories": {
        const selectedForProposal = opts.proposalTopicSelections?.[proposal.id];
        const chosenTopics = Array.isArray(selectedForProposal) && selectedForProposal.length > 0
          ? selectedForProposal
          : proposal.proposed;
        if (chosenTopics.length === 0) {
          return { ok: false, applied, message: "Pick exactly one homepage storyline leaf before applying the topic fix." };
        }
        const topicIssues = invalidTopicReasons(chosenTopics);
        if (topicIssues.length > 0) {
          return {
            ok: false,
            applied,
            message: `Topic hierarchy rejected: ${topicIssues.join("; ")}`,
          };
        }
        const linkedTopics = await ensureTopicCategoryAndStorylineLinks(opts.date, chosenTopics);
        update.topicCategories = linkedTopics;
        applied.push(`set storyline topics to ${linkedTopics.join(", ")}`);
        break;
      }
      case "fix_tag_conflict": {
        const current = Array.isArray(update.tagsVersion2)
          ? (update.tagsVersion2 as string[])
          : null;
        // Drop the conflicting tags from the in-flight v2 list (or current row's v2).
        let base: string[] | null = current;
        if (base == null) {
          const existing = await storage.getAnalysisByDate(opts.date);
          base = Array.isArray(existing?.tagsVersion2) ? (existing!.tagsVersion2 as string[]) : [];
        }
        const drop = new Set(normalizeTagList(proposal.proposedDrop));
        update.tagsVersion2 = normalizeTagList(base).filter((t) => !drop.has(t));
        applied.push(`dropped conflicting tag(s): ${proposal.proposedDrop.join(", ")}`);
        break;
      }
      case "drop_ungrounded_tags": {
        const current = Array.isArray(update.tagsVersion2) ? (update.tagsVersion2 as string[]) : null;
        let base: string[] | null = current;
        if (base == null) {
          const existing = await storage.getAnalysisByDate(opts.date);
          base = Array.isArray(existing?.tagsVersion2) ? (existing!.tagsVersion2 as string[]) : [];
        }
        // Match by case-insensitive name — proposedDrop preserves original casing.
        const dropLower = new Set(proposal.proposedDrop.map((t) => t.trim().toLowerCase()));
        update.tagsVersion2 = base.filter((t) => !dropLower.has(t.trim().toLowerCase()));
        applied.push(`dropped ungrounded tag(s): ${proposal.proposedDrop.slice(0, 4).join(", ")}`);
        break;
      }
      case "add_grounded_tags": {
        const current = Array.isArray(update.tagsVersion2) ? (update.tagsVersion2 as string[]) : null;
        let base: string[] | null = current;
        let suppressedBase: string[] = Array.isArray((update as { suppressedTagSuggestions?: unknown }).suppressedTagSuggestions)
          ? (((update as { suppressedTagSuggestions?: string[] }).suppressedTagSuggestions) ?? [])
          : [];
        if (base == null) {
          const existing = await storage.getAnalysisByDate(opts.date);
          base = Array.isArray(existing?.tagsVersion2) ? (existing!.tagsVersion2 as string[]) : [];
          suppressedBase = Array.isArray((existing as { suppressedTagSuggestions?: unknown } | undefined)?.suppressedTagSuggestions)
            ? ((((existing as { suppressedTagSuggestions?: string[] } | undefined)?.suppressedTagSuggestions) ?? []))
            : [];
        }
        const selectedForProposal = opts.proposalTagSelections?.[proposal.id];
        const chosenTags = Array.isArray(selectedForProposal) ? selectedForProposal : proposal.proposedAdd;
        const next = [...base];
        const seen = new Set(next.map((t) => normalizeTagValue(t)).filter(Boolean));
        for (const tag of chosenTags) {
          const key = normalizeTagValue(tag);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          next.push(tag);
        }
        update.tagsVersion2 = next;
        const suppressed = proposal.proposedAdd.filter(
          (tag) => !chosenTags.some((selected) => normalizeTagValue(selected) === normalizeTagValue(tag)),
        );
        if (suppressed.length > 0) {
          const mergedSuppressed = [...suppressedBase];
          const suppressedSeen = new Set(mergedSuppressed.map((tag) => normalizeTagValue(tag)).filter(Boolean));
          for (const tag of suppressed) {
            const key = normalizeTagValue(tag);
            if (!key || suppressedSeen.has(key)) continue;
            suppressedSeen.add(key);
            mergedSuppressed.push(tag);
          }
          update.suppressedTagSuggestions = mergedSuppressed;
        }
        if (chosenTags.length > 0) {
          applied.push(`added grounded tag(s): ${chosenTags.slice(0, 4).join(", ")}`);
        }
        if (suppressed.length > 0) {
          applied.push(`dismissed grounded tag suggestion(s): ${suppressed.slice(0, 4).join(", ")}`);
        }
        break;
      }
      case "merge_redundant_tags": {
        const current = Array.isArray(update.tagsVersion2) ? (update.tagsVersion2 as string[]) : null;
        let base: string[] | null = current;
        if (base == null) {
          const existing = await storage.getAnalysisByDate(opts.date);
          base = Array.isArray(existing?.tagsVersion2) ? (existing!.tagsVersion2 as string[]) : [];
        }
        // For each merge, drop "from" and ensure "to" is present (preserving order).
        const fromSet = new Set(proposal.merges.map((m) => m.from.trim().toLowerCase()));
        const remaining = base.filter((t) => !fromSet.has(t.trim().toLowerCase()));
        for (const m of proposal.merges) {
          const has = remaining.some((t) => t.trim().toLowerCase() === m.to.trim().toLowerCase());
          if (!has) remaining.push(m.to);
        }
        update.tagsVersion2 = remaining;
        applied.push(
          `merged ${proposal.merges.length} redundant tag(s): ${proposal.merges
            .slice(0, 3)
            .map((m) => `${m.from}→${m.to}`)
            .join(", ")}`,
        );
        break;
      }
      case "redo_summary": {
        redoSummaryRequested = true;
        break;
      }
      case "edit_summary": {
        const edited = opts.editedSummary?.trim() ?? "";
        const quality = evaluateSummaryQuality(edited);
        if (quality) {
          return {
            ok: false,
            applied,
            message: `Cannot apply summary edit: ${quality.message}`,
          };
        }
        update.summary = edited;
        applied.push(`updated summary (${edited.length} chars)`);
        break;
      }
      case "clear_orphan_flag": {
        update.isOrphan = false;
        applied.push("cleared orphan flag");
        break;
      }
      case "clear_manual_flag": {
        update.isFlagged = false;
        update.flagReason = null;
        applied.push("cleared manual flag");
        break;
      }
    }
  }

  if (Object.keys(update).length > 0) {
    update.lastAnalyzed = new Date();
    await db.update(historicalNewsAnalyses).set(update).where(eq(historicalNewsAnalyses.date, opts.date));
  }

  if (redoSummaryRequested) {
    const { regenerateSummaryWithAgent } = await import("./summary-agent");
    const out = await regenerateSummaryWithAgent(opts.date);
    if (out.ok) {
      applied.push(`regenerated summary (${out.summaryLength} chars)`);
    } else {
      const isAutoReviewer = Boolean(opts.reviewer?.endsWith(":auto"));
      const missingArticlePayload = Boolean(
        out.message?.includes("missing from stored payloads") ||
          out.message?.includes("Top article not present"),
      );
      if (isAutoReviewer && missingArticlePayload) {
        applied.push(`skipped summary regen (${out.message})`);
      } else {
        return {
          ok: false,
          applied,
          message: `Partial apply: ${applied.join("; ") || "no changes"}. Redo-summary failed: ${out.message}`,
        };
      }
    }
  }

  return {
    ok: true,
    applied,
    message:
      applied.length > 0
        ? `Approved ${opts.date}: ${applied.join("; ")}.`
        : `Approved ${opts.date}: no proposals were selected.`,
  };
}

// ---------------------------------------------------------------------------
// Phase: summary approval (post-article-pick gate)
// ---------------------------------------------------------------------------

async function applySummaryApproval(opts: {
  date: string;
  pkg: SummaryApprovalPackage;
  edits?: {
    editedSummary?: string;
    editedTags?: string[];
    editedTopics?: string[];
  };
  reviewer?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  // Operator edits take precedence over package proposals; fall back to whatever
  // the v3 article-pick path produced. We DO commit empty arrays — that means
  // "operator deliberately removed everything" and should be honoured.
  const finalSummary = normalizeEditorialSummaryText(
    (opts.edits?.editedSummary ?? opts.pkg.generatedSummary).trim(),
  );
  const finalTags = normalizeUserTagList(opts.edits?.editedTags ?? opts.pkg.proposedTags);
  const proposedTopics =
    opts.edits?.editedTopics ??
    (opts.pkg.proposedTopics.length
      ? opts.pkg.proposedTopics
      : (
          await suggestTopicsWithAgent({
            date: opts.date,
            summary: finalSummary,
            tags: finalTags,
            currentTopics: [],
            sourceSnippet: opts.pkg.winningArticle.title,
          })
        ).proposed);
  const normalizedTopics = normalizeUserTopicList(proposedTopics).slice(0, 1);
  const finalTopics = normalizedTopics.length ? normalizedTopics : [...DEFAULT_TOPIC_SUGGESTION];

  if (!finalSummary) {
    return {
      ok: false,
      message: `Summary cannot be empty. Edit the summary or reject the review item.`,
    };
  }

  // Apply the same length/placeholder rules the Events Manager uses
  // (`QualityCheckerService`). Reject too-short/too-long so we don't ship
  // bad copy through the human gate — the operator can either expand/trim
  // and resubmit, or reject + rerun.
  const quality = evaluateSummaryQuality(finalSummary);
  if (quality) {
    return {
      ok: false,
      message: `Cannot approve: ${quality.message} Edit the summary in the panel above to fix this.`,
    };
  }

  const linkedStorylines = await ensureTopicCategoryAndStorylineLinks(opts.date, finalTopics);
  const persistedTopicLabels = linkedStorylines.length ? linkedStorylines : finalTopics;

  await storage.updateAnalysis(opts.date, {
    summary: finalSummary,
    tagsVersion2: finalTags,
    topicCategories: persistedTopicLabels,
    isOrphan: false,
  });

  // Post-write assertion: re-read and confirm the row reflects the operator's
  // choices. Surfaces the silent-write bug class loudly if the column wasn't
  // accepted (e.g. JSON serialization mismatch).
  const row = await storage.getAnalysisByDate(opts.date);
  const persistedTags = Array.isArray(row?.tagsVersion2) ? (row!.tagsVersion2 as string[]) : [];
  const persistedTopics = Array.isArray(row?.topicCategories)
    ? (row!.topicCategories as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (persistedTags.length !== finalTags.length) {
    return {
      ok: false,
      message: `Summary approved for ${opts.date}, but tag persistence failed (expected ${finalTags.length}, got ${persistedTags.length}). Open the day page to fix manually.`,
    };
  }
  if (persistedTopics.length !== persistedTopicLabels.length) {
    return {
      ok: false,
      message: `Summary approved for ${opts.date}, but topic persistence failed (expected ${persistedTopicLabels.length}, got ${persistedTopics.length}). Open the day page to fix manually.`,
    };
  }

  return {
    ok: true,
    message: `Summary approved for ${opts.date}: ${finalTags.length} tag(s), ${persistedTopicLabels.length} storyline(s) written; orphan flag cleared.`,
  };
}

/** Light cleaner used when applying operator-edited tag lists. Trims, dedupes (case-insensitive), drops blanks. */
function normalizeUserTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const trimmed = x.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizeUserTopicList(raw: unknown): string[] {
  return normalizeUserTagList(raw);
}

// ---------------------------------------------------------------------------
// Phase: calendar decision
// ---------------------------------------------------------------------------

export type CalendarDecisionInput = "move_to_canonical" | "keep_as_is" | "delete";

async function applyCalendarDecision(opts: {
  date: string;
  expectedDate: string;
  canonicalDateOccupied: boolean;
  decision: CalendarDecisionInput;
  reviewer?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  switch (opts.decision) {
    case "move_to_canonical": {
      if (opts.canonicalDateOccupied) {
        return {
          ok: false,
          message: `Cannot move ${opts.date} → ${opts.expectedDate}: that date already has an analysis. Resolve the conflict manually first.`,
        };
      }
      await db
        .update(historicalNewsAnalyses)
        .set({ date: opts.expectedDate, isOrphan: false, lastAnalyzed: new Date() })
        .where(eq(historicalNewsAnalyses.date, opts.date));
      return { ok: true, message: `Moved analysis ${opts.date} → ${opts.expectedDate}.` };
    }
    case "keep_as_is": {
      // Operator explicitly accepted the mismatch. Set manual override so
      // future runs don't re-flag it.
      await storage.updateAnalysis(opts.date, { isManualOverride: true });
      return { ok: true, message: `Kept ${opts.date} as-is; marked manual override so future runs won't re-flag.` };
    }
    case "delete": {
      await storage.deleteAnalysis(opts.date);
      // After deleting the bad day, we still need an analysis for this date
      // unless the operator declared it truly empty. Enqueue a fresh v3 run
      // so the operator's next review item is "pick an article for ${date}".
      const rerun = await rerunDateAfterDestructiveEdit({
        date: opts.date,
        reason: "post-calendar-delete",
        reviewer: opts.reviewer ?? null,
      });
      return {
        ok: true,
        message: rerun.ok
          ? `Deleted analysis row for ${opts.date}. Started a new pipeline run (runId=${rerun.runId}); a fresh article-pick item will appear in the queue shortly.`
          : `Deleted analysis row for ${opts.date}. (Auto-rerun failed: ${rerun.message}. Trigger the pipeline for this date from the run launcher.)`,
      };
    }
  }
}

/**
 * Kick off a new single-day v3 pipeline run for a date that just lost its
 * analysis (e.g. via calendar-decision delete) or whose review item was rejected
 * with operator intent to retry. Returns the new runId on success.
 */
async function rerunDateAfterDestructiveEdit(opts: {
  date: string;
  reason: string;
  reviewer?: string | null;
}): Promise<{ ok: boolean; runId?: string; message?: string }> {
  try {
    // Lazy import to avoid the writer ↔ run.ts circular module load.
    const { startEditorialPipelineRun } = await import("./run");
    const out = await startEditorialPipelineRun({
      dateFrom: opts.date,
      dateTo: opts.date,
      maxDaysToConsider: 1,
      requestedBy: `editorial-writer:${opts.reason}:${opts.reviewer ?? "anon"}`,
    });
    return { ok: true, runId: out.runId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Operator-facing helper: re-run the pipeline for a date associated with a
 * (rejected or otherwise dead-ended) review item. Exposed to the route layer.
 */
export async function rerunPipelineForDate(opts: {
  date: string;
  reviewer?: string | null;
}): Promise<{ ok: boolean; runId?: string; message: string }> {
  const out = await rerunDateAfterDestructiveEdit({
    date: opts.date,
    reason: "operator-rerun",
    reviewer: opts.reviewer ?? null,
  });
  if (!out.ok) {
    return { ok: false, message: out.message ?? "Failed to start pipeline run" };
  }
  return {
    ok: true,
    runId: out.runId,
    message: `Started new pipeline run for ${opts.date} (runId=${out.runId}).`,
  };
}

// ---------------------------------------------------------------------------
// Phase: duplicate decision
// ---------------------------------------------------------------------------

export type DuplicateDecisionInput =
  | "keep_both"
  | "delete_focal"
  | "delete_neighbor"
  | "differentiate"
  | "find_another_event";

async function applyDuplicateDecision(opts: {
  date: string;
  decision: DuplicateDecisionInput;
  neighborDate?: string;
  reviewer?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  switch (opts.decision) {
    case "keep_both": {
      await storage.updateAnalysis(opts.date, { isManualOverride: true });
      return { ok: true, message: `Kept ${opts.date} alongside its duplicates; manual override set.` };
    }
    case "delete_focal": {
      await storage.deleteAnalysis(opts.date);
      return { ok: true, message: `Deleted focal day ${opts.date}; neighbor(s) preserved.` };
    }
    case "delete_neighbor": {
      if (!opts.neighborDate) {
        return { ok: false, message: "delete_neighbor requires neighborDate." };
      }
      await storage.deleteAnalysis(opts.neighborDate);
      return { ok: true, message: `Deleted neighbor day ${opts.neighborDate}; focal ${opts.date} preserved.` };
    }
    case "differentiate": {
      // No DB change — operator will edit the days manually. Mark as overridden
      // so triage doesn't repeat the same complaint immediately.
      await storage.updateAnalysis(opts.date, { isManualOverride: true });
      return {
        ok: true,
        message: `Marked ${opts.date} as 'will differentiate manually'. Edit the summaries / tags on each day.`,
      };
    }
    case "find_another_event": {
      await storage.deleteAnalysis(opts.date);
      const rerun = await rerunDateAfterDestructiveEdit({
        date: opts.date,
        reason: "duplicate-find-another-event",
        reviewer: opts.reviewer ?? null,
      });
      return {
        ok: rerun.ok,
        message: rerun.ok
          ? `Rejected duplicate storyline for ${opts.date}. Started a fresh candidate search (runId=${rerun.runId}).`
          : `Rejected duplicate storyline for ${opts.date}, but fresh candidate search failed: ${rerun.message}.`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type ApprovalOptions = {
  selectedArticleId?: string;
  acceptedProposalIds?: string[];
  proposalTagSelections?: Record<string, string[]>;
  proposalTopicSelections?: Record<string, string[]>;
  calendarDecision?: CalendarDecisionInput;
  duplicateDecision?: DuplicateDecisionInput;
  replaceArticleId?: string;
  /** Operator-edited summary text (overrides package proposedSummary on summary-approval). */
  editedSummary?: string;
  /** Operator-edited tag list (overrides package proposedTags on summary-approval). */
  editedTags?: string[];
  /** Operator-edited topic list (overrides package proposedTopics on summary-approval). */
  editedTopics?: string[];
  reviewer?: string | null;
};

export async function executeApprovedReviewItem(
  reviewItemId: string,
  opts?: ApprovalOptions,
): Promise<{ ok: boolean; message: string; summary?: string; winningTier?: string }> {
  const [item] = await db.select().from(humanReviewQueue).where(eq(humanReviewQueue.id, reviewItemId)).limit(1);
  if (!item) return { ok: false, message: "Review item not found" };
  if (item.status !== "approved") return { ok: false, message: "Review item must be approved first" };

  const decision = determineApprovedAction(item.package);
  if (!decision.ok || !decision.action) return { ok: false, message: decision.message || "Invalid review package" };

  // ---- New v3 phases ----

  if (decision.action.kind === "article_pick") {
    if (!isArticlePickPackage(item.package)) {
      return { ok: false, message: "Article-pick package shape is invalid" };
    }
    if (!opts?.selectedArticleId) {
      return {
        ok: false,
        message: "selectedArticleId is required when approving an article-pick review item.",
      };
    }
    return applyArticlePickApproval({
      date: decision.action.date,
      selectedArticleId: opts.selectedArticleId,
      candidates: item.package.candidates,
      reviewer: opts.reviewer ?? null,
      runId: item.runId,
      stepId: item.stepId,
      triage: item.package.triage,
    });
  }

  if (decision.action.kind === "apply_correction_proposals") {
    if (!isCorrectionApprovalPackage(item.package)) {
      return { ok: false, message: "Correction package shape is invalid" };
    }
    if (opts?.replaceArticleId?.trim()) {
      const analysis = await storage.getAnalysisByDate(decision.action.date);
      if (!analysis) return { ok: false, message: `No analysis row for ${decision.action.date}` };
      const { buildStoredArticleCandidates } = await import("./run");
      const candidates = buildStoredArticleCandidates({
        topArticleId: analysis.topArticleId,
        tieredArticles: analysis.tieredArticles,
        analyzedArticles: analysis.analyzedArticles,
        targetDate: decision.action.date,
      });
      return applyArticlePickApproval({
        date: decision.action.date,
        selectedArticleId: opts.replaceArticleId.trim(),
        candidates,
        reviewer: opts.reviewer ?? null,
        runId: item.runId,
        stepId: item.stepId,
        triage: item.package.triage,
      });
    }
    const out = await applyCorrectionProposals({
      date: decision.action.date,
      proposals: item.package.proposals,
      acceptedIds: opts?.acceptedProposalIds ?? [],
      proposalTagSelections: opts?.proposalTagSelections,
      proposalTopicSelections: opts?.proposalTopicSelections,
      editedSummary: opts?.editedSummary,
      reviewer: opts?.reviewer ?? null,
    });
    return { ok: out.ok, message: out.message };
  }

  if (decision.action.kind === "apply_summary_approval") {
    if (!isSummaryApprovalPackage(item.package)) {
      return { ok: false, message: "Summary-approval package shape is invalid" };
    }
    return applySummaryApproval({
      date: decision.action.date,
      pkg: item.package,
      edits: {
        editedSummary: opts?.editedSummary,
        editedTags: opts?.editedTags,
        editedTopics: opts?.editedTopics,
      },
      reviewer: opts?.reviewer ?? null,
    });
  }

  if (decision.action.kind === "apply_calendar_decision") {
    if (!isCalendarDecisionPackage(item.package)) {
      return { ok: false, message: "Calendar-decision package shape is invalid" };
    }
    if (!opts?.calendarDecision) {
      return { ok: false, message: "calendarDecision is required (move_to_canonical | keep_as_is | delete)" };
    }
    return applyCalendarDecision({
      date: decision.action.date,
      expectedDate: item.package.expectedDate,
      canonicalDateOccupied: item.package.canonicalDateOccupied,
      decision: opts.calendarDecision,
      reviewer: opts?.reviewer ?? null,
    });
  }

  if (decision.action.kind === "apply_duplicate_decision") {
    if (!isDuplicateDecisionPackage(item.package)) {
      return { ok: false, message: "Duplicate-decision package shape is invalid" };
    }
    if (!opts?.duplicateDecision) {
      return {
        ok: false,
        message:
          "duplicateDecision is required (keep_both | delete_focal | delete_neighbor | differentiate | find_another_event)",
      };
    }
    return applyDuplicateDecision({
      date: decision.action.date,
      decision: opts.duplicateDecision,
      neighborDate: opts.duplicateNeighborDate,
      reviewer: opts?.reviewer ?? null,
    });
  }

  // ---- Legacy paths ----

  if (decision.action.kind === "reanalyze_date") {
    const out = await runExistingSearchAndSummaryForDate(decision.action.date);
    return {
      ok: true,
      message: `Applied existing search/summarization pipeline to ${decision.action.date} (articles=${out.totalArticlesFetched})`,
    };
  }

  if (decision.action.kind === "apply_corrections") {
    const triage = (item.package as any)?.triage as { route?: TriageRoute; reasons?: string[] } | undefined;
    const plan = computeOperatorActionPlan({
      route: (triage?.route as TriageRoute) ?? "existing_needs_correction",
      reasons: Array.isArray(triage?.reasons) ? (triage!.reasons as string[]) : [],
    });
    if (!plan.approveEnabled) {
      return {
        ok: false,
        message: `Approve is blocked for ${decision.action.date}: ${plan.manualFixes.length} manual issue(s) need hand-fixing first. ${plan.manualFixes.map((m) => m.label).join("; ")}.`,
      };
    }
    const applied = await applyAutoFixesForDate({
      date: decision.action.date,
      fixes: plan.autoFixes,
      reviewer: opts?.reviewer ?? null,
    });
    return {
      ok: true,
      message:
        applied.length > 0
          ? `Approved ${decision.action.date}: ${applied.join("; ")}.`
          : `Approved ${decision.action.date}: nothing to auto-fix; review item marked reviewed.`,
    };
  }

  // noop_review (existing_ok with no flags)
  return {
    ok: true,
    message: `Approved ${decision.action.date}: no changes — day already passes checks.`,
  };
}

// Re-exports kept for compatibility with existing scripts/tests.
export { normalizeTopicList };

/**
 * Pure derivation of correction proposals from a saved `historical_news_analyses`
 * row + helper signals. No DB writes, no LLM calls — this is intentionally
 * deterministic so the same triage input always yields the same proposed fixes
 * and tests can run offline.
 *
 * Each proposal carries `current` + `proposed` payloads so the UI can render a
 * real diff and `approved-writer` can apply only what the operator accepted.
 */

import { normalizeTagList, normalizeTagValue } from "./tools";
import { formatTagAddRationale, formatTagDropRationale } from "./agent-reason";
import type { CorrectionProposal } from "./review-package";
import {
  isEditorialSummaryWeak,
  isRoundupArticleContent,
  isRoundupMultiStorySummary,
  isValidPipelineTopArticleId,
} from "./editorial-quality";
import {
  editorialTagKey,
  filterEditorialTagAdds,
  isEditorialEntityTagCandidate,
  isEditoriallyInvalidCurrentTag,
  preferredEditorialTagDisplay,
} from "./editorial-tag-rules";
import {
  findGroundedTaxonomyTagsMissingFromRow,
  findRedundantTagPairs,
  findUngroundedTags,
  isTagGroundedInTexts,
  type CanonicalTagIndex,
} from "./tag-grounding";
import {
  rankTopicCandidatesFromSummary,
  storedTopicConflictsWithSummary,
  storedTopicMisaligned,
  type TopicRankingResult,
} from "./storyline-taxonomy";
import { invalidTopicReasons } from "./topic-validation";
import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";
import type { KnownEventContext } from "./known-event-context";

export type LegacyTag = { name?: unknown; category?: unknown } | string;

export type DayProposalInputs = {
  date: string;
  summary: string | null;
  topArticleId: string | null;
  isOrphan: boolean | null;
  isFlagged: boolean | null;
  tagsVersion2: string[] | null;
  topicCategories: unknown;
  legacyTags: unknown;
  /** Article body text (concatenated tier articles) used for grounding tags. */
  articleText?: string | null;
  /** When set, "drop ungrounded tags" proposals include story-aligned taxonomy hints. */
  canonicalTagIndex?: CanonicalTagIndex | null;
  /** Tags the operator explicitly declined to add for this date on prior runs. */
  suppressedGroundedTags?: string[] | null;
  /** When set (e.g. from Topic Agent), overrides rule-based topic ranking. */
  topicRankingOverride?: TopicRankingResult;
  /** Plain-language topic rationale from Topic Agent. */
  topicAgentReason?: string;
  topicAgentSource?: "llm" | "rules" | "skipped";
  topicAgentConfidence?: "high" | "medium" | "low";
  tagAgentAdd?: string[];
  tagAgentDrop?: string[];
  tagAgentReason?: string;
  tagAgentSource?: "llm" | "skipped";
  tagAgentConfidence?: "high" | "medium" | "low";
  summaryAgentReason?: string;
  summaryAgentSource?: "llm" | "rules" | "skipped";
  summaryAgentConfidence?: "high" | "medium" | "low";
  summaryAgentNeedsRegen?: boolean;
  summaryAgentSuggested?: string | null;
  knownEvent?: KnownEventContext | null;
};

function legacyTagNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const v = entry.trim();
      if (v) out.push(v);
    } else if (entry && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
  }
  return out;
}

function topicCategoryNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const v = entry.trim();
      if (v) out.push(v);
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const cand = [o.label, o.name, o.slug].find((x) => typeof x === "string" && (x as string).trim());
      if (typeof cand === "string") out.push(cand.trim());
    }
  }
  return out;
}

function buildId(date: string, kind: string): string {
  return `${date}:${kind}`;
}

function summaryFromWeeklyRoundup(input: DayProposalInputs): boolean {
  const summary = String(input.summary ?? "").trim();
  if (isRoundupMultiStorySummary(summary)) return true;
  return isRoundupArticleContent({
    summary,
    text: input.articleText,
  });
}

/**
 * Decide what set of v2 tags we want when the legacy `tags` column has
 * entries the v2 list is missing. We dedupe + normalize, preserve the
 * already-present v2 entries, then append the new ones.
 *
 * Important: legacy promotion is grounded against the CURRENT summary only.
 * The summary is the latest accepted editorial truth for the day; older
 * article/body context may belong to a replaced storyline and must not revive
 * stale legacy tags.
 */
function mergeV2WithLegacyTags(currentV2: string[], legacy: string[], groundingTexts: string[] = []): {
  proposed: string[];
  added: string[];
} {
  const currentNormalized = new Set(currentV2.map((t) => editorialTagKey(t)).filter(Boolean));
  const merged: string[] = [...currentV2];
  const added: string[] = [];
  const shouldGround = groundingTexts.some((t) => t && t.trim());
  for (const legacyName of legacy) {
    const normalized = editorialTagKey(legacyName);
    if (!normalized) continue;
    if (!isEditorialEntityTagCandidate(legacyName)) continue;
    if (currentNormalized.has(normalized)) continue;
    if (shouldGround && !isTagGroundedInTexts(legacyName, groundingTexts)) continue;
    currentNormalized.add(normalized);
    merged.push(legacyName);
    added.push(legacyName);
  }
  return {
    proposed: Array.from(new Set(merged.map((t) => t.trim()).filter(Boolean))),
    added,
  };
}


export function formatTopicPickRationale(proposed: string[]): string {
  if (proposed.length === 1) {
    return `Pick: ${formatTopicLeafWithGroup(proposed[0])}`;
  }
  if (proposed.length > 1) {
    return `Pick one: ${proposed.map(formatTopicLeafWithGroup).join(" · ")}`;
  }
  return "Pick a storyline leaf";
}

function buildTopicCategoryProposal(opts: {
  date: string;
  summary: string;
  topics: string[];
  topicIssues: string[];
  ranking: TopicRankingResult;
  agentReason?: string;
  topicAgentSource?: "llm" | "rules" | "skipped";
  topicAgentConfidence?: "high" | "medium" | "low";
}): CorrectionProposal | null {
  const { date, summary, topics, topicIssues, ranking, topicAgentSource, topicAgentConfidence } = opts;
  const topicConflict = storedTopicConflictsWithSummary(topics, summary);
  const topicMisaligned = storedTopicMisaligned(topics, ranking.primary ? [ranking.primary] : []);
  const needsFix = topicIssues.length > 0 || topicConflict || topicMisaligned;
  if (!needsFix) return null;

  const proposed =
    topicAgentConfidence === "high" && ranking.primary
      ? [ranking.primary]
      : ranking.confidence === "high" && ranking.primary
        ? [ranking.primary]
        : ranking.candidates.map((c) => c.leaf);

  const rationale = formatTopicPickRationale(proposed);

  return {
    id: buildId(date, "set_topic_categories"),
    kind: "set_topic_categories",
    current: topics,
    proposed,
    rationale,
    ...(topicAgentSource ? { topicAgentSource } : {}),
    ...(topicAgentConfidence ? { topicAgentConfidence } : {}),
  };
}

/** Tags that appear only as critics/opponents in the summary, not as the story subject. */
function findTangentialCriticTags(summary: string, tags: string[]): string[] {
  const patterns = [
    /criticism from (?:the )?([^,.;]+)/gi,
    /criticized by (?:the )?([^,.;]+)/gi,
    /facing criticism from (?:the )?([^,.;]+)/gi,
    /opposition from (?:the )?([^,.;]+)/gi,
  ];
  const criticKeys = new Set<string>();
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(summary)) !== null) {
      const phrase = match[1]?.trim() ?? "";
      if (!phrase) continue;
      criticKeys.add(normalizeTagValue(phrase));
      for (const word of phrase.split(/\s+/)) {
        const w = normalizeTagValue(word);
        if (w.length > 3) criticKeys.add(w);
      }
    }
  }
  if (criticKeys.size === 0) return [];
  return tags.filter((tag) => {
    const normalized = normalizeTagValue(tag);
    const key = editorialTagKey(tag);
    return criticKeys.has(normalized) || criticKeys.has(key);
  });
}

function aliasDuplicateTagPairs(currentTags: string[]): { from: string; to: string }[] {
  const canonicalByKey = new Map<string, string>();
  const out: { from: string; to: string }[] = [];
  for (const raw of currentTags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = editorialTagKey(tag);
    if (!key) continue;
    const existing = canonicalByKey.get(key);
    if (!existing) {
      canonicalByKey.set(key, tag);
      continue;
    }
    if (existing.toLowerCase() === tag.toLowerCase()) continue;
    out.push({ from: tag, to: existing });
  }
  return out;
}

function inferredMissingTagsFromSummary(
  summary: string,
  currentTags: string[],
  canonicalTagIndex?: CanonicalTagIndex | null,
): string[] {
  const current = new Set(currentTags.map((t) => editorialTagKey(t)).filter(Boolean));
  const out: string[] = [];
  const add = (tag: string) => {
    const display = preferredEditorialTagDisplay(tag);
    if (!isEditorialEntityTagCandidate(display)) return;
    const key = editorialTagKey(display);
    if (!key || current.has(key)) return;
    if (out.some((x) => editorialTagKey(x) === key)) return;
    out.push(display);
  };

  if (/\b(bitcoin|btc)\b/i.test(summary)) add("Bitcoin");

  if (canonicalTagIndex) {
    const taxonomyHits = findGroundedTaxonomyTagsMissingFromRow({
      texts: [summary],
      currentTags: [...currentTags, ...out],
      index: canonicalTagIndex,
      limit: 6,
    }).filter(isEditorialEntityTagCandidate);
    for (const hit of taxonomyHits) {
      add(hit);
    }
  }

  return out.slice(0, 6);
}

/**
 * Build the proposal list for a day in the `existing_needs_correction` route.
 * Empty array means there are no automated proposals — the operator must open
 * the day manually.
 */
export function buildCorrectionProposals(input: DayProposalInputs): CorrectionProposal[] {
  const out: CorrectionProposal[] = [];
  const summary = String(input.summary ?? "").trim();
  const currentV2 = Array.isArray(input.tagsVersion2)
    ? input.tagsVersion2.filter((t): t is string => typeof t === "string" && t.trim() !== "")
    : [];
  const legacy = legacyTagNames(input.legacyTags);
  const topics = topicCategoryNames(input.topicCategories);

  // 1. v1 → v2 tag promotion
  if (legacy.length > 0) {
    const { proposed, added } = mergeV2WithLegacyTags(currentV2, legacy, [summary]);
    if (added.length > 0) {
      out.push({
        id: buildId(input.date, "promote_v1_to_v2_tags"),
        kind: "promote_v1_to_v2_tags",
        current: currentV2,
        proposed,
        rationale: `Found ${added.length} legacy tag(s) not in v2: ${added.slice(0, 6).join(", ")}${added.length > 6 ? "…" : ""}.`,
      });
    }
  }

  // 2. Tag conflict resolution (web2 vs web3)
  const normalizedV2 = currentV2.map((t) => editorialTagKey(t)).filter(Boolean);
  if (normalizedV2.includes("web2") && normalizedV2.includes("web3")) {
    const summaryLower = summary.toLowerCase();
    const summaryMentionsWeb3 = summaryLower.includes("web3");
    const summaryMentionsWeb2 = summaryLower.includes("web2");
    const dropChoice = summaryMentionsWeb3 && !summaryMentionsWeb2
      ? ["web2"]
      : summaryMentionsWeb2 && !summaryMentionsWeb3
        ? ["web3"]
        : ["web2"];
    out.push({
      id: buildId(input.date, "fix_tag_conflict"),
      kind: "fix_tag_conflict",
      conflictingTags: ["web2", "web3"],
      proposedDrop: dropChoice,
      rationale:
        summaryMentionsWeb3 && !summaryMentionsWeb2
          ? "Summary talks about Web3 — drop the Web2 tag."
          : summaryMentionsWeb2 && !summaryMentionsWeb3
            ? "Summary talks about Web2 — drop the Web3 tag."
            : "Both Web2 and Web3 are tagged; pick one based on the summary.",
    });
  }

  // 3. Topic categories — enforce exactly one new-system hierarchy leaf.
  const ranking =
    input.topicRankingOverride ?? rankTopicCandidatesFromSummary({ summary, tags: currentV2 });
  const topicIssues = invalidTopicReasons(topics);
  const topicProposal = buildTopicCategoryProposal({
    date: input.date,
    summary,
    topics,
    topicIssues,
    ranking,
    agentReason: input.topicAgentReason,
    topicAgentSource: input.topicAgentSource,
    topicAgentConfidence: input.topicAgentConfidence,
  });
  if (topicProposal) out.push(topicProposal);

  const roundupSource = summaryFromWeeklyRoundup(input);

  // 4. Fix summary when it is outside the hard 100-110 character target.
  //    Article-backed days can regenerate from the winner. Known/manual days
  //    without a winner stay in human review with an inline summary edit.
  if (isEditorialSummaryWeak(summary) || input.summaryAgentNeedsRegen || roundupSource) {
    if (isValidPipelineTopArticleId(input.topArticleId)) {
      out.push({
        id: buildId(input.date, "redo_summary"),
        kind: "redo_summary",
        currentSummary: summary,
        rationale: roundupSource
          ? "Weekly roundup article/summary — pick one dated article and regenerate (100–110 chars)."
          : "Regenerate summary (100–110 chars).",
      });
    } else if (summary.length > 0) {
      out.push({
        id: buildId(input.date, "edit_summary"),
        kind: "edit_summary",
        currentSummary: summary,
        targetMin: 100,
        targetMax: 110,
        rationale: roundupSource
          ? "Weekly roundup summary — rewrite to one dated event (100–110 chars)."
          : input.knownEvent?.isKnownEvent
            ? "Edit summary to match the canonical reference (100–110 chars)."
            : "Edit summary (100–110 chars).",
      });
    }
  } else if (
    input.summaryAgentSuggested &&
    input.summaryAgentSuggested.length >= 100 &&
    input.summaryAgentSuggested.length <= 110 &&
    !input.summaryAgentNeedsRegen
  ) {
    out.push({
      id: buildId(input.date, "edit_summary"),
      kind: "edit_summary",
      currentSummary: summary,
      targetMin: 100,
      targetMax: 110,
      rationale: `Suggested: "${input.summaryAgentSuggested}"`,
    });
  }

  // 5. Orphan flag
  if (input.isOrphan) {
    out.push({
      id: buildId(input.date, "clear_orphan_flag"),
      kind: "clear_orphan_flag",
      rationale: "Day was manually picked outside the normal pipeline. Approve to clear the marker after review.",
    });
  }

  // 6. Manual flag
  if (input.isFlagged) {
    out.push({
      id: buildId(input.date, "clear_manual_flag"),
      kind: "clear_manual_flag",
      rationale: "Day was manually flagged. Clear the flag once you've verified the issue is resolved.",
    });
  }

  // 7. Ungrounded tags — summary is the editorial source of truth for what
  //    belongs on the row. Tags absent from the summary (even if they appear
  //    in an older article body) should be dropped.
  //    Skip tag inference when the summary/article is a weekly roundup — tags
  //    would be noise until a single dated article is picked.
  if (summary.length > 0 && !roundupSource) {
    const aliasDuplicateFrom = new Set(aliasDuplicateTagPairs(currentV2).map((pair) => pair.from.toLowerCase()));
    const invalidCurrentTags = currentV2.filter(isEditoriallyInvalidCurrentTag);
    const notInSummary = findUngroundedTags(currentV2, [summary]).filter(
      (tag) => !aliasDuplicateFrom.has(tag.toLowerCase()),
    );
    const tangentialCritics = findTangentialCriticTags(summary, currentV2);
    const ungrounded = Array.from(new Set([
      ...invalidCurrentTags,
      ...notInSummary,
      ...tangentialCritics,
      ...(input.tagAgentDrop ?? []),
    ]));
    const suppressedGrounded = new Set(
      (input.suppressedGroundedTags ?? []).map((tag) => editorialTagKey(tag)).filter(Boolean),
    );
    const inferredMissingTags = filterEditorialTagAdds(
      Array.from(
        new Set([
          ...inferredMissingTagsFromSummary(summary, currentV2, input.canonicalTagIndex),
          ...(input.tagAgentConfidence === "high" ? (input.tagAgentAdd ?? []) : []),
        ]),
      ).filter((tag) => isTagGroundedInTexts(tag, [summary])),
      currentV2,
    ).filter((tag) => !suppressedGrounded.has(editorialTagKey(tag)));
    if (ungrounded.length > 0) {
      const texts = [summary];
      let suggestedFocusTags: string[] | undefined;
      if (input.canonicalTagIndex) {
        suggestedFocusTags = findGroundedTaxonomyTagsMissingFromRow({
          texts,
          currentTags: currentV2,
          index: input.canonicalTagIndex,
          limit: 12,
        }).filter(isEditorialEntityTagCandidate);
        if (suggestedFocusTags.length === 0) suggestedFocusTags = undefined;
      }
      out.push({
        id: buildId(input.date, "drop_ungrounded_tags"),
        kind: "drop_ungrounded_tags",
        proposedDrop: ungrounded,
        ...(suggestedFocusTags && suggestedFocusTags.length > 0 ? { suggestedFocusTags } : {}),
        rationale: formatTagDropRationale(ungrounded),
      });
    }
    if (inferredMissingTags.length > 0) {
      out.push({
        id: buildId(input.date, "add_grounded_tags"),
        kind: "add_grounded_tags",
        proposedAdd: inferredMissingTags,
        ...((input.suppressedGroundedTags?.length ?? 0) > 0
          ? {
              suppressed: (input.suppressedGroundedTags ?? []).filter(Boolean).slice(0, 12),
            }
          : {}),
        rationale: formatTagAddRationale(inferredMissingTags),
      });
    }
  }

  // 8. Redundant tag pairs — e.g. "Schnorr" present alongside "Schnorr
  //    signatures". Merge the longer one into the shorter canonical so we
  //    don't grow a sea of near-duplicate tags.
  const redundantPairs = [...aliasDuplicateTagPairs(currentV2), ...findRedundantTagPairs(currentV2)];
  if (redundantPairs.length > 0) {
    out.push({
      id: buildId(input.date, "merge_redundant_tags"),
      kind: "merge_redundant_tags",
      merges: redundantPairs,
      rationale: redundantPairs
        .slice(0, 3)
        .map((p) => `"${p.from}" → "${p.to}"`)
        .join("; "),
    });
  }

  return out;
}

function sourceSnippetFromArticleText(articleText: string | null | undefined, maxLen = 600): string | null {
  const text = String(articleText ?? "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

/**
 * Like buildCorrectionProposals but runs the LLM Topic Agent when the day needs a topic fix.
 */
export async function buildCorrectionProposalsAsync(
  input: DayProposalInputs,
  opts?: { neighborHints?: import("./topic-agent").TopicAgentInput["neighborHints"] },
): Promise<CorrectionProposal[]> {
  const summary = String(input.summary ?? "").trim();
  const currentV2 = Array.isArray(input.tagsVersion2)
    ? input.tagsVersion2.filter((t): t is string => typeof t === "string" && t.trim() !== "")
    : [];
  const topics = topicCategoryNames(input.topicCategories);

  const { resolveTopicRankingForCorrection } = await import("./topic-agent");
  const { suggestTagsWithAgent } = await import("./tag-agent");
  const { evaluateSummaryWithAgent } = await import("./summary-agent");
  const { resolveKnownEventContext } = await import("./known-event-context");

  const articleSnippet = sourceSnippetFromArticleText(input.articleText);
  const knownEvent = input.knownEvent ?? (await resolveKnownEventContext(input.date));
  const roundupSource = summaryFromWeeklyRoundup(input);

  const [resolved, tagAgent, summaryAgent] = await Promise.all([
    resolveTopicRankingForCorrection({
      date: input.date,
      summary,
      tags: currentV2,
      currentTopics: topics,
      sourceSnippet: articleSnippet,
      neighborHints: opts?.neighborHints,
    }),
    suggestTagsWithAgent({
      date: input.date,
      summary,
      tags: currentV2,
      allowedAddCandidates:
        roundupSource || !input.canonicalTagIndex
          ? []
          : findGroundedTaxonomyTagsMissingFromRow({
              texts: [summary],
              currentTags: currentV2,
              index: input.canonicalTagIndex,
              limit: 12,
            }).filter(isEditorialEntityTagCandidate),
    }),
    evaluateSummaryWithAgent({
      date: input.date,
      summary,
      articleSnippet,
      topArticleId: input.topArticleId,
      knownEvent,
    }),
  ]);

  return buildCorrectionProposals({
    ...input,
    knownEvent,
    topicRankingOverride: resolved.ranking,
    topicAgentReason: resolved.agentReason,
    topicAgentSource: resolved.source,
    topicAgentConfidence: resolved.confidence,
    tagAgentAdd: tagAgent.addTags,
    tagAgentDrop: tagAgent.dropTags,
    tagAgentReason: tagAgent.source === "llm" ? tagAgent.reason : undefined,
    tagAgentSource: tagAgent.source,
    tagAgentConfidence: tagAgent.confidence,
    summaryAgentReason: summaryAgent.reason,
    summaryAgentSource: summaryAgent.source,
    summaryAgentConfidence: summaryAgent.confidence,
    summaryAgentNeedsRegen: summaryAgent.needsRegeneration && !summaryAgent.publishable,
    summaryAgentSuggested: summaryAgent.suggestedSummary,
  });
}

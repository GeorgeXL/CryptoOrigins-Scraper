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
import type { CorrectionProposal } from "./review-package";
import { isEditorialSummaryWeak, isValidPipelineTopArticleId } from "./editorial-quality";
import {
  findGroundedTaxonomyTagsMissingFromRow,
  findRedundantTagPairs,
  findUngroundedTags,
  isTagGroundedInTexts,
  type CanonicalTagIndex,
} from "./tag-grounding";
import { inferStorylineLabels, inferTopicProposal, storedTopicMisaligned } from "./storyline-taxonomy";
import { invalidTopicReasons } from "./topic-validation";
import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";
import {
  editorialTagKey,
  isEditorialEntityTagCandidate,
  isEditoriallyInvalidCurrentTag,
} from "./editorial-tag-rules";

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

const DEFAULT_TOPIC_SUGGESTION: string[] = [];

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
    if (!isEditorialEntityTagCandidate(tag)) return;
    const key = editorialTagKey(tag);
    if (!key || current.has(key)) return;
    if (out.some((x) => editorialTagKey(x) === key)) return;
    out.push(tag);
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
  const inferredStorylinesFromSummary = inferStorylineLabels({
    summary,
    tags: currentV2,
  });
  const inferredStorylinesFromArticle = inferredStorylinesFromSummary.length > 0
    ? []
    : inferStorylineLabels({
        summary,
        articleText: input.articleText,
        tags: currentV2,
      });
  const inferredTopicProposal = inferTopicProposal({
    summary,
    articleText: input.articleText,
    tags: currentV2,
  });
  const topicIssues = invalidTopicReasons(topics);
  const resolvedTopicProposal =
    inferredTopicProposal.length > 0
      ? inferredTopicProposal
      : inferredStorylinesFromSummary.length > 0
        ? inferredStorylinesFromSummary
        : inferredStorylinesFromArticle;
  if (topicIssues.length > 0) {
    const proposed = resolvedTopicProposal.length > 0 ? resolvedTopicProposal : DEFAULT_TOPIC_SUGGESTION;
    out.push({
      id: buildId(input.date, "set_topic_categories"),
      kind: "set_topic_categories",
      current: topics,
      proposed,
      rationale:
        proposed.length > 0
          ? `${topicIssues.join("; ")}. Auto-assigned ${formatTopicLeafWithGroup(proposed[0])}.`
          : `${topicIssues.join("; ")}. Could not infer a storyline leaf from the summary.`,
    });
  } else if (storedTopicMisaligned(topics, inferredTopicProposal)) {
    out.push({
      id: buildId(input.date, "set_topic_categories"),
      kind: "set_topic_categories",
      current: topics,
      proposed: inferredTopicProposal,
      rationale: `Stored topic "${topics[0]}" doesn't match the summary (inferred ${formatTopicLeafWithGroup(inferredTopicProposal[0])}).`,
    });
  }

  // 4. Fix summary when it is outside the hard 100-110 character target.
  //    Article-backed days can regenerate from the winner. Known/manual days
  //    without a winner stay in human review with an inline summary edit.
  if (isEditorialSummaryWeak(summary)) {
    if (isValidPipelineTopArticleId(input.topArticleId)) {
      out.push({
        id: buildId(input.date, "redo_summary"),
        kind: "redo_summary",
        currentSummary: summary,
        rationale: "Summary is outside the 100-110 character target. The winning article is set, so regen can run.",
      });
    } else if (summary.length > 0) {
      out.push({
        id: buildId(input.date, "edit_summary"),
        kind: "edit_summary",
        currentSummary: summary,
        targetMin: 100,
        targetMax: 110,
        rationale:
          "Summary is outside the 100-110 character target, but this looks like a manual/known event without a winning article. Edit the summary inline instead of fetching news.",
      });
    }
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
  if (summary.length > 0) {
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
    ]));
    const suppressedGrounded = new Set(
      (input.suppressedGroundedTags ?? []).map((tag) => editorialTagKey(tag)).filter(Boolean),
    );
    const inferredMissingTags = inferredMissingTagsFromSummary(summary, currentV2, input.canonicalTagIndex).filter(
      (tag) => !suppressedGrounded.has(editorialTagKey(tag)),
    );
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
        rationale: `Tag(s) "${ungrounded.slice(0, 4).join(", ")}${ungrounded.length > 4 ? "…" : ""}" don't belong on this summary. Approve to drop.`,
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
        rationale: `Named entities grounded in the summary but missing from tags: ${inferredMissingTags.slice(0, 4).join(", ")}${inferredMissingTags.length > 4 ? "…" : ""}. (Policy themes and process nouns are not tagged.)`,
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

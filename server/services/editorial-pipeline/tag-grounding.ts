/**
 * Tag-grounding and canonicalisation helpers.
 *
 * Two problems this module solves:
 *
 * 1. **Ungrounded tags**: an LLM (or legacy data) sometimes attaches a tag whose
 *    canonical name never appears in the summary or source article text. E.g.
 *    "Belgium" on a Russia/WTO article, or "Mitch McConnell" on a TARP blurb.
 *    These are pure hallucinations and should be dropped.
 *
 * 2. **Redundant tags**: the LLM proposes "Schnorr signatures" when the
 *    taxonomy already has the canonical tag "Schnorr". We merge the proposal
 *    into the existing canonical so we don't grow a sea of near-duplicate tags.
 *
 * Both helpers are pure and synchronous over data the caller fetched. The
 * one async helper is `loadCanonicalTagIndex()` which queries the `tags` table.
 */

import { db } from "../../db";
import { tags } from "@shared/schema";
import { normalizeTagValue } from "./tools";
import { filterEditorialTagAdds, isEditorialEntityTagCandidate, preferredEditorialTagDisplay } from "./editorial-tag-rules";

const TAG_GROUNDING_ALIASES: Record<string, string> = {
  eth: "ethereum",
  "bitcoin price": "bitcoin",
  "lightning network": "lightning",
  "c-lightning": "lightning",
  "coin terra": "cointerra",
  cointerra: "cointerra",
  "bitcoin atms": "bitcoin atm",
  "united states": "us",
  usa: "us",
  "u.s": "us",
  "u.s.": "us",
  "new york city": "new york",
  "winklevoss twins": "winklevoss",
};

function isPossessiveArtifact(raw: string): boolean {
  return /(?:'|’)s\b/i.test(raw.trim());
}

/** Lowercased + trimmed; punctuation collapsed to single spaces. */
export function normalizeForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Pure word-boundary tokens for prefix/containment checks. */
export function tokensOf(raw: string): string[] {
  return normalizeForMatch(raw).split(/\s+/).filter((t) => t.length > 0);
}

export type CanonicalTagIndex = {
  /** normalized name → original canonical name from the `tags` table */
  byNormalized: Map<string, string>;
  /** tokens (sorted) of every canonical tag, for prefix-word containment */
  tokensByNormalized: Map<string, string[]>;
  /** Original casings, sorted shortest-first (so we prefer "Schnorr" over "Schnorr signatures"). */
  canonicalsShortestFirst: string[];
};

/**
 * Snapshot the `tags` table into a fast in-memory index. Call once per
 * pipeline run / approval; small enough to keep in memory.
 */
export async function loadCanonicalTagIndex(): Promise<CanonicalTagIndex> {
  const rows = await db.select({ name: tags.name }).from(tags);
  return buildCanonicalTagIndex(rows.map((r) => r.name));
}

/** Pure builder used by tests; takes an explicit list of canonical names. */
export function buildCanonicalTagIndex(canonicalNames: string[]): CanonicalTagIndex {
  const byNormalized = new Map<string, string>();
  const tokensByNormalized = new Map<string, string[]>();
  for (const name of canonicalNames) {
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    const normalized = normalizeForMatch(trimmed);
    if (!normalized) continue;
    if (!byNormalized.has(normalized)) {
      byNormalized.set(normalized, trimmed);
      tokensByNormalized.set(normalized, tokensOf(trimmed));
    }
  }
  const canonicalsShortestFirst = [...byNormalized.values()].sort(
    (a, b) => normalizeForMatch(a).length - normalizeForMatch(b).length,
  );
  return { byNormalized, tokensByNormalized, canonicalsShortestFirst };
}

/**
 * Return the canonical taxonomy name for a proposed/legacy tag, or `null` if
 * the input doesn't match anything in the index.
 *
 * Resolution order:
 *   1. Exact normalized match.
 *   2. Existing canonical contains the proposed as a contiguous-word substring
 *      AND the existing canonical is shorter (proposed is more specific) →
 *      collapse to existing canonical. e.g. existing "Schnorr" + proposed
 *      "Schnorr signatures" → return "Schnorr".
 *   3. Proposed contains an existing canonical as a contiguous-word substring
 *      AND existing is shorter → same merge (covers both directions).
 *
 * We deliberately do not invent new canonicals here; callers decide whether
 * to keep the proposed verbatim if `canonicaliseAgainstIndex` returns null.
 */
export function canonicaliseAgainstIndex(
  proposedName: string,
  index: CanonicalTagIndex,
): { canonical: string; reason: "exact" | "merge_into_shorter" | "merge_via_subset" } | null {
  const normalized = normalizeForMatch(proposedName);
  if (!normalized) return null;

  const exact = index.byNormalized.get(normalized);
  if (exact != null) return { canonical: exact, reason: "exact" };

  const proposedTokens = tokensOf(proposedName);
  if (proposedTokens.length === 0) return null;
  const proposedTokenSet = new Set(proposedTokens);

  for (const canonical of index.canonicalsShortestFirst) {
    const canonicalNormalized = normalizeForMatch(canonical);
    if (canonicalNormalized === normalized) continue;
    const canonicalTokens = index.tokensByNormalized.get(canonicalNormalized) ?? [];
    if (canonicalTokens.length === 0) continue;
    if (canonicalTokens.length >= proposedTokens.length) continue;
    // Treat single-word canonical as a prefix-word match against proposed.
    if (canonicalTokens.every((tok) => proposedTokenSet.has(tok))) {
      return { canonical, reason: "merge_into_shorter" };
    }
  }
  return null;
}

/**
 * Check whether a tag is grounded in any of the provided texts.
 * "Grounded" = the tag's normalised form appears as a contiguous-word substring
 * of at least one text, or a known demonym/adjective form matches (Italy ↔ Italian).
 */
/** Singular entity tags that may appear plural in summary prose. */
const ENTITY_TAG_GROUNDING_VARIANTS: Record<string, string[]> = {
  "bitcoin atm": ["bitcoin atm", "bitcoin atms"],
};

const TAG_DEMONYM_GROUNDING: Record<string, string[]> = {
  italy: ["italian", "italy"],
  uk: ["british", "uk", "u k", "united kingdom"],
  us: ["u s", "american", "united states"],
  europe: ["european", "europe"],
  greece: ["greek", "greece"],
  germany: ["german", "germany"],
  france: ["french", "france"],
  spain: ["spanish", "spain"],
  china: ["chinese", "china"],
  russia: ["russian", "russia"],
  nigeria: ["nigerian", "nigeria"],
};

/** Normalized labels where a taxonomy acronym matches a common English word (CITES vs cites). */
const ACRONYM_HOMOGRAPH_NORMALIZED = new Set(["cites"]);

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiresStrictAcronymGrounding(tagName: string): boolean {
  const trimmed = tagName.trim();
  if (!/^[A-Z0-9]{2,6}$/.test(trimmed)) return false;
  return ACRONYM_HOMOGRAPH_NORMALIZED.has(normalizeForMatch(trimmed));
}

function isStrictAcronymGroundedInTexts(tagName: string, texts: string[]): boolean {
  const trimmed = tagName.trim();
  const re = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`);
  return texts.some((raw) => raw && re.test(raw));
}

export function isTagGroundedInTexts(tagName: string, texts: string[]): boolean {
  if (requiresStrictAcronymGrounding(tagName)) {
    return isStrictAcronymGroundedInTexts(tagName, texts);
  }
  const tagTokens = tokensOf(tagName);
  if (tagTokens.length === 0) return false;
  const joinedNormalizedTag = tagTokens.join(" ");
  for (const raw of texts) {
    if (!raw) continue;
    const haystack = normalizeForMatch(raw);
    if (!haystack) continue;
    const haystackPadded = ` ${haystack} `;
    const needle = ` ${joinedNormalizedTag} `;
    if (haystackPadded.includes(needle)) return true;
    const demonyms = TAG_DEMONYM_GROUNDING[joinedNormalizedTag.replace(/\./g, "")];
    if (demonyms?.some((form) => haystackPadded.includes(` ${form} `) || haystack.includes(form))) {
      return true;
    }
    const entityVariants = ENTITY_TAG_GROUNDING_VARIANTS[joinedNormalizedTag.replace(/\./g, "")];
    if (entityVariants?.some((form) => haystackPadded.includes(` ${form} `) || haystack.includes(form))) {
      return true;
    }
  }
  return false;
}

export type GroundingDrop = { name: string; reason: "ungrounded" | "redundant" | "not_entity" };
export type GroundingMerge = { from: string; to: string; reason: "exact" | "merge_into_shorter" | "merge_via_subset" };

export type GroundingResult = {
  /** Canonical form of every kept tag; deduplicated and original-casing-preserved. */
  kept: string[];
  /** Tags dropped because they don't appear in the texts. */
  dropped: GroundingDrop[];
  /** Tags merged into a shorter canonical already present in the taxonomy. */
  merged: GroundingMerge[];
};

/**
 * One-pass grounding + canonicalisation for a proposed tag list.
 *
 * - Drop any tag whose name is not grounded in any of the `texts`.
 * - For grounded tags, look up the canonical name in the index and merge near-duplicates.
 * - Preserve original casing where possible (we keep the first occurrence of each canonical).
 *
 * If `texts` is empty the grounding step is skipped (caller is responsible for
 * skipping grounding when no ground-truth text is available — e.g. legacy rows
 * with no summary).
 */
export function groundAndCanonicaliseTags(opts: {
  proposed: string[];
  texts: string[];
  index: CanonicalTagIndex;
  skipGrounding?: boolean;
}): GroundingResult {
  const { proposed, texts, index, skipGrounding } = opts;
  const kept: string[] = [];
  const dropped: GroundingDrop[] = [];
  const merged: GroundingMerge[] = [];
  const seenCanonicals = new Set<string>();
  const groundingEnabled = !skipGrounding && texts.some((t) => t && t.trim());

  for (const raw of proposed) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name) continue;

    if (!isEditorialEntityTagCandidate(name)) {
      dropped.push({ name, reason: "not_entity" });
      continue;
    }

    // Grounding gate
    if (groundingEnabled && !isTagGroundedInTexts(name, texts)) {
      dropped.push({ name, reason: "ungrounded" });
      continue;
    }

    // Canonicalisation gate
    const canonicalHit = canonicaliseAgainstIndex(name, index);
    const finalName = canonicalHit ? canonicalHit.canonical : name;
    if (canonicalHit && canonicalHit.reason !== "exact" && canonicalHit.canonical !== name) {
      merged.push({ from: name, to: canonicalHit.canonical, reason: canonicalHit.reason });
    }

    const key = normalizeForMatch(finalName);
    if (!key) continue;
    if (seenCanonicals.has(key)) {
      // Same canonical already kept; record as redundant (no separate "kept" entry).
      if (finalName !== name) {
        merged.push({ from: name, to: finalName, reason: "merge_via_subset" });
      } else {
        dropped.push({ name, reason: "redundant" });
      }
      continue;
    }
    seenCanonicals.add(key);
    kept.push(preferredEditorialTagDisplay(finalName));
  }

  return { kept, dropped, merged };
}

/**
 * Helper for the "drop ungrounded tags" correction proposal: given a current
 * v2 tag list and the summary/article texts, return the set of tags that are
 * not grounded. Pure: doesn't query the DB.
 */
export function findUngroundedTags(currentTags: string[], texts: string[]): string[] {
  if (!texts.some((t) => t && t.trim())) return [];
  const out: string[] = [];
  for (const raw of currentTags) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name) continue;
    if (!isTagGroundedInTexts(name, texts)) {
      out.push(name);
    }
  }
  return out;
}

/** Match row tags to taxonomy / hints (strips leading `#` before alias normalization). */
function tagKeyForRowMatch(raw: string): string {
  const normalized = normalizeTagValue(raw.trim().replace(/^#+/, ""));
  return TAG_GROUNDING_ALIASES[normalized] ?? normalized;
}

function isCoveredByExistingRowTag(candidate: string, currentTags: string[]): boolean {
  const candidateKey = tagKeyForRowMatch(candidate);
  if (!candidateKey) return false;
  const candidateTokens = tokensOf(candidateKey);
  if (candidateTokens.length === 0) return false;

  for (const raw of currentTags) {
    if (typeof raw !== "string") continue;
    const rowKey = tagKeyForRowMatch(raw);
    if (!rowKey) continue;
    if (rowKey === candidateKey) return true;

    const rowTokens = tokensOf(rowKey);
    if (rowTokens.length <= candidateTokens.length) continue;
    const rowTokenSet = new Set(rowTokens);
    if (candidateTokens.every((tok) => rowTokenSet.has(tok))) return true;
  }

  return false;
}

/**
 * Taxonomy names that **are** grounded in the summary/article but are **not**
 * already on the row. Used next to "drop ungrounded tags" so operators see
 * concrete story-aligned tags to favour (e.g. Russia, WTO instead of Belgium).
 *
 * Scans canonical tags shortest-first so shorter names win when multiple
 * taxonomies match overlapping text.
 */
export function findGroundedTaxonomyTagsMissingFromRow(opts: {
  texts: string[];
  currentTags: string[];
  index: CanonicalTagIndex;
  /** Hard cap — full taxonomy scans can be large. */
  limit?: number;
}): string[] {
  const { texts, currentTags, index, limit = 12 } = opts;
  if (!texts.some((t) => t?.trim())) return [];

  const onRow = new Set<string>();
  for (const raw of currentTags) {
    if (typeof raw !== "string") continue;
    const k = tagKeyForRowMatch(raw);
    if (k) onRow.add(k);
  }

  const out: string[] = [];
  const seenNorm = new Set<string>();

  for (const canonical of index.canonicalsShortestFirst) {
    if (out.length >= limit) break;
    const trimmed = canonical.trim();
    if (!trimmed) continue;
    if (isPossessiveArtifact(trimmed)) continue;
    const key = tagKeyForRowMatch(trimmed);
    if (!key || key.length < 2) continue;
    if (onRow.has(key)) continue;
    if (isCoveredByExistingRowTag(trimmed, currentTags)) continue;
    if (!isTagGroundedInTexts(trimmed, texts)) continue;
    if (!isEditorialEntityTagCandidate(trimmed)) continue;
    const norm = normalizeForMatch(trimmed);
    if (!norm || seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    out.push(preferredEditorialTagDisplay(trimmed));
  }

  return filterEditorialTagAdds(out, currentTags);
}

/**
 * Detect redundant tag pairs WITHIN a single tag list (e.g. "Schnorr" alongside
 * "Schnorr signatures"). Returns merges from the longer tag into the shorter
 * canonical that's already present in the same list.
 *
 * Note: this is intentionally different from `canonicaliseAgainstIndex`, which
 * resolves a proposal against the global taxonomy. Here we're cleaning up a
 * single row's `tagsVersion2` list.
 */
export function findRedundantTagPairs(currentTags: string[]): { from: string; to: string }[] {
  const names = currentTags
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .map((t) => t.trim());
  const out: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i += 1) {
    const longer = names[i];
    const longerTokens = tokensOf(longer);
    if (longerTokens.length === 0) continue;
    for (let j = 0; j < names.length; j += 1) {
      if (i === j) continue;
      const shorter = names[j];
      const shorterTokens = tokensOf(shorter);
      if (shorterTokens.length === 0) continue;
      if (shorterTokens.length >= longerTokens.length) continue;
      if (!shorterTokens.every((tok, idx) => longerTokens[idx] === tok)) continue;
      const key = `${longer}→${shorter}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: longer, to: shorter });
      break;
    }
  }
  return out;
}

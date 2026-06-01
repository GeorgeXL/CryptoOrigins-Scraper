/**
 * Quality bounds for editorial day summaries. These mirror the bounds the user
 * already uses in the Events Manager (`server/services/quality-checker.ts`)
 * so the editorial pipeline applies the same standard.
 *
 * The cleanup pipeline uses one hard editorial rule throughout: summaries must
 * be 100-110 characters before a day can be treated as clean.
 */
export const EDITORIAL_SUMMARY_TARGET_MIN = 100;
export const EDITORIAL_SUMMARY_TARGET_MAX = 110;

const FAILURE_SUMMARY_PATTERNS: RegExp[] = [
  /^analysis failed\.?$/i,
  /^no summary\.?$/i,
  /^summary generation failed\.?$/i,
];

/**
 * True when the summary is missing, outside the 100-110 target, or matches
 * known failure placeholders. Used by triage and pipeline executors so steps
 * cannot "complete" on junk text.
 */
export function isEditorialSummaryWeak(summary: string | null | undefined): boolean {
  return evaluateSummaryQuality(summary) !== null;
}

export type SummaryQualityIssue = {
  code:
    | "empty"
    | "too_short"
    | "too_long"
    | "failure_placeholder"
    | "disallowed_symbols"
    | "roundup_multi_story"
    | "trailing_punctuation"
    | "improper_capitalization";
  message: string;
};

/** Timeline summaries must capitalize named assets, protocols, and major brands. */
const EDITORIAL_SUMMARY_PROPER_NOUNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bbitcoin\b/g, replacement: "Bitcoin" },
  { pattern: /\bethereum\b/g, replacement: "Ethereum" },
  { pattern: /\blitecoin\b/g, replacement: "Litecoin" },
  { pattern: /\bdogecoin\b/g, replacement: "Dogecoin" },
  { pattern: /\bsolana\b/g, replacement: "Solana" },
  { pattern: /\bcardano\b/g, replacement: "Cardano" },
  { pattern: /\bsatoshi\b/g, replacement: "Satoshi" },
  { pattern: /\blightning network\b/g, replacement: "Lightning Network" },
  { pattern: /\bcoinbase\b/g, replacement: "Coinbase" },
  { pattern: /\bbinance\b/g, replacement: "Binance" },
  { pattern: /\bkraken\b/g, replacement: "Kraken" },
  { pattern: /\bbitfinex\b/g, replacement: "Bitfinex" },
  { pattern: /\bpaypal\b/g, replacement: "PayPal" },
  { pattern: /\brevolut\b/g, replacement: "Revolut" },
  { pattern: /\bmt\.?\s*gox\b/g, replacement: "Mt. Gox" },
  { pattern: /\bdefi\b/g, replacement: "DeFi" },
  { pattern: /\bweb3\b/g, replacement: "Web3" },
];

const LOWERCASE_PROPER_NOUN_CHECKS = [
  "bitcoin",
  "ethereum",
  "litecoin",
  "dogecoin",
  "solana",
  "cardano",
  "satoshi",
  "coinbase",
  "binance",
  "kraken",
  "paypal",
] as const;

/** Remove ending punctuation — timeline summaries never end with a full stop. */
export function stripTrailingSummaryPunctuation(summary: string): string {
  return summary.trim().replace(/[.!?,;:–—-]+\s*$/u, "").trim();
}

export function summaryHasTrailingPunctuation(summary: string): boolean {
  return /[.!?]\s*$/.test(summary.trim());
}

export function fixEditorialSummaryProperNouns(summary: string): string {
  let out = summary;
  for (const { pattern, replacement } of EDITORIAL_SUMMARY_PROPER_NOUNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function findImproperProperNouns(summary: string): string[] {
  return LOWERCASE_PROPER_NOUN_CHECKS.filter((term) => new RegExp(`\\b${term}\\b`).test(summary));
}

/** Deterministic cleanup applied after LLM summary generation and before persistence. */
export function normalizeEditorialSummaryText(summary: string): string {
  return fixEditorialSummaryProperNouns(stripTrailingSummaryPunctuation(summary.trim()));
}

/** Trim slightly-overlong summaries to the 100–110 window at a word boundary. */
export function coerceEditorialSummaryLength(summary: string): string | null {
  const normalized = normalizeEditorialSummaryText(summary);
  if (!normalized) return null;
  const len = normalized.length;
  if (len >= EDITORIAL_SUMMARY_TARGET_MIN && len <= EDITORIAL_SUMMARY_TARGET_MAX) return normalized;
  if (len > EDITORIAL_SUMMARY_TARGET_MAX && len <= EDITORIAL_SUMMARY_TARGET_MAX + 10) {
    let cut = normalized.slice(0, EDITORIAL_SUMMARY_TARGET_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace >= EDITORIAL_SUMMARY_TARGET_MIN) cut = cut.slice(0, lastSpace).trim();
    if (cut.length >= EDITORIAL_SUMMARY_TARGET_MIN && cut.length <= EDITORIAL_SUMMARY_TARGET_MAX) return cut;
  }
  return null;
}

/** Mirrors Events Manager quality rules — timeline summaries are one clause, one event. */
export function summaryDisallowedSymbol(summary: string): string | null {
  if (summary.includes(";")) return "semicolon";
  if (summary.includes(":")) return "colon";
  if (summary.includes("?")) return "question mark";
  if (/ - /.test(summary)) return "space-hyphen";
  return null;
}

/** Semicolon chains or multi-headline compression — weekly roundups, not one calendar event. */
export function isRoundupMultiStorySummary(summary: string | null | undefined): boolean {
  const text = String(summary ?? "").trim();
  if (!text) return false;
  if (text.includes(";")) return true;
  const segments = text.split(/\s*,\s*(?=[A-Z])/).filter((part) => part.trim().length > 12);
  if (segments.length >= 3 && /\b(?:legalizes|builds|expands|announces|launches|approves|introduces|signs)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function isRoundupArticleContent(input: {
  title?: string | null;
  summary?: string | null;
  text?: string | null;
}): boolean {
  const title = String(input.title ?? "").trim();
  const corpus = `${title}\n${input.summary ?? ""}\n${String(input.text ?? "").slice(0, 1600)}`;
  if (/[;|]/.test(title)) {
    const parts = title.split(/[;|]/).map((part) => part.trim()).filter((part) => part.length > 10);
    if (parts.length >= 2) return true;
  }
  if (/\b(crypto|bitcoin|blockchain)\s+(news|stories|headlines|updates)\b.*\b(today|this week|daily|weekly)\b/i.test(corpus)) {
    return true;
  }
  if (/\b(daily|weekly|monthly)\s+(news|stories|headlines|updates|digest|roundup)\b/i.test(corpus)) {
    return true;
  }
  const semiSegments = corpus
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 16);
  if (semiSegments.length >= 2) return true;
  if (title.split(/\s+\/\s+/).filter((part) => part.trim().length > 10).length >= 3) return true;
  return false;
}

export function badWinnerOperatorNote(
  summary: string | null | undefined,
  topArticleId: string | null | undefined,
  articleContext?: { title?: string | null; snippet?: string | null } | null,
): string {
  if (
    isRoundupMultiStorySummary(summary) ||
    isRoundupArticleContent({
      title: articleContext?.title,
      summary,
      text: articleContext?.snippet,
    })
  ) {
    return "Roundup lists multiple stories — pick one dated article";
  }
  if (isBlogPaginationWinner(topArticleId)) return "Blog index page — pick a dated article";
  if (isGenericMarketingSummary(summary)) return "Marketing/blog blurb — pick a dated article";
  return "Current winner is not a single dated news event — pick a better article";
}

/**
 * Stricter than `isEditorialSummaryWeak` — returns the specific issue (if any)
 * so the summary-approval gate can show the operator a meaningful message.
 * Mirrors `QualityCheckerService.checkSummaryQuality` length bounds.
 */
export function evaluateSummaryQuality(summary: string | null | undefined): SummaryQualityIssue | null {
  if (summary == null || summary.trim() === "") {
    return { code: "empty", message: "Summary is empty." };
  }
  const t = summary.trim();
  for (const re of FAILURE_SUMMARY_PATTERNS) {
    if (re.test(t)) {
      return { code: "failure_placeholder", message: `Summary looks like a failure placeholder: "${t}".` };
    }
  }
  if (t.length < EDITORIAL_SUMMARY_TARGET_MIN) {
    return {
      code: "too_short",
      message: `Summary is too short (${t.length} chars; target ${EDITORIAL_SUMMARY_TARGET_MIN}–${EDITORIAL_SUMMARY_TARGET_MAX}).`,
    };
  }
  if (t.length > EDITORIAL_SUMMARY_TARGET_MAX) {
    return {
      code: "too_long",
      message: `Summary is too long (${t.length} chars; target ${EDITORIAL_SUMMARY_TARGET_MIN}–${EDITORIAL_SUMMARY_TARGET_MAX}).`,
    };
  }
  const symbol = summaryDisallowedSymbol(t);
  if (symbol) {
    return {
      code: "disallowed_symbols",
      message: `Summary contains disallowed symbol: ${symbol}.`,
    };
  }
  if (summaryHasTrailingPunctuation(t)) {
    return {
      code: "trailing_punctuation",
      message: "Summary must not end with a full stop or other ending punctuation.",
    };
  }
  const improperProperNouns = findImproperProperNouns(t);
  if (improperProperNouns.length > 0) {
    return {
      code: "improper_capitalization",
      message: `Capitalize proper names (${improperProperNouns.join(", ")}).`,
    };
  }
  if (isRoundupMultiStorySummary(t)) {
    return {
      code: "roundup_multi_story",
      message: "Summary compresses multiple stories (roundup) — pick one dated article and rewrite to one event.",
    };
  }
  return null;
}

/** Same rules as `POST /api/analysis/date/:date/redo-summary` and admin review `dayRedoSummaryAvailable`. */
export function isValidPipelineTopArticleId(id: string | null | undefined): boolean {
  const v = typeof id === "string" ? id.trim() : "";
  if (!v || v.toLowerCase() === "none") return false;
  if (v.includes("no-news-")) return false;
  // Accept canonical URL winners from historical rows.
  if (v.startsWith("http://") || v.startsWith("https://")) return true;
  // Accept pipeline/manual synthetic winners used by the editorial flow.
  if (v.startsWith("article-") || v.startsWith("manual-") || v.startsWith("known-")) return true;
  if (v.startsWith("pizza-milestone-")) return true;
  return false;
}

/** Summary uses a generic actor label instead of naming the organization. */
export function summaryUsesVagueActorLabel(summary: string): boolean {
  const text = summary.trim();
  if (!text) return false;
  const actor =
    /\b(?:firm|company|exchange|platform|startup|operator|provider|business)\b/i;
  if (!actor.test(text)) return false;
  return (
    /\b(?:a|an|the)\s+(?:u\.?\s?k\.?|u\.?\s?s\.?|uk|us|chinese|crypto|bitcoin)\s+(?:firm|company|exchange|platform|startup|operator|provider|business)\b/i.test(
      text,
    ) ||
    /\b(?:a|an|the)\s+(?:firm|company|exchange|platform|startup|operator|provider|business)\b/i.test(text) ||
    /\b(?:u\.?\s?k\.?|u\.?\s?s\.?|uk|us)\s+(?:firm|company|exchange|platform|startup|operator|provider|business)\b/i.test(
      text,
    )
  );
}

/** Article body/title names a specific organization the summary should probably include. */
export function articleSnippetNamesOrganization(snippet: string | null | undefined): boolean {
  const text = String(snippet ?? "").trim();
  if (text.length < 24) return false;
  return (
    /\b[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){1,}\s+(?:IP\s+)?Holdings\b/.test(text) ||
    /\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]+){1,4}\s+(?:Ltd|Limited|LLC|Inc|Holdings|PLC|Group|Bank)\b/.test(text)
  );
}

export function summaryOmitsNamedOrganization(
  summary: string,
  articleSnippet: string | null | undefined,
): boolean {
  return summaryUsesVagueActorLabel(summary) && articleSnippetNamesOrganization(articleSnippet);
}

/** Blog index / archive URLs are not valid winning articles for a dated timeline row. */
export function isBlogPaginationWinner(topArticleId: string | null | undefined): boolean {
  const url = String(topArticleId ?? "").trim().toLowerCase();
  if (!url.startsWith("http")) return false;
  return (
    /\/page\/\d+/.test(url) ||
    /\/tag\//.test(url) ||
    /\/category\//.test(url) ||
    /\/archive\/?$/.test(url) ||
    /\/blog\/?$/.test(url)
  );
}

/** Marketing/blog blurbs that describe features instead of a dated event. */
export function isGenericMarketingSummary(summary: string | null | undefined): boolean {
  const text = String(summary ?? "").trim().toLowerCase();
  if (text.length < 20) return false;
  return (
    /\bblog\b.*\b(offers?|updates?|features?|news)\b/.test(text) ||
    /\b(user verification|app features|simplified purchases|newsletter|subscribe)\b/.test(text) ||
    /\b(offers? updates on|provides updates on|updates on crypto news)\b/.test(text)
  );
}

export function summaryNeedsBetterArticleSource(
  summary: string | null | undefined,
  topArticleId: string | null | undefined,
  articleContext?: { title?: string | null; snippet?: string | null } | null,
): boolean {
  if (isGenericMarketingSummary(summary) || isBlogPaginationWinner(topArticleId)) return true;
  if (isRoundupMultiStorySummary(summary)) return true;
  if (
    isRoundupArticleContent({
      title: articleContext?.title,
      summary,
      text: articleContext?.snippet,
    })
  ) {
    return true;
  }
  return false;
}

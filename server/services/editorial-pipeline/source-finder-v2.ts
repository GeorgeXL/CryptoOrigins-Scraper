/**
 * Gated source discovery for the editorial pipeline.
 *
 * Unlike the legacy `SourceFinderAgent` path (which invokes the full
 * `newsAnalyzer.analyzeNewsForDate` monolith — search + scoring + summarization),
 * this fetch-only path returns a **ranked candidate pool** so the operator can
 * pick the winning article BEFORE any LLM summary is written.
 *
 * Calendar sanity is computed per candidate (published date proximity, plus
 * famous-milestone date checks) so the review UI can warn the operator about
 * "story belongs to a different date" cases up front.
 */

import { hierarchicalSearch } from "../hierarchical-search";
import type { ArticleData } from "@shared/schema";
import { detectCanonicalDateMismatch } from "./tools";
import type { ArticleCandidate } from "./review-package";
import { researchSignificantEventForDateWithGoogle } from "../homepage-checks/google-day-research";
import {
  isBlockedSourceUrl,
  isGenesisForumUrl,
  isRecognizedMediaUrl,
  normalizeHttpsUrl,
} from "../homepage-checks/perplexity-day-research";
import {
  canRecommendCandidate,
  candidateTopicRejectionReason,
  filterEligibleCandidates,
  GENESIS_EMPTY_POOL_NOTE,
  hasCryptoSignalText,
  isBlockedArticlePickUrl,
  isGenesisEraDate,
  isOffTopicJunkText,
} from "./article-pick-quality";

const MAX_CANDIDATES_PER_TIER = 8;
const MAX_TOTAL_CANDIDATES = 18;
const CALENDAR_PROXIMITY_WARNING_DAYS = 2;

/** Domain-specific keyword groups for the crypto/finance history corpus. */
const KEYWORD_GROUPS: Array<{ weight: number; words: string[] }> = [
  { weight: 0.25, words: ["bitcoin", "btc", "satoshi", "blockchain", "block "] },
  { weight: 0.18, words: ["ethereum", "eth ", "altcoin", "crypto", "stablecoin", "tether", "usdt", "usdc"] },
  { weight: 0.15, words: ["exchange", "binance", "coinbase", "kraken", "ftx", "mt. gox", "mtgox", "bitfinex"] },
  { weight: 0.12, words: ["mining", "miner", "hashrate", "halving", "halvening"] },
  { weight: 0.1, words: ["sec ", "regulator", "regulation", "etf", "court", "lawsuit", "indict", "sanction"] },
  { weight: 0.08, words: ["price", "market cap", "all-time high", "ath", "crash", "rally", "surge"] },
];

const TIER_WEIGHT: Record<"bitcoin" | "crypto" | "macro", number> = {
  bitcoin: 0.32,
  crypto: 0.22,
  macro: 0.12,
};

function parseYmd(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseLooseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isFinite(d.getTime()) ? d : null;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Action verbs that turn a headline into a "this happened on a date" signal.
 * Used to soften the discussion/explainer net: a question-style or generic
 * title is OK if it is paired with a concrete dated action (e.g. "Why
 * Mt. Gox filed for bankruptcy today" — "filed" rescues the "Why" prefix).
 */
const EVENT_ACTION_VERB_RE =
  /\b(announced?|launches?|launched|releases?|released|deploys?|deployed|files?|filed|sues?|sued|indicts?|indicted|sentenced|pleads?|pleaded|raises?|raised|acquires?|acquired|merges?|merged|approves?|approved|rejects?|rejected|halves?|halved|halts?|halted|hits?|hit|reaches?|reached|breaks?|broke|sets?|set|surges?|surged|crashes?|crashed|plunges?|plunged|tops?|topped|signs?|signed|listed|delists?|delisted|hacked|exploited|stolen|recovered|bans?|banned|seizes?|seized|patches?|patched|fixed)\b/;

export function evaluateCandidateStorySanity(input: {
  targetDate: string;
  title: string;
  summary: string;
  text: string;
}): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  const targetYear = Number(input.targetDate.slice(0, 4));
  const title = input.title.toLowerCase();
  const corpus = `${input.title}\n${input.summary}\n${input.text.slice(0, 1200)}`.toLowerCase();
  const titleHasActionVerb = EVENT_ACTION_VERB_RE.test(title);

  // 1. Evergreen / explainer prose
  if (/\b(how it works|why it matters|explained|wikipedia|glossary|learn|guide|start from scratch|what investors should know)\b/.test(corpus)) {
    notes.push("Looks like evergreen/background explainer, not a dated event");
  }
  // 2. History / retrospective / listicle frames
  if (/\b(history of bitcoin|bitcoin'?s history|defined bitcoin'?s history|timeline of bitcoin|moments that defined|things you should not miss|not miss in 20\d{2}|year in review|year-in-review|throwback|looking back|look back|retrospective|\d+\s+years? later|on this day in 20\d{2}|long read|deep dive|first lunch for bitcoin)\b/.test(corpus)) {
    notes.push("Looks like a history/retrospective/listicle, not an event from the target date");
  }
  // 2b. Multi-story / noisy anniversary headlines should not outrank a clean canonical story
  if (/\b(and more news|more news|top stories|hodlers? digest|weekly roundup|daily roundup|market wrap)\b/.test(corpus)) {
    notes.push("Multi-story roundup headline is weaker than a single dated event");
  }
  if (/[;|]/.test(input.title)) {
    const headlineParts = input.title.split(/[;|]/).map((part) => part.trim()).filter((part) => part.length > 10);
    if (headlineParts.length >= 2) {
      notes.push("Semicolon/pipe-separated headline lists multiple stories");
    }
  }
  const semiSummaryParts = `${input.summary}\n${input.text.slice(0, 900)}`
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 16);
  if (semiSummaryParts.length >= 2) {
    notes.push("Semicolon-separated body/summary lists multiple stories");
  }
  if (/\b\d+\s+years?\s+ago\b/.test(title) && /\b(tweet|shares?|coinbase|tradingview|market|price|analysts?)\b/.test(title)) {
    notes.push("Anniversary headline is mixed with a second story/noise");
  }
  // 3. Question-style title — but rescue if a concrete action verb is also present
  if (/^\s*(what|why|how|when|where|who|is|are|can|should|will|does|do|did)\b/.test(title) && !titleHasActionVerb) {
    notes.push("Question-style title with no concrete action verb — looks like discussion/explainer");
  }
  if (/^\s*(buy|sell|hold)\s+bitcoin\b/.test(title) || /\bimportant factors to consider\b/.test(title)) {
    notes.push("Advice/how-to framing is weaker than a dated event");
  }
  // 4. Numbered / ranked listicle titles (existing) + best/worst/top-N variants
  if (/^\s*\d+\s+(moments|things|events|stories|facts|lessons|reasons|ways|charts|tweets|takeaways|highlights|picks?)\b/.test(title)) {
    notes.push("Numbered listicle format is not a concrete dated event");
  }
  if (/^\s*(best|worst|top|biggest|greatest|favou?rite)\s+\d+/.test(title)) {
    notes.push("Best/worst/top-N ranking is not a concrete dated event");
  }
  // 5. Opinion / interview / Q&A / recap formats
  if (/^\s*(opinion|op[-\s]?ed|editorial|column|interview|q\s*&\s*a|q\s*and\s*a)\b\s*[:\-–—]?/.test(title)) {
    notes.push("Opinion / interview / Q&A format is not a dated event");
  }
  if (/^\s*(first mover|crypto biz)\b/.test(title)) {
    notes.push("Recurring house format is weaker than a single dated event");
  }
  if (/\b(weekly|monthly|daily)\s+(recap|wrap[-\s]?up|roundup|digest|newsletter)\b/.test(corpus)) {
    notes.push("Recap/roundup/newsletter format is not a single-day event");
  }
  // 6. General discussion/tutorial corpus signals
  if (/\b(all about|overview|introduction to|beginner'?s guide|primer|tutorial|newsletter|roundup|weekly|meeting notes|community discusses|discusses|discussion|questions about bitcoin|future of bitcoin|point of view|currency tool)\b/.test(corpus)) {
    notes.push("Discussion/roundup/tutorial format is not a concrete dated event");
  }
  // 7. Prediction / speculation / analyst targets
  if (/\b(prediction|predicts?|forecast|could surge|may surge|will make it|say analysts?|analysts say|speculation|speculate(d|s)?|price target|target price|projected to|estimated to|expected to (reach|hit|top|cross)|on track to (reach|hit|top|cross)|could (reach|hit|top|cross|touch)|might (reach|hit|top|cross|touch))\b/.test(corpus)) {
    notes.push("Prediction/speculation/price-target framing is weaker than an event that happened on the date");
  }
  // 8. Technical topic without a dated action
  if (/\btime locks?\b/.test(title) && !/\b(activated|released|merged|launched|deployed|approved)\b/.test(corpus)) {
    notes.push("Technical topic discussion lacks a concrete dated action");
  }
  // 8b. Explainer / statistics / experimentation titles are weaker than dated events
  if (/\b(experimenting with|bitcoin blockchain on aws|what you need to know|cryptocurrency 101|\b101\b|statistics|timing statistics|profitable|profitability|portfolio because|might affect your portfolio|payment system of tomorrow|coin profile and news|write for us guest post|guest post|what topics we support|unlimited free paypal money|free paypal money|paypal account)\b/.test(corpus) && !titleHasActionVerb) {
    notes.push("Explainer/statistics/experimentation format is weaker than a dated event");
  }
  if (/^\s*(the\s+)?bitcoin halving\s*$/.test(title) || /^\s*bitcoin\s*\(btc\)\s*price,?\s*chart,?\s*coin profile and news\s*$/.test(title)) {
    notes.push("Bare topic/profile headline is not a concrete dated event");
  }
  // 9. Recurring-process explainer (halving prose etc.)
  if (/\b(every four years|occurring every four years|began in 2012|process that began)\b/.test(corpus)) {
    notes.push("Explains a recurring process rather than something that happened on this date");
  }
  // 10. Wrong-year halving titles
  if (/\bbitcoin halving\s+20\d{2}\b/.test(title) && !title.includes(String(targetYear))) {
    notes.push(`Title points to a different halving year than ${targetYear}`);
  }

  // 11. Future-year mentions relative to target
  const yearMatches = Array.from(corpus.matchAll(/\b(20\d{2})\b/g))
    .map((m) => Number(m[1]))
    .filter((year) => Number.isFinite(year));
  const futureYears = [...new Set(yearMatches.filter((year) => year > targetYear))].sort();
  if (futureYears.length > 0) {
    notes.push(`Mentions future year(s) ${futureYears.slice(0, 3).join(", ")} relative to ${input.targetDate}`);
  }

  // 12. Off-topic junk that Exa sometimes returns for early dates
  if (isOffTopicJunkText(corpus)) {
    notes.push("Off-topic junk (philanthropy, pharma, clickbait, penny-stock, etc.)");
  }

  return { ok: notes.length === 0, notes };
}

function computeCalendarSanity(input: {
  targetDate: string;
  tier: "bitcoin" | "crypto" | "macro";
  candidateTitle: string;
  candidatePublishedDate: string | null | undefined;
  candidateText: string;
  candidateSummary: string;
  candidateUrl?: string;
}): { ok: boolean; offsetDays: number | null; notes: string[] } {
  const notes: string[] = [];
  const target = parseYmd(input.targetDate);
  const published = parseLooseDate(input.candidatePublishedDate ?? null);
  let offsetDays: number | null = null;
  if (target && published) {
    offsetDays = diffDays(published, target);
    if (Math.abs(offsetDays) > CALENDAR_PROXIMITY_WARNING_DAYS) {
      notes.push(
        `Article published ${Math.abs(offsetDays)} day(s) ${offsetDays > 0 ? "after" : "before"} target date`,
      );
    }
  } else if (target && !published) {
    notes.push("No published date on article");
  }

  const probe = [input.candidateTitle, input.candidateSummary, input.candidateText.slice(0, 600)]
    .filter(Boolean)
    .join(" \n ");
  const canonical = detectCanonicalDateMismatch(probe, input.targetDate);
  if (canonical) {
    notes.push(
      `Looks like ${canonical.ruleId} (canonical date ${canonical.expectedDate}): ${canonical.reason}`,
    );
  }
  const story = evaluateCandidateStorySanity({
    targetDate: input.targetDate,
    title: input.candidateTitle,
    summary: input.candidateSummary,
    text: input.candidateText,
  });
  notes.push(...story.notes);

  if (input.candidateUrl && isBlockedArticlePickUrl(input.candidateUrl)) {
    notes.push("Blocked low-quality or blog domain");
  }

  const topicReason = candidateTopicRejectionReason({
    title: input.candidateTitle,
    summary: input.candidateSummary,
    url: input.candidateUrl ?? "",
    tier: input.tier,
    date: input.targetDate,
  });
  if (topicReason) {
    notes.push(topicReason);
  }

  return { ok: notes.length === 0, offsetDays, notes };
}

function computeRelevance(input: {
  tier: "bitcoin" | "crypto" | "macro";
  rank: number;
  title: string;
  summary: string;
  text: string;
  offsetDays: number | null;
  calendarSanityOk: boolean;
}): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = TIER_WEIGHT[input.tier];
  notes.push(`tier=${input.tier} (+${TIER_WEIGHT[input.tier].toFixed(2)})`);

  // Rank decay within tier — top of tier gets the full weight.
  const rankDecay = Math.max(0, 0.15 - input.rank * 0.025);
  if (rankDecay > 0) {
    score += rankDecay;
    notes.push(`rank #${input.rank + 1} (+${rankDecay.toFixed(2)})`);
  }

  // Recency: closer to target date is better.
  if (input.offsetDays != null) {
    const abs = Math.abs(input.offsetDays);
    let recencyBoost = 0;
    if (abs === 0) recencyBoost = 0.18;
    else if (abs === 1) recencyBoost = 0.12;
    else if (abs <= 2) recencyBoost = 0.08;
    else if (abs <= 7) recencyBoost = 0.03;
    if (recencyBoost > 0) {
      score += recencyBoost;
      notes.push(`${abs}d from target (+${recencyBoost.toFixed(2)})`);
    }
  }

  // Domain keyword overlap on title + summary (cheap signal, no LLM).
  const corpus = `${input.title}\n${input.summary}\n${input.text.slice(0, 800)}`.toLowerCase();
  let kwBoost = 0;
  const hits: string[] = [];
  for (const group of KEYWORD_GROUPS) {
    if (group.words.some((w) => corpus.includes(w))) {
      kwBoost += group.weight;
      hits.push(group.words[0]);
    }
  }
  if (kwBoost === 0 && (input.tier === "bitcoin" || input.tier === "crypto")) {
    score -= 0.35;
    notes.push("no crypto keywords (-0.35)");
  }
  if (kwBoost > 0) {
    // Cap keyword contribution.
    kwBoost = Math.min(kwBoost, 0.45);
    score += kwBoost;
    notes.push(`keywords ${hits.slice(0, 3).join(", ")} (+${kwBoost.toFixed(2)})`);
  }

  if (/\b(epic tweet|tradingview news|more news|top stories|hodlers? digest|weekly roundup|daily roundup|market wrap)\b/.test(corpus)) {
    score -= 0.2;
    notes.push("noisy mixed-headline penalty (-0.20)");
  }

  // Penalty for calendar warnings.
  if (!input.calendarSanityOk) {
    score -= 0.55;
    notes.push("calendar/story warning (-0.55)");
  }

  // Clamp to [0, 1].
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return { score: Math.round(score * 1000) / 1000, notes };
}

function toCandidate(input: {
  article: ArticleData;
  tier: "bitcoin" | "crypto" | "macro";
  rank: number;
  targetDate: string;
}): ArticleCandidate {
  const sanity = computeCalendarSanity({
    targetDate: input.targetDate,
    tier: input.tier,
    candidateTitle: input.article.title ?? "",
    candidatePublishedDate: input.article.publishedDate,
    candidateText: typeof input.article.text === "string" ? input.article.text : "",
    candidateSummary: typeof input.article.summary === "string" ? input.article.summary : "",
    candidateUrl: input.article.url,
  });
  let host: string | undefined;
  try {
    host = new URL(input.article.url).hostname;
  } catch {
    host = undefined;
  }
  const relevance = computeRelevance({
    tier: input.tier,
    rank: input.rank,
    title: input.article.title ?? "",
    summary: typeof input.article.summary === "string" ? input.article.summary : "",
    text: typeof input.article.text === "string" ? input.article.text : "",
    offsetDays: sanity.offsetDays,
    calendarSanityOk: sanity.ok,
  });
  return {
    id: input.article.id,
    title: input.article.title ?? "Untitled",
    url: input.article.url,
    publishedDate: input.article.publishedDate ?? null,
    tier: input.tier,
    source: host,
    summary: input.article.summary ?? undefined,
    rank: input.rank,
    publishedDateOffsetDays: sanity.offsetDays,
    calendarSanityOk: sanity.ok,
    calendarSanityNotes: sanity.notes,
    relevanceScore: relevance.score,
    relevanceNotes: relevance.notes,
    recommended: false,
  };
}

function dedupeByUrl(candidates: ArticleCandidate[]): ArticleCandidate[] {
  const seen = new Set<string>();
  const out: ArticleCandidate[] = [];
  for (const c of candidates) {
    const key = c.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function hasCryptoSignal(candidate: ArticleCandidate): boolean {
  return hasCryptoSignalText(`${candidate.title} ${candidate.summary ?? ""}`);
}

function isCandidatePoolWeak(candidates: ArticleCandidate[], date: string): boolean {
  if (candidates.length === 0) return true;
  const sane = candidates.filter((candidate) => candidate.calendarSanityOk);
  if (sane.length === 0) return true;

  const topSane = [...sane].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))[0];
  if ((topSane?.relevanceScore ?? 0) < 0.42) return true;

  const year = Number(date.slice(0, 4));
  if (year < 2011 && !sane.some(hasCryptoSignal)) return true;

  return false;
}

function stableGoogleCandidateId(url: string): string {
  const slug = Buffer.from(url).toString("base64url").slice(0, 48);
  return `google:${slug}`;
}

function isAcceptableGoogleSourceUrl(url: string, date: string): boolean {
  if (isBlockedSourceUrl(url) || isBlockedArticlePickUrl(url)) return false;
  return isRecognizedMediaUrl(url) || isGenesisForumUrl(url, date);
}

function candidateFromGoogleUrl(input: {
  date: string;
  url: string;
  tier: "bitcoin" | "crypto" | "macro";
  title: string;
  summary: string;
  rank: number;
}): ArticleCandidate | null {
  const normalized = normalizeHttpsUrl(input.url);
  if (!normalized || !isAcceptableGoogleSourceUrl(normalized, input.date)) {
    return null;
  }

  const article: ArticleData = {
    id: stableGoogleCandidateId(normalized),
    title: input.title,
    url: normalized,
    publishedDate: input.date,
    author: undefined,
    text: input.summary,
    score: 0.9,
    summary: input.summary,
  };

  const candidate = toCandidate({
    article,
    tier: input.tier,
    rank: input.rank,
    targetDate: input.date,
  });
  candidate.relevanceNotes = ["added via Google Search fallback", ...(candidate.relevanceNotes ?? [])];
  return candidate;
}

async function enrichPoolWithGoogleResearch(
  date: string,
  candidates: ArticleCandidate[],
): Promise<ArticleCandidate[]> {
  try {
    const research = await researchSignificantEventForDateWithGoogle(date);
    if (!research.found || !research.tier) {
      return candidates;
    }

    const additions: ArticleCandidate[] = [];
    const urls = new Set<string>();
    if (research.sourceUrl) urls.add(research.sourceUrl);
    for (const citation of research.citations) {
      if (citation) urls.add(citation);
    }

    let rank = 0;
    for (const url of urls) {
      const candidate = candidateFromGoogleUrl({
        date,
        url,
        tier: research.tier,
        title: research.eventTitle || research.sourceTitle || "Google Search result",
        summary: research.eventSnippet || research.reasoning || "",
        rank,
      });
      rank += 1;
      if (candidate) additions.push(candidate);
    }

    if (additions.length === 0) return candidates;
    return dedupeByUrl([...additions, ...candidates]).slice(0, MAX_TOTAL_CANDIDATES);
  } catch (error) {
    console.warn(`[source-finder-v2] Google research fallback failed for ${date}:`, error);
    return candidates;
  }
}

function assignRecommendedCandidate(candidates: ArticleCandidate[], date: string): void {
  for (const candidate of candidates) {
    candidate.recommended = false;
  }
  const recommended =
    [...candidates]
      .filter((candidate) => canRecommendCandidate(candidate, date))
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))[0] ?? null;
  if (!recommended) return;
  recommended.recommended = true;
  if (recommended.relevanceNotes) {
    recommended.relevanceNotes = [
      "recommended (highest score with date sanity)",
      ...recommended.relevanceNotes,
    ];
  }
}

function sortCandidates(candidates: ArticleCandidate[]): void {
  candidates.sort((a, b) => {
    const sa = a.relevanceScore ?? 0;
    const sb = b.relevanceScore ?? 0;
    if (sb !== sa) return sb - sa;
    const ta = TIER_WEIGHT[a.tier];
    const tb = TIER_WEIGHT[b.tier];
    if (tb !== ta) return tb - ta;
    return a.rank - b.rank;
  });
}

export type CandidatePoolForDate = {
  date: string;
  candidates: ArticleCandidate[];
  perTierCounts: { bitcoin: number; crypto: number; macro: number };
  /** True iff the candidate pool is non-empty. */
  hasCandidates: boolean;
  /** Operator note when the pool is empty or filtered down intentionally. */
  poolNote?: string;
};

export async function fetchCandidatesForDate(
  date: string,
  requestContext: { requestId: string; source: string },
): Promise<CandidatePoolForDate> {
  const [bitcoin, crypto, macro] = await Promise.all([
    hierarchicalSearch.searchBitcoinTier(date, requestContext),
    hierarchicalSearch.searchCryptoTier(date, requestContext),
    hierarchicalSearch.searchMacroTier(date, requestContext),
  ]);

  const candidates: ArticleCandidate[] = [];
  bitcoin.slice(0, MAX_CANDIDATES_PER_TIER).forEach((a, i) =>
    candidates.push(toCandidate({ article: a, tier: "bitcoin", rank: i, targetDate: date })),
  );
  crypto.slice(0, MAX_CANDIDATES_PER_TIER).forEach((a, i) =>
    candidates.push(toCandidate({ article: a, tier: "crypto", rank: i, targetDate: date })),
  );
  macro.slice(0, MAX_CANDIDATES_PER_TIER).forEach((a, i) =>
    candidates.push(toCandidate({ article: a, tier: "macro", rank: i, targetDate: date })),
  );

  const unique = dedupeByUrl(candidates).slice(0, MAX_TOTAL_CANDIDATES);
  sortCandidates(unique);

  let finalCandidates = unique;
  if (isCandidatePoolWeak(unique, date)) {
    finalCandidates = await enrichPoolWithGoogleResearch(date, unique);
    sortCandidates(finalCandidates);
  }

  finalCandidates = filterEligibleCandidates(finalCandidates, date);

  let poolNote: string | undefined;
  if (isGenesisEraDate(date) && !finalCandidates.some(hasCryptoSignal)) {
    finalCandidates = [];
    poolNote = GENESIS_EMPTY_POOL_NOTE;
  }

  assignRecommendedCandidate(finalCandidates, date);

  return {
    date,
    candidates: finalCandidates,
    perTierCounts: {
      bitcoin: bitcoin.length,
      crypto: crypto.length,
      macro: macro.length,
    },
    hasCandidates: finalCandidates.length > 0,
    poolNote,
  };
}

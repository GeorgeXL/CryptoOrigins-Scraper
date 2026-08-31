/**
 * Shared quality gates for article-pick candidate pools (Exa fetch + review UI).
 */

import type { ArticleData } from "@shared/schema";
import { isRecognizedMediaUrl } from "../homepage-checks/perplexity-day-research";

export type ArticlePickTier = "bitcoin" | "crypto" | "macro";

/** Blogs, penny-stock wires, and other domains that should never enter the pick pool. */
export const BLOCKED_ARTICLE_PICK_HOSTS = [
  "dailybail.com",
  "proactiveinvestors.com",
  "proactiveinvestors.co.uk",
  "philanthropy.com",
  "chronicleofphilanthropy.com",
  "prnewswire.com",
  "globenewswire.com",
  "accesswire.com",
  "benzinga.com",
  "motleyfool.com",
  "seekingalpha.com",
  "zacks.com",
  "investorplace.com",
  "thestreet.com",
  "bizjournals.com",
  "medium.com",
  "substack.com",
  "wordpress.com",
  "blogspot.com",
  "tumblr.com",
];

const CRYPTO_SIGNAL_RE =
  /\b(bitcoin|btc|satoshi|nakamoto|blockchain|cryptocurrency|crypto|ethereum|eth\b|litecoin|digital currency|peer[- ]to[- ]peer electronic cash|bitcointalk|genesis block|mining pool|halving)\b/i;

const MACRO_SIGNAL_RE =
  /\b(federal reserve|fed\b|central bank|interest rate|bailout|stimulus|treasury|sec\b|inflation|gdp|recession|bank failure|bankruptcy|stock market|dow jones|s&p|nasdaq|wall street|mortgage|subprime|financial crisis|ecb|boe|boj)\b/i;

const OFF_TOPIC_JUNK_RE =
  /\b(philanthrop|charitab|nonprofit|phase \d trial|clinical trial|thrombo|biotech patent|asx:|nasdaq:|otc:|penny stock|will make you smile|who'?s the idiot|gerbil|clickbait|guest post|write for us|social innovation)\b/i;

const CLICKBAIT_RE =
  /\b(will make you smile|who'?s the idiot|you won'?t believe|shocking|mind[- ]blowing)\b/i;

export function articlePickHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isBlockedArticlePickUrl(url: string): boolean {
  const host = articlePickHost(url);
  if (!host) return true;
  return BLOCKED_ARTICLE_PICK_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

export function articleCorpus(article: {
  title?: string | null;
  summary?: string | null;
  text?: string | null;
}): string {
  return `${article.title ?? ""}\n${article.summary ?? ""}\n${(article.text ?? "").slice(0, 1200)}`;
}

export function hasCryptoSignalText(corpus: string): boolean {
  return CRYPTO_SIGNAL_RE.test(corpus);
}

export function hasMacroSignalText(corpus: string): boolean {
  return MACRO_SIGNAL_RE.test(corpus);
}

export function isOffTopicJunkText(corpus: string): boolean {
  return OFF_TOPIC_JUNK_RE.test(corpus) || CLICKBAIT_RE.test(corpus);
}

export function isGenesisEraDate(date: string): boolean {
  return Number(date.slice(0, 4)) < 2011;
}

/**
 * Hard gate for Exa results before they become candidates.
 * Returns null reason when accepted, or a rejection reason string.
 */
export function exaArticleRejectionReason(
  article: ArticleData,
  tier: ArticlePickTier,
  date: string,
): string | null {
  if (!article.url?.trim()) return "missing URL";

  if (isBlockedArticlePickUrl(article.url)) {
    return "blocked low-quality or blog domain";
  }

  const corpus = articleCorpus(article);

  if (isOffTopicJunkText(corpus)) {
    return "off-topic junk (philanthropy, pharma, clickbait, etc.)";
  }

  if (tier === "bitcoin" || tier === "crypto") {
    if (!hasCryptoSignalText(corpus)) {
      return "no Bitcoin/crypto topic in article";
    }
    return null;
  }

  // Macro tier
  if (!hasMacroSignalText(corpus)) {
    return "no major macro/financial topic in article";
  }

  if (isGenesisEraDate(date) && !isRecognizedMediaUrl(article.url)) {
    return "genesis-era macro requires recognised wire/outlet domain";
  }

  return null;
}

export function filterExaArticlesForTier(
  articles: ArticleData[],
  tier: ArticlePickTier,
  date: string,
): ArticleData[] {
  const kept: ArticleData[] = [];
  let dropped = 0;

  for (const article of articles) {
    const reason = exaArticleRejectionReason(article, tier, date);
    if (reason) {
      dropped += 1;
      continue;
    }
    kept.push(article);
  }

  if (dropped > 0) {
    console.log(`🔎 ${tier} tier: kept ${kept.length}, filtered ${dropped} off-topic/blocked for ${date}`);
  }

  return kept;
}

export function candidateTopicRejectionReason(input: {
  title: string;
  summary?: string;
  url: string;
  tier: ArticlePickTier;
  date: string;
}): string | null {
  if (isBlockedArticlePickUrl(input.url)) {
    return "Blocked low-quality or blog domain";
  }

  const corpus = `${input.title}\n${input.summary ?? ""}`;

  if (isOffTopicJunkText(corpus)) {
    return "Off-topic junk (philanthropy, pharma, clickbait, etc.)";
  }

  if (input.tier === "bitcoin" || input.tier === "crypto") {
    if (!hasCryptoSignalText(corpus)) {
      return "No Bitcoin/crypto topic in article (tier badge = search bucket only)";
    }
    return null;
  }

  if (!hasMacroSignalText(corpus)) {
    return "No major macro/financial topic in article";
  }

  if (isGenesisEraDate(input.date) && !isRecognizedMediaUrl(input.url)) {
    return "Genesis-era macro requires recognised wire/outlet domain";
  }

  return null;
}

export function filterEligibleCandidates<T extends { title: string; summary?: string; url: string; tier: ArticlePickTier }>(
  candidates: T[],
  date: string,
): T[] {
  return candidates.filter(
    (candidate) =>
      !candidateTopicRejectionReason({
        title: candidate.title,
        summary: candidate.summary,
        url: candidate.url,
        tier: candidate.tier,
        date,
      }),
  );
}

export function canRecommendCandidate(candidate: {
  title: string;
  summary?: string;
  url: string;
  tier: ArticlePickTier;
  calendarSanityOk: boolean;
}, date: string): boolean {
  if (!candidate.calendarSanityOk) return false;
  if (candidateTopicRejectionReason({
    title: candidate.title,
    summary: candidate.summary,
    url: candidate.url,
    tier: candidate.tier,
    date,
  })) {
    return false;
  }
  if (isGenesisEraDate(date) && !hasCryptoSignalText(`${candidate.title} ${candidate.summary ?? ""}`)) {
    // Genesis days: only recommend crypto-tagged stories (macro alone is not auto-recommended).
    return false;
  }
  return true;
}

export const GENESIS_EMPTY_POOL_NOTE =
  "No Bitcoin/crypto candidates found for this early date. Confirm the day is empty, or reject and add a source manually on the day page.";

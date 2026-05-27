import { and, count, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "../../db";
import { canonicalMilestones, historicalNewsAnalyses, pagesAndTags } from "@shared/schema";
import { NewsAnalyzerService } from "../news-analyzer";

const newsAnalyzer = new NewsAnalyzerService();

const DUPLICATE_SUMMARY_PREVIEW = 420;

const TAG_ALIASES = new Map<string, string>([
  ["btc", "bitcoin"],
  ["eth", "ethereum"],
  ["fed", "federal reserve"],
  ["lightning network", "lightning"],
  ["c-lightning", "lightning"],
  ["bitcoin price", "bitcoin"],
  ["bitcoin core", "bitcoin core"],
  ["u.s.", "united states"],
  ["u.s", "united states"],
  ["us", "united states"],
  ["usa", "united states"],
  ["web 2", "web2"],
  ["web2", "web2"],
  ["web2.0", "web2"],
  ["web 2.0", "web2"],
  ["web-2", "web2"],
  ["web-2.0", "web2"],
  ["web 3", "web3"],
  ["web3", "web3"],
  ["web3.0", "web3"],
  ["web 3.0", "web3"],
  ["web-3", "web3"],
  ["web-3.0", "web3"],
  ["decentralized finance", "defi"],
  ["defi", "defi"],
]);

const ABSTRACT_TAG_VALUES = new Set([
  "adoption",
  "america",
  "american",
  "mining",
  "hashrate",
  "difficulty",
  "regulation",
  "compliance",
  "market",
  "markets",
  "concern",
  "concerns",
  "job concerns",
  "bailout",
  "bank",
  "banks",
  "central bank",
  "chancellor",
  "chinese",
  "congress",
  "investment bank",
  "investment banks",
  "europe",
  "european",
  "financial crisis",
  "financial hub",
  "government",
  "interest rates",
  "job",
  "technology",
  "blockchain",
  "blockchains",
  "business",
  "ceo",
  "casino",
  "casinos",
  "core",
  "crypto market",
  "crypto markets",
  "dentist",
  "dollar",
  "foundation",
  "gold",
  "gold-backed assets",
  "japan's",
  "jobs",
  "oil",
  "pizza",
  "pound",
  "pounds",
  "pound sterling",
  "real estate",
  "regulations",
  "president",
  "senate",
  "security",
  "singapore dollar",
  "transaction",
  "transactions",
  "usd",
  "unemployment",
  "wave",
]);

const ABSTRACT_TAG_PHRASE_PATTERNS: RegExp[] = [
  /^(bitcoin|btc)\s+price$/,
  /^(bitcoin|btc)\s+market$/,
  /^(crypto|cryptocurrency)\s+market$/,
  /^(market|investor)\s+confidence$/,
  /^(trading|market)\s+activity$/,
];

const TOPIC_ALIASES = new Map<string, string>([
  ["tech", "technology"],
  ["technologies", "technology"],
  ["markets", "market"],
]);

type CanonicalDateRule = {
  id: string;
  expectedDate: string;
  requiredMatches: number;
  patterns: RegExp[];
  reason: string;
};

const CANONICAL_DATE_RULES: CanonicalDateRule[] = [
  {
    id: "bitcoin-pizza-day",
    expectedDate: "2010-05-22",
    requiredMatches: 3,
    patterns: [/pizza/i, /10,?000/i, /laszlo/i, /hanyecz/i, /\bbitcoin\b/i, /\bbtc\b/i],
    reason: "Bitcoin Pizza Day is the May 22, 2010 purchase of two pizzas for 10,000 BTC.",
  },
];

function addCalendarDays(isoDate: string, deltaDays: number): string {
  const t = new Date(`${isoDate}T12:00:00.000Z`).getTime() + deltaDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Normalized tags_version2 entries for overlap / dedupe (lowercase, trimmed). */
export function normalizedTagsFromRow(tagsVersion2: unknown): string[] {
  if (!Array.isArray(tagsVersion2)) return [];
  const out = tagsVersion2
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => normalizeTagValue(x));
  return [...new Set(out)].filter(Boolean);
}

/** Topic labels from `topic_categories` json (strings or `{ name }` objects). */
export function topicLabelsFromRow(topicCategories: unknown): string[] {
  if (!Array.isArray(topicCategories)) return [];
  const out: string[] = [];
  for (const x of topicCategories) {
    if (typeof x === "string" && x.trim()) {
      out.push(normalizeTopicValue(x));
    } else if (x && typeof x === "object" && "name" in x) {
      const n = (x as { name?: unknown }).name;
      if (typeof n === "string" && n.trim()) out.push(normalizeTopicValue(n));
    }
  }
  return [...new Set(out)].filter(Boolean);
}

export function normalizeTagValue(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return "";
  if (/^(one|two|three|four|five|six|seven|eight|nine|ten|several|many|multiple|various)\b/.test(cleaned)) {
    return "";
  }
  if (ABSTRACT_TAG_VALUES.has(cleaned)) return "";
  if (ABSTRACT_TAG_PHRASE_PATTERNS.some((pattern) => pattern.test(cleaned))) return "";
  return TAG_ALIASES.get(cleaned) ?? cleaned;
}

export function normalizeTopicValue(raw: string): string {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return "";
  return TOPIC_ALIASES.get(cleaned) ?? cleaned;
}

export function normalizeTagList(tags: string[]): string[] {
  return [...new Set(tags.map((t) => normalizeTagValue(t)).filter(Boolean))];
}

export function normalizeTopicList(topics: string[]): string[] {
  return [...new Set(topics.map((t) => normalizeTopicValue(t)).filter(Boolean))];
}

function summaryTokenSet(summary: string): Set<string> {
  return new Set(
    summary
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length > 2)
  );
}

/** Jaccard similarity on word tokens (length > 2), for near-duplicate summaries. */
export function summaryTokenJaccardForDuplicateCheck(a: string, b: string): number {
  const sa = summaryTokenSet(a);
  const sb = summaryTokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) {
    if (sb.has(x)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union ? inter / union : 0;
}

export type TaxonomyDuplicateNeighbor = {
  date: string;
  summaryPreview: string;
  sharedTags: string[];
  sharedTopics: string[];
  tokenJaccard: number;
};

export type TagConsistencyIssue = {
  type: "conflict" | "mismatch";
  message: string;
  tags?: string[];
};

export function evaluateTagConsistency(input: {
  summary: string;
  tags: string[];
  topics: string[];
}): { normalizedTags: string[]; normalizedTopics: string[]; issues: TagConsistencyIssue[] } {
  const normalizedTags = normalizeTagList(input.tags);
  const normalizedTopics = normalizeTopicList(input.topics);
  const issues: TagConsistencyIssue[] = [];

  const hasWeb2 = normalizedTags.includes("web2");
  const hasWeb3 = normalizedTags.includes("web3");
  if (hasWeb2 && hasWeb3) {
    issues.push({
      type: "conflict",
      message: "Both Web2 and Web3 tags present; pick one.",
      tags: ["web2", "web3"],
    });
  }

  const summaryLower = input.summary.toLowerCase();
  if (hasWeb2 && summaryLower.includes("web3") && !summaryLower.includes("web2")) {
    issues.push({
      type: "mismatch",
      message: "Summary mentions Web3 but tags include Web2.",
      tags: ["web2"],
    });
  }
  if (hasWeb3 && summaryLower.includes("web2") && !summaryLower.includes("web3")) {
    issues.push({
      type: "mismatch",
      message: "Summary mentions Web2 but tags include Web3.",
      tags: ["web3"],
    });
  }

  return { normalizedTags, normalizedTopics, issues };
}

export function detectCanonicalDateMismatch(summary: string, date: string): {
  expectedDate: string;
  ruleId: string;
  reason: string;
} | null {
  const text = summary.toLowerCase();
  for (const rule of CANONICAL_DATE_RULES) {
    let matches = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) matches += 1;
    }
    if (matches >= rule.requiredMatches && date !== rule.expectedDate) {
      return {
        expectedDate: rule.expectedDate,
        ruleId: rule.id,
        reason: rule.reason,
      };
    }
  }
  return null;
}

export type CanonicalDateHint = {
  date: string;
  reason: string;
  source: "pizza_day";
};

export function getCanonicalDateHint(summary: string): CanonicalDateHint | null {
  const s = summary.toLowerCase();
  const mentionsPizza =
    s.includes("pizza") && (s.includes("10,000") || s.includes("10000") || s.includes("ten thousand"));
  const mentionsBitcoin = s.includes("bitcoin") || s.includes("btc");
  if (mentionsPizza && mentionsBitcoin) {
    return {
      date: "2010-05-22",
      reason: "Bitcoin Pizza Day is May 22, 2010 (10,000 BTC pizza purchase).",
      source: "pizza_day",
    };
  }
  return null;
}

/**
 * Other days in a calendar window that share tags and/or topic labels with the focal row,
 * ranked by taxonomy overlap and summary token similarity. No article bodies — only row metadata.
 */
export async function getEditorialDuplicateNeighborContext(args: {
  date: string;
  analysisId: string;
  windowDays?: number;
  maxNeighbors?: number;
}): Promise<{
  focalTags: string[];
  focalTopics: string[];
  focalSummaryPreview: string;
  neighbors: TaxonomyDuplicateNeighbor[];
} | null> {
  const windowDays = Math.min(120, Math.max(14, args.windowDays ?? 56));
  const maxNeighbors = Math.min(20, Math.max(4, args.maxNeighbors ?? 12));

  const [focal] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, args.date))
    .limit(1);

  if (!focal || focal.id !== args.analysisId) return null;

  const focalSummary = String(focal.summary ?? "").trim();
  const focalTags = normalizedTagsFromRow(focal.tagsVersion2);
  const focalTopics = topicLabelsFromRow(focal.topicCategories);

  const from = addCalendarDays(args.date, -windowDays);
  const to = addCalendarDays(args.date, windowDays);

  const rows = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
    })
    .from(historicalNewsAnalyses)
    .where(
      and(
        ne(historicalNewsAnalyses.id, args.analysisId),
        gte(historicalNewsAnalyses.date, from),
        lte(historicalNewsAnalyses.date, to)
      )
    );

  const focalTagSet = new Set(focalTags);
  const focalTopicSet = new Set(focalTopics);

  const scored: TaxonomyDuplicateNeighbor[] = [];

  for (const row of rows) {
    const nTags = normalizedTagsFromRow(row.tagsVersion2);
    const nTopics = topicLabelsFromRow(row.topicCategories);
    const sharedTags = nTags.filter((t) => focalTagSet.has(t));
    const sharedTopics = nTopics.filter((t) => focalTopicSet.has(t));
    const nSum = String(row.summary ?? "").trim();
    const j = summaryTokenJaccardForDuplicateCheck(focalSummary, nSum);

    const taxonomyHits = sharedTags.length + sharedTopics.length;
    if (taxonomyHits === 0 && j < 0.18) continue;

    scored.push({
      date: row.date,
      summaryPreview: nSum.slice(0, DUPLICATE_SUMMARY_PREVIEW),
      sharedTags,
      sharedTopics,
      tokenJaccard: Math.round(j * 1000) / 1000,
    });
  }

  scored.sort((a, b) => {
    const score = (n: TaxonomyDuplicateNeighbor) =>
      n.sharedTags.length * 4 + n.sharedTopics.length * 3 + n.tokenJaccard * 2.5;
    return score(b) - score(a);
  });

  return {
    focalTags,
    focalTopics,
    focalSummaryPreview: focalSummary.slice(0, DUPLICATE_SUMMARY_PREVIEW),
    neighbors: scored.slice(0, maxNeighbors),
  };
}

export type ExistingDay = {
  id: string;
  date: string;
  summary: string;
  topArticleId: string | null;
  isFlagged: boolean | null;
  isOrphan: boolean | null;
  confidenceScore: string | null;
};

export async function getExistingDay(date: string): Promise<ExistingDay | null> {
  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      isFlagged: historicalNewsAnalyses.isFlagged,
      isOrphan: historicalNewsAnalyses.isOrphan,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  return row ?? null;
}

export type DayTaxonomyRow = {
  id: string;
  date: string;
  summary: string;
  tagsVersion2: string[] | null;
  topicCategories: unknown;
  tags: unknown;
  articleTags: unknown;
};

export async function getDayTaxonomy(date: string): Promise<DayTaxonomyRow | null> {
  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      tags: historicalNewsAnalyses.tags,
      articleTags: historicalNewsAnalyses.articleTags,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  return row ?? null;
}

/** Tag / topic coverage for triage and tag-manager steps (does not mutate). */
export async function getTagCoverageForDate(date: string): Promise<{
  analysisId: string;
  tagsVersion2Count: number;
  topicCategoriesCount: number;
  legacyTagsCount: number;
  pagesAndTagsCount: number;
} | null> {
  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      tags: historicalNewsAnalyses.tags,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  if (!row) return null;

  const v2 =
    Array.isArray(row.tagsVersion2) ?
      row.tagsVersion2.filter((x) => typeof x === "string" && x.trim().length > 0).length
    : 0;
  const tc = Array.isArray(row.topicCategories) ? row.topicCategories.length : 0;
  const legacy = Array.isArray(row.tags) ? row.tags.length : 0;

  const [cntRow] = await db
    .select({ n: count() })
    .from(pagesAndTags)
    .where(eq(pagesAndTags.analysisId, row.id));

  return {
    analysisId: row.id,
    tagsVersion2Count: v2,
    topicCategoriesCount: tc,
    legacyTagsCount: legacy,
    pagesAndTagsCount: Number(cntRow?.n ?? 0),
  };
}

export async function listCanonicalMilestonesInRange(dateFrom: string, dateTo: string) {
  return db
    .select()
    .from(canonicalMilestones)
    .where(and(eq(canonicalMilestones.category, "bitcoin-history")));
}

// Wrapper around existing mature search/analyze pipeline (preserved path).
export async function runExistingSearchAndSummaryForDate(date: string): Promise<{
  summary: string;
  confidenceScore: number;
  totalArticlesFetched: number;
}> {
  const out = await newsAnalyzer.analyzeNewsForDate({
    date,
    forceReanalysis: true,
    aiProvider: "openai",
    requestContext: { source: "editorial-pipeline-v2", requestId: `pipeline-${date}-${Date.now()}` },
  });
  return {
    summary: out.summary,
    confidenceScore: out.confidenceScore,
    totalArticlesFetched: out.totalArticlesFetched,
  };
}

// Lightweight wrapper for existing verification metadata already stored on day rows.
export async function getExistingVerificationSignals(date: string) {
  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      geminiApproved: historicalNewsAnalyses.geminiApproved,
      perplexityApproved: historicalNewsAnalyses.perplexityApproved,
      factCheckVerdict: historicalNewsAnalyses.factCheckVerdict,
      factCheckConfidence: historicalNewsAnalyses.factCheckConfidence,
      perplexityVerdict: historicalNewsAnalyses.perplexityVerdict,
      perplexityConfidence: historicalNewsAnalyses.perplexityConfidence,
      perplexityCitations: historicalNewsAnalyses.perplexityCitations,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  return row ?? null;
}

import type { ArticleData, TieredArticles } from "./schema";
import { TOPIC_HIERARCHY_LEAVES, TOPIC_HIERARCHY_ROOTS } from "./topic-hierarchy";

const BROAD_PLACEHOLDER_TOPICS = new Set([
  "historical",
  "bitcoin",
  "market",
  "markets",
  "mining",
  "company",
  "companies",
  "adoption",
  "economic",
  "economics",
  "finance",
  "political",
  "policy",
  "technology",
  "tech",
  "investment",
  "institutional",
  "industry-news",
  "regulation",
  "security",
  "topics",
]);

const VALID_TOPIC_LEAF_KEYS = new Set(
  TOPIC_HIERARCHY_LEAVES.map((topic) => topic.trim().toLowerCase()),
);
const ROOT_TOPIC_KEYS = new Set(TOPIC_HIERARCHY_ROOTS.map((topic) => topic.trim().toLowerCase()));

export function invalidTopicReasonsForManualEntry(currentTopics: string[]): string[] {
  const normalizedCurrent = [
    ...new Set(currentTopics.map((topic) => topic.trim().toLowerCase()).filter(Boolean)),
  ];
  const reasons: string[] = [];
  if (normalizedCurrent.length === 0) reasons.push("No topic assigned");
  if (normalizedCurrent.length > 1) reasons.push("More than one topic assigned");
  if (
    normalizedCurrent.some(
      (topic) => BROAD_PLACEHOLDER_TOPICS.has(topic) || ROOT_TOPIC_KEYS.has(topic),
    )
  ) {
    reasons.push("Old broad topic assigned");
  }
  if (normalizedCurrent.some((topic) => !VALID_TOPIC_LEAF_KEYS.has(topic))) {
    reasons.push("Topic is not in the current hierarchy");
  }
  return reasons;
}

export function normalizeManualSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Source URL is required");
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Invalid source URL");
  }
  if (!parsed.hostname) {
    throw new Error("Invalid source URL");
  }
  return parsed.toString();
}

export function buildManualArticle(opts: {
  date: string;
  sourceUrl: string;
  summary: string;
  title?: string;
}): ArticleData {
  let title = opts.title?.trim() || "";
  if (!title) {
    try {
      title = new URL(opts.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      title = "Manual source";
    }
  }

  return {
    id: opts.sourceUrl,
    title,
    url: opts.sourceUrl,
    publishedDate: opts.date,
    text: opts.summary,
    summary: opts.summary,
  };
}

export type ManualAnalysisDbRow = {
  date: string;
  summary: string;
  top_article_id: string;
  is_manual_override: boolean;
  is_orphan: boolean;
  ai_provider: string;
  reasoning: string;
  confidence_score: string;
  winning_tier: string;
  tier_used: string;
  tiered_articles: TieredArticles;
  analyzed_articles: ArticleData[];
  total_articles_fetched: number;
  unique_articles_analyzed: number;
  topic_categories: string[];
  gemini_approved: boolean;
  perplexity_approved: boolean;
  tags_version2: string[];
};

export function buildManualAnalysisDbRow(opts: {
  date: string;
  summary: string;
  sourceUrl: string;
  topicCategories: string[];
  manualArticle: ArticleData;
  tagsVersion2?: string[];
}): ManualAnalysisDbRow {
  const tieredArticles: TieredArticles = {
    bitcoin: [opts.manualArticle],
    crypto: [],
    macro: [],
  };

  return {
    date: opts.date,
    summary: opts.summary,
    top_article_id: opts.sourceUrl,
    is_manual_override: true,
    is_orphan: false,
    ai_provider: "manual",
    reasoning: "Manual entry with operator-provided source URL",
    confidence_score: "100",
    winning_tier: "bitcoin",
    tier_used: "manual",
    tiered_articles: tieredArticles,
    analyzed_articles: [opts.manualArticle],
    total_articles_fetched: 1,
    unique_articles_analyzed: 1,
    topic_categories: opts.topicCategories,
    gemini_approved: false,
    perplexity_approved: false,
    tags_version2: opts.tagsVersion2 ?? [],
  };
}

export function validateManualDayEntryInputs(opts: {
  date: string;
  summary: string;
  topic: string | null;
}): { summary: string; topicLabel: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const summary = opts.summary.trim();
  if (summary.length < 20) {
    throw new Error("Summary must be at least 20 characters");
  }

  const topicLabel = typeof opts.topic === "string" ? opts.topic.trim() : "";
  if (!topicLabel) {
    throw new Error("Storyline tag is required for manual entry");
  }

  const canonical = new Set(TOPIC_HIERARCHY_LEAVES.map((leaf) => leaf.trim().toLowerCase()));
  if (!canonical.has(topicLabel.toLowerCase())) {
    throw new Error(`"${topicLabel}" is not a valid hierarchy topic`);
  }

  const issues = invalidTopicReasonsForManualEntry([topicLabel]);
  if (issues.length > 0) {
    throw new Error(`Topic rejected: ${issues.join("; ")}`);
  }

  return { summary, topicLabel };
}

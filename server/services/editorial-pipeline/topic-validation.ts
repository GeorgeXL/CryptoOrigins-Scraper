import { TOPIC_HIERARCHY_LEAVES, TOPIC_HIERARCHY_ROOTS } from "@shared/topic-hierarchy";
import { normalizeTopicList, normalizeTopicValue } from "./tools";

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

const VALID_TOPIC_LEAF_KEYS = new Set(TOPIC_HIERARCHY_LEAVES.map((topic) => normalizeTopicValue(topic)));
const ROOT_TOPIC_KEYS = new Set(TOPIC_HIERARCHY_ROOTS.map((topic) => normalizeTopicValue(topic)));

export function invalidTopicReasons(currentTopics: string[]): string[] {
  const normalizedCurrent = normalizeTopicList(currentTopics);
  const reasons: string[] = [];
  if (normalizedCurrent.length === 0) reasons.push("No topic assigned");
  if (normalizedCurrent.length > 1) reasons.push("More than one topic assigned");
  if (normalizedCurrent.some((topic) => BROAD_PLACEHOLDER_TOPICS.has(topic) || ROOT_TOPIC_KEYS.has(topic))) {
    reasons.push("Old broad topic assigned");
  }
  if (normalizedCurrent.some((topic) => !VALID_TOPIC_LEAF_KEYS.has(topic))) {
    reasons.push("Topic is not in the current hierarchy");
  }
  return reasons;
}

export function evaluateTopicHierarchy(currentTopics: string[]): {
  normalizedTopics: string[];
  issues: string[];
} {
  const normalizedTopics = normalizeTopicList(currentTopics);
  return { normalizedTopics, issues: invalidTopicReasons(currentTopics) };
}

export function hasValidSingleHierarchyTopic(currentTopics: string[]): boolean {
  return invalidTopicReasons(currentTopics).length === 0;
}

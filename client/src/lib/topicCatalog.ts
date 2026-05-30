import type { CategoryData } from "@/components/TagsSidebar";
import { TOPIC_HIERARCHY } from "@shared/topic-hierarchy";

/** Prefix for topic selections in `selectedEntities` (distinct from `category::tagName`). */
export const TOPIC_ENTITY_PREFIX = "topic::";

export type TopicRow = {
  id: string;
  name: string;
  parent_topic_id: string | null;
  sort_order?: number | null;
};

export type PageTopicRow = {
  analysis_id: string;
  topic_id: string;
};

function analysesInSubtree(
  topicId: string,
  directByTopic: Map<string, Set<string>>,
  childrenByParent: Map<string | null, TopicRow[]>,
  memo: Map<string, Set<string>>
): Set<string> {
  const cached = memo.get(topicId);
  if (cached) return cached;
  const acc = new Set<string>(directByTopic.get(topicId) ?? []);
  const kids = childrenByParent.get(topicId) ?? [];
  for (const c of kids) {
    for (const aid of analysesInSubtree(c.id, directByTopic, childrenByParent, memo)) {
      acc.add(aid);
    }
  }
  memo.set(topicId, acc);
  return acc;
}

function canonicalTopicName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build sidebar catalog from `topics` + `page_topics` (timeline assignments).
 */
export function buildTopicCatalogData(
  topics: TopicRow[],
  pageTopics: PageTopicRow[]
): {
  entitiesByCategory: Record<string, CategoryData[]>;
  untaggedCount: number;
  taggedCount: number;
  totalAnalyses: number;
} | null {
  if (!topics.length) return null;

  const directByTopic = new Map<string, Set<string>>();
  for (const row of pageTopics) {
    if (!row.topic_id || !row.analysis_id) continue;
    const s = directByTopic.get(row.topic_id) ?? new Set();
    s.add(row.analysis_id);
    directByTopic.set(row.topic_id, s);
  }

  const childrenByParent = new Map<string | null, TopicRow[]>();
  for (const t of topics) {
    const pid = t.parent_topic_id ?? null;
    const arr = childrenByParent.get(pid) ?? [];
    arr.push(t);
    childrenByParent.set(pid, arr);
  }

  const subtreeMemo = new Map<string, Set<string>>();
  const topicsByName = new Map<string, TopicRow[]>();
  for (const topic of topics) {
    const key = canonicalTopicName(topic.name);
    const bucket = topicsByName.get(key) ?? [];
    bucket.push(topic);
    topicsByName.set(key, bucket);
  }

  const roots = TOPIC_HIERARCHY.map((group, groupIndex): CategoryData => {
    const children = group.leaves.map((leaf, leafIndex): CategoryData => {
      const matchingTopics = topicsByName.get(canonicalTopicName(leaf)) ?? [];
      const analysisIds = new Set<string>();
      for (const topic of matchingTopics) {
        for (const id of analysesInSubtree(topic.id, directByTopic, childrenByParent, subtreeMemo)) {
          analysisIds.add(id);
        }
      }
      const topicIds = matchingTopics.map((topic) => topic.id).filter(Boolean);
      return {
        id: topicIds[0] ?? `topic-leaf-${groupIndex}-${leafIndex}`,
        category: "narratives",
        name: leaf,
        count: analysisIds.size,
        isParent: false,
        isTag: true,
        entityKey: topicIds.length ? `${TOPIC_ENTITY_PREFIX}${topicIds.join(",")}` : undefined,
      };
    });

    return {
      id: `topic-group-${groupIndex}`,
      category: "narratives",
      name: group.name,
      count: children.reduce((sum, child) => sum + child.count, 0),
      isParent: true,
      children,
    };
  });

  if (roots.length === 0) return null;

  const totalDistinct = new Set(pageTopics.map((p) => p.analysis_id).filter(Boolean)).size;

  return {
    entitiesByCategory: { narratives: roots },
    untaggedCount: 0,
    taggedCount: totalDistinct,
    totalAnalyses: totalDistinct,
  };
}

export function parseTopicIdsFromSelection(selectedEntities: Set<string>): string[] {
  return Array.from(selectedEntities)
    .filter((k) => k.startsWith(TOPIC_ENTITY_PREFIX))
    .flatMap((k) => k.slice(TOPIC_ENTITY_PREFIX.length).split(","))
    .filter(Boolean);
}

export function selectionUsesTopicKeys(selectedEntities: Set<string>): boolean {
  if (selectedEntities.size === 0) return false;
  return Array.from(selectedEntities).every((k) => k.startsWith(TOPIC_ENTITY_PREFIX));
}

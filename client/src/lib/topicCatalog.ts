import type { CategoryData } from "@/components/TagsSidebar";

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

function toCategoryNode(
  topic: TopicRow,
  childrenByParent: Map<string | null, TopicRow[]>,
  directByTopic: Map<string, Set<string>>,
  subtreeMemo: Map<string, Set<string>>
): CategoryData {
  const children = (childrenByParent.get(topic.id) ?? [])
    .slice()
    .sort((a, b) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    })
    .map((c) => toCategoryNode(c, childrenByParent, directByTopic, subtreeMemo));

  const count = analysesInSubtree(topic.id, directByTopic, childrenByParent, subtreeMemo).size;

  if (children.length === 0) {
    return {
      id: topic.id,
      category: "narratives",
      name: topic.name,
      count,
      isParent: false,
      isTag: true,
      entityKey: `${TOPIC_ENTITY_PREFIX}${topic.id}`,
    };
  }

  return {
    id: topic.id,
    category: "narratives",
    name: topic.name,
    count,
    isParent: true,
    children,
  };
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
  const roots = (childrenByParent.get(null) ?? [])
    .slice()
    .sort((a, b) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    })
    .map((t) => toCategoryNode(t, childrenByParent, directByTopic, subtreeMemo));

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
    .map((k) => k.slice(TOPIC_ENTITY_PREFIX.length));
}

export function selectionUsesTopicKeys(selectedEntities: Set<string>): boolean {
  if (selectedEntities.size === 0) return false;
  return Array.from(selectedEntities).every((k) => k.startsWith(TOPIC_ENTITY_PREFIX));
}

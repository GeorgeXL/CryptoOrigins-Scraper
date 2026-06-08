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

export type AnalysisTopicRow = {
  id: string;
  topic_categories: unknown;
};

function analysesInSubtree(
  topicId: string,
  directByTopic: Map<string, Set<string>>,
  childrenByParent: Map<string | null, TopicRow[]>,
  memo: Map<string, Set<string>>,
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

/** Labels stored on `historical_news_analyses.topic_categories` (strings or {label|name|slug}). */
export function extractTopicLabelsFromCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      const s = x.trim();
      if (s) out.push(s);
      continue;
    }
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const label =
        typeof o.label === "string" ? o.label
        : typeof o.name === "string" ? o.name
        : typeof o.slug === "string" ? o.slug
        : "";
      if (label.trim()) out.push(label.trim());
    }
  }
  return out;
}

const LEAF_NAME_BY_CANONICAL = new Map<string, string>(
  TOPIC_HIERARCHY.flatMap((group) => group.leaves.map((leaf) => [canonicalTopicName(leaf), leaf] as const)),
);

function initLeafAnalysisIds(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const group of TOPIC_HIERARCHY) {
    for (const leaf of group.leaves) {
      map.set(leaf, new Set());
    }
  }
  return map;
}

/**
 * Build sidebar catalog from `topics` + `page_topics`, optionally enriched with
 * `historical_news_analyses.topic_categories` when a day has no page_topics row yet.
 */
export function buildTopicCatalogData(
  topics: TopicRow[],
  pageTopics: PageTopicRow[],
  analysisTopics: AnalysisTopicRow[] = [],
): {
  entitiesByCategory: Record<string, CategoryData[]>;
  untaggedCount: number;
  taggedCount: number;
  totalAnalyses: number;
} | null {
  if (!topics.length) return null;

  const leafAnalysisIds = initLeafAnalysisIds();

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

  for (const group of TOPIC_HIERARCHY) {
    for (const leaf of group.leaves) {
      const matchingTopics = topicsByName.get(canonicalTopicName(leaf)) ?? [];
      const analysisIds = leafAnalysisIds.get(leaf)!;
      for (const topic of matchingTopics) {
        for (const id of analysesInSubtree(topic.id, directByTopic, childrenByParent, subtreeMemo)) {
          analysisIds.add(id);
        }
      }
    }
  }

  for (const row of analysisTopics) {
    const analysisId = row.id?.trim();
    if (!analysisId) continue;
    for (const label of extractTopicLabelsFromCategories(row.topic_categories)) {
      const leaf = LEAF_NAME_BY_CANONICAL.get(canonicalTopicName(label));
      if (!leaf) continue;
      leafAnalysisIds.get(leaf)?.add(analysisId);
    }
  }

  const roots = TOPIC_HIERARCHY.map((group, groupIndex): CategoryData => {
    const children = group.leaves.map((leaf, leafIndex): CategoryData => {
      const matchingTopics = topicsByName.get(canonicalTopicName(leaf)) ?? [];
      const topicIds = matchingTopics.map((topic) => topic.id).filter(Boolean);
      return {
        id: topicIds[0] ?? `topic-leaf-${groupIndex}-${leafIndex}`,
        category: "narratives",
        name: leaf,
        count: leafAnalysisIds.get(leaf)?.size ?? 0,
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

  const allTagged = new Set<string>();
  for (const ids of leafAnalysisIds.values()) {
    for (const id of ids) allTagged.add(id);
  }

  return {
    entitiesByCategory: { narratives: roots },
    untaggedCount: 0,
    taggedCount: allTagged.size,
    totalAnalyses: allTagged.size,
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

function findTopicLabelInCatalog(
  selectionKey: string,
  entitiesByCategory: Record<string, CategoryData[]>,
): string | null {
  const walk = (nodes: CategoryData[]): string | null => {
    for (const node of nodes) {
      const nodeKey = node.entityKey ?? `${node.category}::${node.name}`;
      if (nodeKey === selectionKey) return node.name;
      if (node.children?.length) {
        const found = walk(node.children);
        if (found) return found;
      }
    }
    return null;
  };

  for (const entities of Object.values(entitiesByCategory)) {
    const found = walk(entities);
    if (found) return found;
  }
  return null;
}

/** Display name for the single selected storyline in the Topics sidebar. */
export function resolveTopicLabelFromSelection(
  selectedEntities: Set<string>,
  catalogData: {
    entitiesByCategory: Record<string, CategoryData[]>;
  } | null,
): string | null {
  if (!catalogData || selectedEntities.size !== 1) return null;
  const selectionKey = Array.from(selectedEntities)[0];
  if (!selectionKey.startsWith(TOPIC_ENTITY_PREFIX)) return null;
  return findTopicLabelInCatalog(selectionKey, catalogData.entitiesByCategory);
}

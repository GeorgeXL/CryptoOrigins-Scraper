import type { CategoryData } from "@/components/TagsSidebar";
import { TOPIC_HIERARCHY } from "@shared/topic-hierarchy";
import { resolveStorylineLeafLabel } from "@shared/topic-hierarchy-migration";
import {
  analysisMatchesStorylineLeaf,
  extractTopicLabelsFromCategories,
} from "@shared/storyline-topic-eligibility";

/** Prefix for topic selections in `selectedEntities` (distinct from `category::tagName`). */
export const TOPIC_ENTITY_PREFIX = "topic::";

export type AnalysisTopicRow = {
  id: string;
  topic_categories: unknown;
};

export { extractTopicLabelsFromCategories };

const LEAF_NAME_BY_CANONICAL = new Map<string, string>(
  TOPIC_HIERARCHY.flatMap((group) => group.leaves.map((leaf) => [canonicalTopicName(leaf), leaf] as const)),
);

function canonicalTopicName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

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
 * Build sidebar catalog from `TOPIC_HIERARCHY` + `topic_categories` on each day row.
 */
export function buildTopicCatalogData(
  analysisTopics: AnalysisTopicRow[] = [],
): {
  entitiesByCategory: Record<string, CategoryData[]>;
  untaggedCount: number;
  taggedCount: number;
  totalAnalyses: number;
} | null {
  const leafAnalysisIds = initLeafAnalysisIds();

  for (const row of analysisTopics) {
    const analysisId = row.id?.trim();
    if (!analysisId) continue;
    for (const label of extractTopicLabelsFromCategories(row.topic_categories)) {
      const resolved = resolveStorylineLeafLabel(label) ?? label;
      const leaf = LEAF_NAME_BY_CANONICAL.get(canonicalTopicName(resolved));
      if (!leaf) continue;
      leafAnalysisIds.get(leaf)?.add(analysisId);
    }
  }

  const roots = TOPIC_HIERARCHY.map((group, groupIndex): CategoryData => {
    const children = group.leaves.map((leaf, leafIndex): CategoryData => ({
      id: `topic-leaf-${groupIndex}-${leafIndex}`,
      category: "narratives",
      name: leaf,
      count: leafAnalysisIds.get(leaf)?.size ?? 0,
      isParent: false,
      isTag: true,
    }));

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

/** Canonical hierarchy leaf for a Topics sidebar selection (`topic::…` or `narratives::…`). */
export function resolveSelectedTopicLeafFromSelection(
  selectedEntities: Set<string>,
  catalogData: {
    entitiesByCategory: Record<string, CategoryData[]>;
  } | null,
): string | null {
  if (selectedEntities.size !== 1) return null;
  const selectionKey = Array.from(selectedEntities)[0];
  if (selectionKey.startsWith(TOPIC_ENTITY_PREFIX)) {
    if (!catalogData) return null;
    return findTopicLabelInCatalog(selectionKey, catalogData.entitiesByCategory);
  }
  const [category, name] = selectionKey.split("::");
  if (category === "narratives" && name?.trim()) return name.trim();
  return null;
}

/** Whether an analysis belongs to the selected hierarchy leaf (matches sidebar counts). */
export function analysisMatchesTopicLeaf(
  analysis: { topic_categories?: unknown },
  leaf: string,
): boolean {
  return analysisMatchesStorylineLeaf(analysis.topic_categories, leaf, resolveStorylineLeafLabel);
}

/** Display name for the single selected storyline in the Topics sidebar. */
export function resolveTopicLabelFromSelection(
  selectedEntities: Set<string>,
  catalogData: {
    entitiesByCategory: Record<string, CategoryData[]>;
  } | null,
): string | null {
  if (!catalogData || selectedEntities.size !== 1) return null;
  return resolveSelectedTopicLeafFromSelection(selectedEntities, catalogData);
}

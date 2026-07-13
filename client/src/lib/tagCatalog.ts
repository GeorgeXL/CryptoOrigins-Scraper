import type { CategoryData } from "@/components/TagsSidebar";
import {
  resolveTagTaxonomyCategory,
  TAG_CATALOG_MIN_COUNT,
  TAG_TAXONOMY_LABELS,
  TAG_TAXONOMY_VALUES,
  type TagTaxonomyCategory,
} from "@shared/tag-taxonomy";

/** Prefix for tag selections in `selectedEntities`. */
export const TAG_ENTITY_PREFIX = "tag::";

export type AnalysisTagRow = {
  id: string;
  tags_version2?: string[] | null;
  is_locked?: unknown;
};

export function buildTagCatalogData(analysisRows: AnalysisTagRow[] = []) {
  const tagToIds = new Map<string, Set<string>>();

  for (const row of analysisRows) {
    const id = row.id?.trim();
    if (!id || !Array.isArray(row.tags_version2)) continue;
    for (const raw of row.tags_version2) {
      const tag = typeof raw === "string" ? raw.trim() : "";
      if (!tag) continue;
      if (!tagToIds.has(tag)) tagToIds.set(tag, new Set());
      tagToIds.get(tag)!.add(id);
    }
  }

  const byCategory = new Map<TagTaxonomyCategory, CategoryData[]>();
  for (const category of TAG_TAXONOMY_VALUES) {
    byCategory.set(category, []);
  }

  for (const [tag, ids] of tagToIds) {
    if (ids.size < TAG_CATALOG_MIN_COUNT) continue;
    const category = resolveTagTaxonomyCategory(tag);
    byCategory.get(category)!.push({
      id: `tag-${category}-${tag}`,
      category,
      name: tag,
      count: ids.size,
      isParent: false,
      isTag: true,
      entityKey: `${TAG_ENTITY_PREFIX}${tag}`,
    });
  }

  for (const list of byCategory.values()) {
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  const roots: CategoryData[] = TAG_TAXONOMY_VALUES.map((category) => {
    const children = byCategory.get(category) ?? [];
    return {
      id: `tag-group-${category}`,
      category: "tag-entities",
      name: TAG_TAXONOMY_LABELS[category],
      count: children.reduce((sum, child) => sum + child.count, 0),
      isParent: true,
      children,
    };
  }).filter((root) => (root.children?.length ?? 0) > 0);

  if (roots.length === 0) return null;

  const allTagged = new Set<string>();
  for (const ids of tagToIds.values()) {
    if (ids.size < TAG_CATALOG_MIN_COUNT) continue;
    for (const id of ids) allTagged.add(id);
  }

  return {
    entitiesByCategory: { "tag-entities": roots },
    untaggedCount: 0,
    taggedCount: allTagged.size,
    totalAnalyses: allTagged.size,
  };
}

export function selectionUsesTagKeys(selectedEntities: Set<string>): boolean {
  if (selectedEntities.size === 0) return false;
  return Array.from(selectedEntities).every((key) => key.startsWith(TAG_ENTITY_PREFIX));
}

export function resolveSelectedTagFromSelection(selectedEntities: Set<string>): string | null {
  const key = Array.from(selectedEntities).find((k) => k.startsWith(TAG_ENTITY_PREFIX));
  if (!key) return null;
  const name = key.slice(TAG_ENTITY_PREFIX.length).trim();
  return name || null;
}

export function analysisMatchesTag(
  row: { tags_version2?: string[] | null },
  tagName: string,
): boolean {
  if (!Array.isArray(row.tags_version2)) return false;
  return row.tags_version2.includes(tagName);
}

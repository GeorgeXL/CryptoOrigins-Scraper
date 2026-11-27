import type { CategoryData } from "@/components/TagsSidebar";
import { STORY_HIERARCHY, STORY_HIERARCHY_LEAVES } from "@shared/story-hierarchy";

/** Prefix for story selections in `selectedEntities`. */
export const STORY_ENTITY_PREFIX = "story::";

export type AnalysisStoryRow = {
  id: string;
  story_line: string | null;
};

function canonicalStoryName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ");
}

const LEAF_NAME_BY_CANONICAL = new Map<string, string>(
  STORY_HIERARCHY_LEAVES.map((leaf) => [canonicalStoryName(leaf), leaf]),
);

export function buildStoryCatalogData(analysisRows: AnalysisStoryRow[] = []) {
  const leafAnalysisIds = new Map<string, Set<string>>();
  for (const leaf of STORY_HIERARCHY_LEAVES) {
    leafAnalysisIds.set(leaf, new Set());
  }

  for (const row of analysisRows) {
    const id = row.id?.trim();
    const raw = row.story_line?.trim();
    if (!id || !raw) continue;
    const leaf = LEAF_NAME_BY_CANONICAL.get(canonicalStoryName(raw));
    if (!leaf) continue;
    leafAnalysisIds.get(leaf)?.add(id);
  }

  const roots: CategoryData[] = STORY_HIERARCHY.map((pillar, pillarIndex) => {
    const sections = pillar.sections.map((section, sectionIndex): CategoryData => {
      const children = section.leaves.map((leaf, leafIndex): CategoryData => ({
        id: `story-leaf-${pillarIndex}-${sectionIndex}-${leafIndex}`,
        category: "story",
        name: leaf,
        count: leafAnalysisIds.get(leaf)?.size ?? 0,
        isParent: false,
        isTag: true,
        entityKey: `${STORY_ENTITY_PREFIX}${leaf}`,
      }));
      return {
        id: `story-section-${pillarIndex}-${sectionIndex}`,
        category: "story",
        name: section.name,
        count: children.reduce((sum, child) => sum + child.count, 0),
        isParent: true,
        children,
      };
    });
    return {
      id: `story-pillar-${pillarIndex}`,
      category: "story",
      name: pillar.name,
      count: sections.reduce((sum, section) => sum + section.count, 0),
      isParent: true,
      children: sections,
    };
  });

  const allTagged = new Set<string>();
  for (const ids of leafAnalysisIds.values()) {
    for (const id of ids) allTagged.add(id);
  }

  return {
    entitiesByCategory: { story: roots },
    untaggedCount: 0,
    taggedCount: allTagged.size,
    totalAnalyses: allTagged.size,
  };
}

export function resolveSelectedStoryFromSelection(selectedEntities: Set<string>): string | null {
  if (selectedEntities.size !== 1) return null;
  const key = Array.from(selectedEntities)[0] ?? "";
  if (!key.startsWith(STORY_ENTITY_PREFIX)) return null;
  const name = key.slice(STORY_ENTITY_PREFIX.length).trim();
  return LEAF_NAME_BY_CANONICAL.get(canonicalStoryName(name)) ?? (name || null);
}

export function analysisMatchesStory(
  row: { story_line?: string | null },
  story: string,
): boolean {
  const raw = row.story_line?.trim();
  if (!raw) return false;
  return canonicalStoryName(raw) === canonicalStoryName(story);
}

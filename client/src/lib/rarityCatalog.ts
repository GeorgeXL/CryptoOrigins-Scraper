import type { CategoryData } from "@/components/TagsSidebar";
import {
  isValidRarity,
  RARITY_LABELS,
  RARITY_VALUES,
  type Rarity,
} from "@shared/rarity";

/** Prefix for rarity selections in `selectedEntities`. */
export const RARITY_ENTITY_PREFIX = "rarity::";

export type AnalysisRarityRow = {
  id: string;
  rarity: string | null;
  is_locked?: unknown;
};

export function buildRarityCatalogData(analysisRows: AnalysisRarityRow[] = []) {
  const counts = new Map<Rarity, Set<string>>();
  for (const value of RARITY_VALUES) {
    counts.set(value, new Set());
  }

  for (const row of analysisRows) {
    const id = row.id?.trim();
    if (!id || !row.rarity || !isValidRarity(row.rarity)) continue;
    counts.get(row.rarity)?.add(id);
  }

  const children: CategoryData[] = RARITY_VALUES.map((value) => ({
    id: `rarity-${value}`,
    category: "rarity",
    name: RARITY_LABELS[value],
    count: counts.get(value)?.size ?? 0,
    isParent: false,
    isTag: true,
    entityKey: `${RARITY_ENTITY_PREFIX}${value}`,
  }));

  const allTagged = new Set<string>();
  for (const ids of counts.values()) {
    for (const id of ids) allTagged.add(id);
  }

  return {
    entitiesByCategory: { rarity: children },
    untaggedCount: 0,
    taggedCount: allTagged.size,
    totalAnalyses: allTagged.size,
  };
}

export function selectionUsesRarityKeys(selectedEntities: Set<string>): boolean {
  if (selectedEntities.size === 0) return false;
  return Array.from(selectedEntities).every((key) => key.startsWith(RARITY_ENTITY_PREFIX));
}

export function resolveSelectedRarityFromSelection(
  selectedEntities: Set<string>,
): Rarity | null {
  const key = Array.from(selectedEntities).find((k) => k.startsWith(RARITY_ENTITY_PREFIX));
  if (!key) return null;
  const value = key.slice(RARITY_ENTITY_PREFIX.length);
  return isValidRarity(value) ? value : null;
}

export function resolveRarityLabelFromSelection(selectedEntities: Set<string>): string | null {
  const rarity = resolveSelectedRarityFromSelection(selectedEntities);
  return rarity ? RARITY_LABELS[rarity] : null;
}

export function analysisMatchesRarity(row: { rarity?: string | null }, rarity: Rarity): boolean {
  return row.rarity === rarity;
}

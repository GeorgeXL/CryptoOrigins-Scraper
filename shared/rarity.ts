/** NFT / collector rarity axis — one label per locked calendar day. */
export const RARITY_VALUES = [
  "artifact",
  "landmark",
  "notable",
  "infamous",
  "chronicle",
] as const;

export type Rarity = (typeof RARITY_VALUES)[number];

export const RARITY_LABELS: Record<Rarity, string> = {
  artifact: "Artifact",
  landmark: "Landmark",
  notable: "Notable",
  infamous: "Infamous",
  chronicle: "Chronicle",
};

const RARITY_SET = new Set<string>(RARITY_VALUES);

export function isValidRarity(value: unknown): value is Rarity {
  return typeof value === "string" && RARITY_SET.has(value.trim().toLowerCase());
}

export function normalizeRarity(value: unknown): Rarity | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isValidRarity(normalized) ? normalized : null;
}

/** Parse model output — single word only, no explanation. */
export function parseRarityModelOutput(text: string): Rarity | null {
  const first = text.trim().split(/\s+/)[0]?.replace(/[^a-z]/gi, "").toLowerCase() ?? "";
  return normalizeRarity(first);
}

export function rarityIsMissing(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function rarityIsInvalid(value: unknown): boolean {
  return !rarityIsMissing(value) && !isValidRarity(value);
}

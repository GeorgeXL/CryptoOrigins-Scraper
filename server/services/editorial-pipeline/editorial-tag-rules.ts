/**
 * Shared rules for which strings qualify as homepage editorial tags.
 *
 * Tags should be **concrete named entities** readers can navigate by:
 * people, companies, countries/regions, cities, agencies, protocols, parties.
 * They must NOT be vague thematic phrases copied from summary prose
 * (budget deficits, debt crisis, police investigation, etc.).
 */

import { normalizeTagValue } from "./tools";

/** Shown in LLM prompts and operator-facing copy. */
export const EDITORIAL_ENTITY_TAG_GUIDANCE = `Tags must be concrete named entities only: people, companies, exchanges, countries/regions, cities, government agencies, political parties, and specific protocols or laws (e.g. MiCA, Taproot).
Do NOT tag vague themes, processes, or policy nouns even when they appear in the summary — e.g. budget deficits, stress tests, debt crisis, VAT, austerity, fiscal treaty, police, parliamentary inquiry, scrutiny, downgrades, reform, recession, regulation, mining, adoption. Those belong in the summary text, not on the tag row.`;

const DISALLOWED_EDITORIAL_TAGS = new Set([
  "altcoin",
  "america",
  "austerity",
  "bailout",
  "block",
  "budget",
  "budget deficit",
  "budget deficits",
  "business",
  "central bank",
  "chancellor",
  "company",
  "congress",
  "concerns",
  "casino",
  "casinos",
  "ceo",
  "core",
  "crypto",
  "crypto market",
  "crypto markets",
  "cryptocurrency",
  "debt",
  "debt crisis",
  "debt crises",
  "deficit",
  "deficits",
  "dentist",
  "dollar",
  "euro",
  "euros",
  "economy",
  "economic",
  "fiscal",
  "fiscal treaty",
  "foundation",
  "financial crisis",
  "gaming company",
  "gold",
  "gold-backed assets",
  "government",
  "inquiry",
  "investigation",
  "ireland",
  "interest rates",
  "job",
  "jobs",
  "leaders",
  "market",
  "oil",
  "parliamentary inquiry",
  "police",
  "pizza",
  "pound",
  "pounds",
  "pound sterling",
  "price",
  "president",
  "regulation",
  "regulations",
  "real estate",
  "reform",
  "recession",
  "scrutiny",
  "senate",
  "security",
  "singapore dollar",
  "spending",
  "stress test",
  "stress tests",
  "tax",
  "taxes",
  "transaction",
  "transactions",
  "treaty",
  "usd",
  "unemployment",
  "vat",
  "wave",
]);

/** Tokens that make a multi-word tag a thematic label, not an entity. */
const VAGUE_THEMATIC_TOKENS = new Set([
  "austerity",
  "budget",
  "crisis",
  "crises",
  "cuts",
  "deficit",
  "deficits",
  "debt",
  "debts",
  "downgrade",
  "downgrades",
  "economy",
  "economic",
  "fiscal",
  "growth",
  "inflation",
  "inquiry",
  "investigation",
  "leaders",
  "recession",
  "reform",
  "reforms",
  "regulation",
  "regulations",
  "scrutiny",
  "spending",
  "stress",
  "test",
  "tests",
  "audit",
  "audits",
  "review",
  "reviews",
  "assessment",
  "assessments",
  "tax",
  "taxes",
  "treaty",
  "vat",
]);

const TAG_ALIASES: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  "bitcoin price": "bitcoin",
  fed: "federal reserve",
  "lightning network": "lightning",
  "c-lightning": "lightning",
  "coin terra": "cointerra",
  cointerra: "cointerra",
  "united states": "us",
  usa: "us",
  "u.s": "us",
  "u.s.": "us",
  "new york city": "new york",
  "winklevoss twins": "winklevoss",
  "democratic party": "democrats",
  "center for responsive politics": "open secrets",
};

export function editorialTagKey(raw: string): string {
  const normalized = normalizeTagValue(raw);
  return TAG_ALIASES[normalized] ?? normalized;
}

function isVagueThematicEditorialTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length >= 2 && tokens.every((t) => VAGUE_THEMATIC_TOKENS.has(t))) return true;
  return false;
}

/** True when a string is a valid entity tag candidate for add/promote flows. */
export function isEditorialEntityTagCandidate(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(".")) return false;
  const normalized = normalizeTagValue(trimmed);
  if (!normalized) return false;
  const key = editorialTagKey(trimmed);
  if (DISALLOWED_EDITORIAL_TAGS.has(normalized) || DISALLOWED_EDITORIAL_TAGS.has(key)) return false;
  if (isVagueThematicEditorialTag(trimmed)) return false;
  if (normalized.length <= 2 && !["us", "uk", "eu"].includes(normalized)) return false;
  if (/\b(bbc|npr|cnn|podcast)\b/.test(normalized)) return false;
  if (/\bradio\b/.test(normalized)) return false;
  return true;
}

/** True when an existing row tag should be proposed for removal as invalid. */
export function isEditoriallyInvalidCurrentTag(raw: string): boolean {
  return !isEditorialEntityTagCandidate(raw) || editorialTagKey(raw) === "open secrets";
}

export function filterEditorialEntityTagCandidates(tags: string[]): string[] {
  return tags.filter(isEditorialEntityTagCandidate);
}

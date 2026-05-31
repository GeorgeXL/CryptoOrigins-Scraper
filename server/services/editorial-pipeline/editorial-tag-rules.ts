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
Do NOT tag vague themes, processes, role groups, policy nouns, sentiment, generic plurals, or political-era phrases even when they appear in the summary — e.g. budget deficits, cities, community, crypto community, protocol, derivatives, futures, batching, spam, cites (the verb), halving, mining, miners, adoption, inflation, android, energy, greylisting, hard fork, monetary policy, virtual currency, web-wallet. Do NOT reuse legacy taxonomy headline fragments (2015-12-31 wallet fixes, mempool limits and vulnerabilities, OCC and thomas curry). Acronyms must appear in the summary with exact casing (CITES ≠ the verb "cites"). Do NOT repeat a country tag as a nationality+role compound. For people, use full names (Warren Buffett) not surname-only fragments (Buffett) when the full name is in the summary. Those belong in the summary text or topic row, not on the tag row.`;

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
  "batching",
  "spam",
  "community",
  "city",
  "cities",
  "cite",
  "cites",
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
  "derivatives",
  "derivative",
  "dollar",
  "etf",
  "etfs",
  "euro",
  "euros",
  "economy",
  "economic",
  "fiscal",
  "fiscal treaty",
  "foundation",
  "financial crisis",
  "futures",
  "gaming company",
  "gold",
  "gold-backed assets",
  "government",
  "halving",
  "halvening",
  "block reward",
  "hashrate",
  "hash rate",
  "difficulty",
  "adoption",
  "inquiry",
  "investigation",
  "ireland",
  "interest rates",
  "job",
  "jobs",
  "leaders",
  "market",
  "miners",
  "miner",
  "mining",
  "oil",
  "optimism",
  "optimistic",
  "pessimism",
  "pessimistic",
  "parliamentary inquiry",
  "police",
  "pizza",
  "pound",
  "pounds",
  "pound sterling",
  "price",
  "president",
  "protocol",
  "protocols",
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
  "uncertainty",
  "bullish",
  "bearish",
  "sentiment",
  "outlook",
  "confidence",
  "android",
  "energy",
  "greylisting",
  "inflation",
  "wallet",
  "web-wallet",
  "web wallet",
  "hard fork",
  "monetary policy",
  "virtual currency",
  "digital currency",
  "bitcoin technology",
  "bitcoin vault",
  "multi-sig wallet",
  "multi sig wallet",
  "opt-in replace-by-fee",
  "opt in replace by fee",
  "ministry of finance",
  "digital currency and exchanges",
  "mempool limits and vulnerabilities",
  "wallet fixes",
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
  "energy",
  "technology",
  "finance",
  "exchange",
  "exchanges",
  "android",
  "greylisting",
  "vault",
  "fork",
  "mempool",
  "wallet",
  "digital",
  "virtual",
]);

/** Calendar dates embedded in legacy headline tags — never valid entity tags. */
const DATE_EMBEDDED_IN_TAG = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/;

/** Legacy taxonomy labels copied from weekly headline lists, not entity names. */
const HEADLINE_FRAGMENT_PHRASES = [
  "hard fork",
  "monetary policy",
  "virtual currency",
  "digital currency",
  "digital currency and exchanges",
  "web wallet",
  "web-wallet",
  "multi sig",
  "multi-sig",
  "replace by fee",
  "replace-by-fee",
  "opt in replace",
  "opt-in replace",
  "mempool",
  "mempool limits",
  "wallet fixes",
  "bitcoin vault",
  "bitcoin technology",
  "ministry of finance",
  "greylisting",
  "occ and",
  "and thomas curry",
] as const;

/** Single-token mood/outlook labels — not navigable entities. */
const SENTIMENT_OUTLOOK_TOKENS = new Set([
  "optimism",
  "optimistic",
  "pessimism",
  "pessimistic",
  "confidence",
  "uncertainty",
  "bullish",
  "bearish",
  "sentiment",
  "outlook",
  "hope",
  "fear",
  "hype",
  "euphoria",
  "panic",
]);

/** Multi-word tags ending in these are political periods, not entity tags. */
const INSTITUTION_PERIOD_SUFFIX =
  /\b(administration|presidency|era|cabinet|government)\b$/i;

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
  "bitcoin atms": "bitcoin atm",
  "u.k.": "uk",
  "u k": "uk",
};

/** Preferred homepage label for entity tags that share one editorialTagKey. */
const PREFERRED_ENTITY_TAG_LABELS: Record<string, string> = {
  "bitcoin atm": "Bitcoin ATM",
};

/** Nationality/adjective forms that map to country tags already on the row. */
const NATIONALITY_TO_COUNTRY: Record<string, string> = {
  chinese: "china",
  american: "us",
  british: "uk",
  english: "uk",
  japanese: "japan",
  korean: "korea",
  russian: "russia",
  german: "germany",
  french: "france",
  canadian: "canada",
  australian: "australia",
  indian: "india",
  european: "europe",
};

const ROLE_GROUP_SUFFIX =
  /\b(miners?|mining|workers?|investors?|traders?|developers?|users?|holders?|farms?)\b$/i;

function isDemographicRoleGroupTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized) return false;
  if (normalized === "miners" || normalized === "miner" || normalized === "mining") return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const last = tokens[tokens.length - 1] ?? "";
  return ROLE_GROUP_SUFFIX.test(last);
}

/** Dotted initialisms with no substantive words (B.C., A.B.C.) — not homepage tags. */
function isInitialismOnlyTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized || !normalized.includes(".")) return false;
  if (/\s/.test(normalized)) return false;
  if (!/^[a-z0-9](?:\.[a-z0-9]+)*\.?$/i.test(normalized)) return false;
  const segments = normalized.split(".").filter(Boolean);
  return segments.length >= 2 && segments.every((segment) => segment.length <= 2);
}

/** True when a proposed add duplicates an existing country/region tag as nationality+role. */
export function isRedundantCountryRoleTag(raw: string, currentTags: string[]): boolean {
  if (!isDemographicRoleGroupTag(raw)) return false;
  const normalized = normalizeTagValue(raw);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return normalized === "miners" || normalized === "mining";
  const adj = tokens.slice(0, -1).join(" ");
  const countryKey = NATIONALITY_TO_COUNTRY[adj] ?? editorialTagKey(adj);
  const currentKeys = new Set(currentTags.map((t) => editorialTagKey(t)).filter(Boolean));
  return currentKeys.has(countryKey);
}

/** True when a single-token tag duplicates the surname of a fuller name already present. */
export function isRedundantSurnameFragmentTag(raw: string, contextTags: string[]): boolean {
  const normalized = normalizeTagValue(raw);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return false;
  const fragment = tokens[0] ?? "";
  if (fragment.length < 4) return false;

  for (const other of contextTags) {
    if (typeof other !== "string") continue;
    const otherNorm = normalizeTagValue(other);
    if (!otherNorm || otherNorm === normalized) continue;
    const otherTokens = otherNorm.split(/\s+/).filter(Boolean);
    if (otherTokens.length < 2) continue;
    const surname = otherTokens[otherTokens.length - 1] ?? "";
    if (surname === fragment) return true;
  }
  return false;
}

/** Filter Tag Agent / proposal adds against editorial entity policy. */
export function filterEditorialTagAdds(tags: string[], currentTags: string[]): string[] {
  const candidates = tags.filter((tag) => {
    if (!isEditorialEntityTagCandidate(tag)) return false;
    if (isRedundantCountryRoleTag(tag, currentTags)) return false;
    return true;
  });

  const out: string[] = [];
  const context = [...currentTags];
  for (const tag of candidates.sort((a, b) => b.length - a.length)) {
    if (isRedundantSurnameFragmentTag(tag, [...context, ...out])) continue;
    const key = editorialTagKey(tag);
    if (!key || out.some((x) => editorialTagKey(x) === key)) continue;
    out.push(preferredEditorialTagDisplay(tag));
  }
  return out;
}

export function editorialTagKey(raw: string): string {
  const normalized = normalizeTagValue(raw);
  return TAG_ALIASES[normalized] ?? normalized;
}

/** Collapse plural/alias forms to the canonical homepage label (e.g. Bitcoin ATMs → Bitcoin ATM). */
export function preferredEditorialTagDisplay(raw: string): string {
  const key = editorialTagKey(raw);
  if (PREFERRED_ENTITY_TAG_LABELS[key]) return PREFERRED_ENTITY_TAG_LABELS[key];
  if (key === "uk") return "UK";
  return raw.trim();
}

function isInstitutionPeriodTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const last = tokens[tokens.length - 1] ?? "";
  return INSTITUTION_PERIOD_SUFFIX.test(last);
}

function isSentimentOutlookTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return SENTIMENT_OUTLOOK_TOKENS.has(tokens[0] ?? "");
  return tokens.every((t) => SENTIMENT_OUTLOOK_TOKENS.has(t));
}

export function isDateEmbeddedEditorialTag(raw: string): boolean {
  return DATE_EMBEDDED_IN_TAG.test(raw.trim());
}

export function isHeadlineFragmentEditorialTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized) return false;
  if (DATE_EMBEDDED_IN_TAG.test(normalized)) return true;
  if (HEADLINE_FRAGMENT_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  if (/\b(?:fixes|vulnerabilities|limits|greylisting)\b$/.test(normalized)) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const andIdx = tokens.indexOf("and");
  if (andIdx > 0 && andIdx < tokens.length - 1 && tokens.length >= 3) {
    const before = tokens[andIdx - 1] ?? "";
    const after = tokens.slice(andIdx + 1).join(" ");
    if (/^[a-z]{2,5}$/.test(before) && /\b[a-z]+\s+[a-z]+\b/.test(after)) return true;
  }
  return false;
}

function isVagueThematicEditorialTag(raw: string): boolean {
  const normalized = normalizeTagValue(raw);
  if (!normalized) return true;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1 && VAGUE_THEMATIC_TOKENS.has(tokens[0] ?? "")) return true;
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
  if (isSentimentOutlookTag(trimmed)) return false;
  if (isInstitutionPeriodTag(trimmed)) return false;
  if (isDemographicRoleGroupTag(trimmed)) return false;
  if (isInitialismOnlyTag(trimmed)) return false;
  if (isDateEmbeddedEditorialTag(trimmed)) return false;
  if (isHeadlineFragmentEditorialTag(trimmed)) return false;
  if (isVagueThematicEditorialTag(trimmed)) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.some((token) => DISALLOWED_EDITORIAL_TAGS.has(token))) return false;
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

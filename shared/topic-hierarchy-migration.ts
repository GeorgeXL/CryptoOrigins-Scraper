import { TOPIC_HIERARCHY_LEAVES } from "./topic-hierarchy";

function normalizeTopicKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Maps legacy storyline leaf labels (pre-2026-06 hierarchy) to the new canonical leaf.
 * `null` = dropped / needs manual review — retag script leaves topic unchanged and logs it.
 */
export const LEGACY_TOPIC_LEAF_MIGRATION: Record<string, string | null> = {
  // Bitcoin — kept
  "Early Bitcoin history": "Early Bitcoin history",
  "Satoshi identity": "Satoshi identity",
  "Halving events": "Halving events",
  "Bitcoin adoption": "Bitcoin adoption",
  "Scaling and Layer 2": "Scaling and Layer 2",

  // Bitcoin — merged
  "Protocol development": "Protocol & upgrades",
  "Bitcoin Core": "Protocol & upgrades",
  "BIPs and upgrades": "Protocol & upgrades",
  "Soft forks and hard forks": "Protocol & upgrades",
  "Node infrastructure": "Protocol & upgrades",
  "Mining evolution": "Bitcoin mining",
  "Mining pools": "Bitcoin mining",
  "Mining companies": "Bitcoin mining",
  "Wallet development": "Wallets & self-custody",
  "Privacy and self-custody": "Wallets & self-custody",
  "Merchant adoption": "Bitcoin adoption",
  "Payment processors": "Bitcoin adoption",

  // Markets — merged / moved
  "Bitcoin price action": "Bitcoin price & cycles",
  "Market cycles": "Bitcoin price & cycles",
  "Trading activity": "Bitcoin price & cycles",
  "Liquidity and flows": "Institutional Bitcoin & flows",
  "Institutional inflows": "Institutional Bitcoin & flows",
  "Derivatives": "Derivatives",
  "ETFs and investment products": "ETFs and investment products",
  "Safe haven narrative": "Bitcoin price & cycles",

  // Macroeconomy (from Macro & Policy macro leaves)
  Inflation: "Inflation",
  "Interest rates": "Monetary policy & rates",
  "Monetary policy": "Monetary policy & rates",
  "Central banks": "Monetary policy & rates",
  "Banking stress": "Banking stress",
  "Debt crises": "Debt crises",
  "Labor market": "Labor market",
  Housing: "Housing",
  "Bailouts and stimulus": "Bailouts and stimulus",
  "Global growth and recession": "Global growth and recession",
  "Politics and elections": "Politics and elections",

  // Crypto policy (from Macro & Policy + Companies enforcement)
  "Bitcoin regulation": "Bitcoin regulation",
  "Securities regulation": "Securities regulation",
  "Tax policy": "Tax policy",
  "Banking regulation": "Banking & prudential (crypto)",
  "Sanctions and state actions": "Sanctions and enforcement",
  "Legal cases": "Legal cases",
  "Government adoption": "Government adoption",
  CBDCs: "CBDCs",
  "Law enforcement": "Enforcement & crime",
  "Fraud and scams": "Enforcement & crime",

  // Companies — distributed (group removed)
  Exchanges: "Exchanges",
  "Exchange failures": "Exchanges",
  Custody: "Institutional Bitcoin & flows",
  "Financial institutions": "Institutional Bitcoin & flows",
  "Corporate treasury adoption": "Institutional Bitcoin & flows",
  "Hacks and exploits": "Exchanges",
  "Operational security": "Enforcement & crime",
  "Startup funding": "Web3 industry and funding",
  "Enterprise blockchain adoption": null,
  "Data and analytics": null,

  // Web3 (from Other Crypto)
  "Ethereum and smart contracts": "Smart contracts & L1s",
  "Altcoin ecosystems": "Smart contracts & L1s",
  "Layer 1 networks": "Smart contracts & L1s",
  Stablecoins: "Stablecoins",
  DeFi: "DeFi",
  "NFTs and gaming": "NFTs and gaming",
  "Cross-chain infrastructure": "Cross-chain and bridges",
};

const CURRENT_TOPIC_BY_KEY = new Map<string, string>(
  TOPIC_HIERARCHY_LEAVES.map((leaf) => [normalizeTopicKey(leaf), leaf]),
);

const LEGACY_TOPIC_BY_KEY = new Map<string, string | null>();
for (const [legacy, target] of Object.entries(LEGACY_TOPIC_LEAF_MIGRATION)) {
  LEGACY_TOPIC_BY_KEY.set(normalizeTopicKey(legacy), target);
}

/** Legacy group names removed or renamed in the UI. */
export const LEGACY_TOPIC_GROUP_NAMES = new Set([
  "Macro & Policy",
  "Companies & Adoption",
  "Other Crypto",
]);

export function migrateLegacyTopicLeaf(legacyLeaf: string): string | null | undefined {
  const key = legacyLeaf.trim();
  if (!key) return undefined;
  if (TOPIC_HIERARCHY_LEAVES.includes(key)) return key;
  if (Object.prototype.hasOwnProperty.call(LEGACY_TOPIC_LEAF_MIGRATION, key)) {
    return LEGACY_TOPIC_LEAF_MIGRATION[key] ?? null;
  }
  return undefined;
}

export function isCurrentTopicLeaf(leaf: string): boolean {
  return TOPIC_HIERARCHY_LEAVES.includes(leaf.trim());
}

/** Resolve stored topic label (legacy or current) to a current hierarchy leaf if possible. */
export function resolveStorylineLeafLabel(stored: string): string | undefined {
  const trimmed = stored.trim();
  if (!trimmed) return undefined;
  if (TOPIC_HIERARCHY_LEAVES.includes(trimmed)) return trimmed;
  const key = normalizeTopicKey(trimmed);
  const current = CURRENT_TOPIC_BY_KEY.get(key);
  if (current) return current;
  if (LEGACY_TOPIC_BY_KEY.has(key)) {
    return LEGACY_TOPIC_BY_KEY.get(key) ?? undefined;
  }
  return undefined;
}

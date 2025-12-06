export interface TaxonomyNode {
  key: string;
  name: string;
  emoji?: string;
  children?: TaxonomyNode[];
}

export const TAXONOMY_TREE: TaxonomyNode[] = [
  {
    key: "bitcoin",
    name: "Bitcoin",
    emoji: "🪙",
    children: [
      { key: "1.1", name: "Bitcoin (BTC) - The Currency" },
      {
        key: "1.2",
        name: "Bitcoin Technology",
        children: [
          { key: "1.2.1", name: "Core Implementations" },
          { key: "1.2.2", name: "Major Upgrades" },
          { key: "1.2.3", name: "Bitcoin Improvement Proposals (BIPs)" },
          { key: "1.2.4", name: "Transaction Features" },
          { key: "1.2.5", name: "Layer 2 & Scaling" },
          { key: "1.2.6", name: "Mining & Consensus" },
        ],
      },
      { key: "1.3", name: "Bitcoin Forks" },
      { key: "1.4", name: "Bitcoin Companies & Services" },
    ],
  },
  {
    key: "money-economics",
    name: "Money & Economics",
    emoji: "💰",
    children: [
      { key: "2.1", name: "Other Cryptocurrencies" },
      { key: "2.2", name: "Stablecoins" },
      { key: "2.3", name: "DeFi Tokens" },
      { key: "2.4", name: "Metaverse & Gaming" },
      { key: "2.5", name: "Fiat Currencies" },
      { key: "2.6", name: "Commodities" },
      { key: "2.7", name: "Central Banks" },
      { key: "2.8", name: "Prices & Values" },
    ],
  },
  {
    key: "technology",
    name: "Technology Concepts",
    emoji: "⚡",
    children: [
      { key: "3.1", name: "Blockchain & Core Concepts" },
      { key: "3.2", name: "DeFi & Web3 Concepts" },
      { key: "3.3", name: "Security & Privacy" },
      { key: "3.4", name: "Wallets & Storage" },
      { key: "3.5", name: "Technical Standards" },
    ],
  },
  {
    key: "organizations",
    name: "Organizations & Companies",
    emoji: "🏢",
    children: [
      {
        key: "4.1",
        name: "Exchanges",
        children: [
          { key: "4.1.1", name: "Major Centralized Exchanges" },
          { key: "4.1.2", name: "Decentralized Exchanges (DEX)" },
          { key: "4.1.3", name: "Defunct Exchanges" },
        ],
      },
      {
        key: "4.2",
        name: "Financial Institutions",
        children: [
          { key: "4.2.1", name: "Investment Banks" },
          { key: "4.2.2", name: "Commercial Banks" },
          { key: "4.2.3", name: "Asset Managers" },
          { key: "4.2.4", name: "Stock Exchanges" },
        ],
      },
      {
        key: "4.3",
        name: "Mining Operations",
        children: [
          { key: "4.3.1", name: "Public Mining Companies" },
          { key: "4.3.2", name: "Mining Hardware Manufacturers" },
          { key: "4.3.3", name: "Mining Pools" },
        ],
      },
      {
        key: "4.4",
        name: "Payment & Infrastructure",
        children: [
          { key: "4.4.1", name: "Payment Processors" },
          { key: "4.4.2", name: "Custody & Wallets" },
          { key: "4.4.3", name: "Blockchain Infrastructure" },
          { key: "4.4.4", name: "Stablecoin Issuers" },
        ],
      },
      { key: "4.5", name: "DeFi Platforms" },
      { key: "4.6", name: "NFT Marketplaces" },
      {
        key: "4.7",
        name: "Technology Companies",
        children: [
          { key: "4.7.1", name: "Big Tech" },
          { key: "4.7.2", name: "Social Media & Communication" },
          { key: "4.7.3", name: "Fintech & Payments" },
          { key: "4.7.4", name: "E-commerce & Retail" },
          { key: "4.7.5", name: "Corporate Bitcoin Holders" },
        ],
      },
      { key: "4.8", name: "Media & Analytics" },
      { key: "4.9", name: "Development & Research" },
      { key: "4.10", name: "Other Organizations" },
    ],
  },
  {
    key: "people",
    name: "People",
    emoji: "👥",
    children: [
      { key: "5.1", name: "Crypto & Tech Figures" },
      { key: "5.2", name: "Government Officials" },
      { key: "5.3", name: "Investors & Analysts" },
      { key: "5.4", name: "Controversial & Famous Figures" },
    ],
  },
  {
    key: "regulation-law",
    name: "Regulation & Government",
    emoji: "⚖️",
    children: [
      { key: "6.1", name: "Regulatory Bodies" },
      { key: "6.2", name: "Laws & Frameworks" },
      { key: "6.3", name: "Government Initiatives" },
    ],
  },
  {
    key: "markets-geography",
    name: "Geography & Markets",
    emoji: "🌍",
    children: [
      { key: "7.1", name: "Countries & Regions" },
      { key: "7.2", name: "Cities & Special Locations" },
    ],
  },
  {
    key: "education-community",
    name: "Education & Community",
    emoji: "🎓",
    children: [
      { key: "8.1", name: "Development Organizations" },
      { key: "8.2", name: "Community Forums & Platforms" },
      { key: "8.3", name: "Research & Academia" },
    ],
  },
  {
    key: "crime-security",
    name: "Crime & Security",
    emoji: "🔒",
    children: [
      {
        key: "9.1",
        name: "Dark Web & Criminal Marketplaces",
      },
      {
        key: "9.2",
        name: "Major Crimes & Scams",
        children: [
          { key: "9.2.1", name: "Ponzi Schemes" },
          { key: "9.2.2", name: "Major Hacks" },
          { key: "9.2.3", name: "Fraud Cases" },
        ],
      },
      { key: "9.3", name: "Law Enforcement Actions" },
      { key: "9.4", name: "Security Concepts" },
    ],
  },
  {
    key: "topics",
    name: "Topics & Themes",
    emoji: "🏷️",
    children: [
      {
        key: "10.1",
        name: "Market Topics",
        children: [
          { key: "10.1.1", name: "Price & Valuation" },
          { key: "10.1.2", name: "Market Cycles" },
          { key: "10.1.3", name: "Trading Activity" },
        ],
      },
      { key: "10.2", name: "Regulatory Topics" },
      {
        key: "10.3",
        name: "Adoption & Integration",
        children: [
          { key: "10.3.1", name: "Institutional Adoption" },
          { key: "10.3.2", name: "Retail Adoption" },
          { key: "10.3.3", name: "Government Adoption" },
        ],
      },
      { key: "10.4", name: "Technology Topics" },
      { key: "10.5", name: "Mining Topics" },
      { key: "10.6", name: "Macroeconomic Topics" },
    ],
  },
  {
    key: "miscellaneous",
    name: "Miscellaneous",
    emoji: "📝",
    children: [{ key: "11.1", name: "Uncategorized" }],
  },
];

const NUMBER_TO_CATEGORY: Record<string, string> = {
  "1": "bitcoin",
  "2": "money-economics",
  "3": "technology",
  "4": "organizations",
  "5": "people",
  "6": "regulation-law",
  "7": "markets-geography",
  "8": "education-community",
  "9": "crime-security",
  "10": "topics",
  "11": "miscellaneous",
};

const LABEL_LOOKUP: Record<string, string> = {};
const MAIN_CATEGORY_META: Record<string, { name: string; emoji?: string }> = {};

function buildLabelLookup(nodes: TaxonomyNode[]) {
  for (const node of nodes) {
    LABEL_LOOKUP[node.key] = node.name;
    if (!node.key.includes(".")) {
      MAIN_CATEGORY_META[node.key] = { name: node.name, emoji: node.emoji };
    }
    if (node.children) {
      buildLabelLookup(node.children);
    }
  }
}

buildLabelLookup(TAXONOMY_TREE);

export function getTaxonomyLabel(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return LABEL_LOOKUP[key] || key;
}

export function getCategoryKeyFromPath(path: string[] | null | undefined, fallback?: string): string | undefined {
  if (path && path.length > 0) {
    const firstSegment = path[0];
    const prefix = firstSegment.split(".")[0];
    return NUMBER_TO_CATEGORY[prefix] || fallback;
  }
  return fallback;
}

export function getCategoryDisplayMeta(key: string): { name: string; emoji?: string } {
  return MAIN_CATEGORY_META[key] || { name: LABEL_LOOKUP[key] || key };
}

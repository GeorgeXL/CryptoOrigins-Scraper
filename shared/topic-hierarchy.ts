export type TopicHierarchyGroup = {
  name: string;
  description: string;
  leaves: string[];
};

export const TOPIC_HIERARCHY: TopicHierarchyGroup[] = [
  {
    name: "Bitcoin",
    description: "Bitcoin-native history, protocol, network, mining, wallets, scaling, and adoption.",
    leaves: [
      "Early Bitcoin history",
      "Satoshi identity",
      "Protocol development",
      "Bitcoin Core",
      "BIPs and upgrades",
      "Soft forks and hard forks",
      "Mining evolution",
      "Mining pools",
      "Mining companies",
      "Halving events",
      "Wallet development",
      "Scaling and Layer 2",
      "Node infrastructure",
      "Privacy and self-custody",
      "Bitcoin adoption",
    ],
  },
  {
    name: "Markets",
    description: "Price, cycles, liquidity, trading, and investment products.",
    leaves: [
      "Bitcoin price action",
      "Market cycles",
      "Liquidity and flows",
      "Institutional inflows",
      "Trading activity",
      "Derivatives",
      "ETFs and investment products",
      "Safe haven narrative",
    ],
  },
  {
    name: "Macro & Policy",
    description: "Macroeconomic context, government action, regulation, legal disputes, tax, and public policy.",
    leaves: [
      "Inflation",
      "Interest rates",
      "Monetary policy",
      "Central banks",
      "Banking stress",
      "Debt crises",
      "Labor market",
      "Housing",
      "Bailouts and stimulus",
      "Global growth and recession",
      "Bitcoin regulation",
      "Securities regulation",
      "Banking regulation",
      "Tax policy",
      "Sanctions and state actions",
      "Legal cases",
      "Politics and elections",
      "Government adoption",
      "CBDCs",
    ],
  },
  {
    name: "Companies & Adoption",
    description: "Companies, infrastructure, payments, custody, business adoption, and service-provider failures.",
    leaves: [
      "Exchanges",
      "Custody",
      "Payment processors",
      "Merchant adoption",
      "Financial institutions",
      "Corporate treasury adoption",
      "Startup funding",
      "Enterprise blockchain adoption",
      "Data and analytics",
      "Exchange failures",
      "Hacks and exploits",
      "Fraud and scams",
      "Law enforcement",
      "Operational security",
    ],
  },
  {
    name: "Other Crypto",
    description: "Non-Bitcoin crypto only when it is historically relevant enough to include.",
    leaves: [
      "Altcoin ecosystems",
      "Layer 1 networks",
      "Ethereum and smart contracts",
      "Stablecoins",
      "DeFi",
      "NFTs and gaming",
      "Cross-chain infrastructure",
    ],
  },
];

export const TOPIC_HIERARCHY_ROOTS = TOPIC_HIERARCHY.map((group) => group.name);
export const TOPIC_HIERARCHY_LEAVES = TOPIC_HIERARCHY.flatMap((group) => group.leaves);

export function topicGroupForLeaf(leaf: string): string | undefined {
  for (const group of TOPIC_HIERARCHY) {
    if (group.leaves.includes(leaf)) return group.name;
  }
  return undefined;
}

/** Display label for a hierarchy leaf, including its parent group. */
export function formatTopicLeafWithGroup(leaf: string): string {
  const group = topicGroupForLeaf(leaf);
  return group ? `${group} › ${leaf}` : leaf;
}


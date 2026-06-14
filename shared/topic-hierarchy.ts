export type TopicHierarchyGroup = {
  name: string;
  description: string;
  leaves: string[];
};

/** Current production storyline hierarchy (2026-06). */
export const TOPIC_HIERARCHY: TopicHierarchyGroup[] = [
  {
    name: "Bitcoin",
    description: "Bitcoin-native history, protocol, network, mining, wallets, scaling, and adoption.",
    leaves: [
      "Early Bitcoin history",
      "Satoshi identity",
      "Halving events",
      "Protocol & upgrades",
      "Bitcoin mining",
      "Wallets & self-custody",
      "Bitcoin adoption",
      "Scaling and Layer 2",
    ],
  },
  {
    name: "Markets",
    description: "Bitcoin as a tradable asset: price, venues, institutions, derivatives, and investment products.",
    leaves: [
      "Bitcoin price & cycles",
      "Exchanges",
      "Institutional Bitcoin & flows",
      "Derivatives",
      "ETFs and investment products",
    ],
  },
  {
    name: "Macroeconomy",
    description: "Macroeconomic backdrop. No Bitcoin or crypto events unless macro is the headline.",
    leaves: [
      "Inflation",
      "Monetary policy & rates",
      "Banking stress",
      "Debt crises",
      "Labor market",
      "Housing",
      "Bailouts and stimulus",
      "Global growth and recession",
      "Politics and elections",
    ],
  },
  {
    name: "Crypto policy & regulation",
    description: "Government and regulator actions concerning crypto, plus enforcement.",
    leaves: [
      "Bitcoin regulation",
      "Securities regulation",
      "Tax policy",
      "Banking & prudential (crypto)",
      "Sanctions and enforcement",
      "Legal cases",
      "Government adoption",
      "CBDCs",
      "Enforcement & crime",
    ],
  },
  {
    name: "Web3 & other crypto",
    description: "Non-Bitcoin crypto when historically relevant enough to include.",
    leaves: [
      "Smart contracts & L1s",
      "Stablecoins",
      "DeFi",
      "NFTs and gaming",
      "Cross-chain and bridges",
      "Web3 industry and funding",
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

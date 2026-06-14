import { TOPIC_HIERARCHY, TOPIC_HIERARCHY_LEAVES, topicGroupForLeaf } from "./topic-hierarchy";

export type MainEventsLeafPromptRule = {
  include: string;
  exclude: string;
};

/**
 * Per-leaf Gemini guidance for Main events check canonical lists.
 * Keep in sync with TOPIC_HIERARCHY leaves.
 */
export const MAIN_EVENTS_LEAF_PROMPT_RULES: Record<string, MainEventsLeafPromptRule> = {
  "Early Bitcoin history": {
    include:
      "Origin-era milestones: genesis block, first client, first transaction, pizza day, Satoshi's last public activity.",
    exclude:
      "Do not list halvings (Halving events), exchange launches (Exchanges), or price milestones (Bitcoin price & cycles).",
  },
  "Satoshi identity": {
    include: "Satoshi disappearances, claimed identities, investigations, and court cases about who Satoshi is.",
    exclude: "Do not list protocol upgrades, mining, or price events.",
  },
  "Halving events": {
    include: "Only the four Bitcoin block subsidy halving dates (2012-11-28, 2016-07-09, 2020-05-11, 2024-04-20). Exactly four rows total.",
    exclude:
      "Do not list pre-halving hype, post-halving fee stories, Litecoin/BCH/BSV halvings, or mining prep — those belong on Bitcoin mining or Bitcoin price & cycles. No other leaf may assign rows here.",
  },
  "Protocol & upgrades": {
    include:
      "Bitcoin Core releases, BIPs, soft/hard forks, SegWit, Taproot, block-size wars, and protocol governance.",
    exclude: "Do not list halvings, mining pool launches, wallet products, or BTC price milestones.",
  },
  "Bitcoin mining": {
    include: "Mining tech shifts (CPU/GPU/ASIC), major pools, and industrial mining companies.",
    exclude:
      "Do not list halving block-subsidy dates (Halving events — four dates only, never assign rows there from other scripts). No exchange events.",
  },
  "Wallets & self-custody": {
    include: "Wallet software and hardware milestones, privacy wallets, CoinJoin, custody tools for users.",
    exclude: "Do not list institutional custody (Institutional Bitcoin & flows) or protocol upgrades.",
  },
  "Bitcoin adoption": {
    include:
      "Merchants, payment processors, donations, corporate acceptance, and mainstream use of Bitcoin as money.",
    exclude:
      "Do not list government legal tender (Government adoption), tradfi products (Institutional Bitcoin & flows), or price ATHs.",
  },
  "Scaling and Layer 2": {
    include: "Lightning Network, sidechains, and Bitcoin L2/scaling research milestones.",
    exclude: "Do not list Ethereum L2s or unrelated altcoin scaling.",
  },
  "Bitcoin price & cycles": {
    include: "BTC price milestones, market cycles, crashes, ATHs, and trading-structure firsts tied to price.",
    exclude:
      "Do not list exchange founding/failure (Exchanges), ETF approvals (ETFs and investment products), or halving block-reward facts alone.",
  },
  Exchanges: {
    include:
      "Exchange founding, launch, licensing, hacks, insolvency, withdrawal halts, and shutdowns — full venue lifecycle.",
    exclude:
      "Do not list pure BTC price milestones unless the headline is the exchange event itself.",
  },
  "Institutional Bitcoin & flows": {
    include:
      "Custody launches, bank/tradfi BTC products, corporate treasury buys, liquidity and institutional flow landmarks.",
    exclude: "Do not list ETF approvals (ETFs leaf) or retail merchant adoption (Bitcoin adoption).",
  },
  Derivatives: {
    include: "Bitcoin futures, options, perps, and regulated derivatives milestones.",
    exclude: "Do not list spot ETF approvals or exchange hacks.",
  },
  "ETFs and investment products": {
    include: "GBTC, spot/futures ETF approvals, trusts, and listed BTC investment products.",
    exclude: "Do not list corporate treasury purchases or exchange launches.",
  },
  Inflation: {
    include: "Major inflation prints, targets, and shocks in major economies.",
    exclude: "Do not list any Bitcoin or cryptocurrency event.",
  },
  "Monetary policy & rates": {
    include: "Central bank rate decisions, QE/taper, and major monetary policy shifts.",
    exclude: "Do not list crypto regulation or Bitcoin price events.",
  },
  "Banking stress": {
    include: "Bank failures, rescues, and systemic banking stress (Lehman, SVB, etc.).",
    exclude: "Do not list crypto exchange failures unless a tradfi bank is the headline.",
  },
  "Debt crises": {
    include: "Sovereign debt crises, debt ceiling standoffs, and major default/restructuring events.",
    exclude: "Do not list Bitcoin or crypto.",
  },
  "Labor market": {
    include: "Major labor-market shifts: unemployment spikes, strikes, jobs reports that moved macro narrative.",
    exclude: "Do not pad with Bitcoin genesis, halvings, or crypto events.",
  },
  Housing: {
    include: "Housing-market and mortgage crises or major policy shifts.",
    exclude: "Do not list crypto real-estate stunts unless macro housing is the headline.",
  },
  "Bailouts and stimulus": {
    include: "Fiscal bailouts, stimulus packages, and emergency economic programs.",
    exclude: "Do not list crypto.",
  },
  "Global growth and recession": {
    include: "Recessions, recoveries, and global growth shocks.",
    exclude: "Do not list crypto.",
  },
  "Politics and elections": {
    include: "Elections, geopolitical shifts, and macro-relevant political turning points.",
    exclude: "Do not list crypto-specific law unless politics is the macro headline.",
  },
  "Bitcoin regulation": {
    include: "Laws, bans, and regulator actions specifically targeting Bitcoin.",
    exclude: "Do not list generic macro central-bank meetings without a crypto angle.",
  },
  "Securities regulation": {
    include: "SEC/CFTC and securities rules affecting crypto markets and products.",
    exclude: "Do not list spot macro events.",
  },
  "Tax policy": {
    include: "Tax law and guidance affecting crypto.",
    exclude: "Do not list non-tax macro.",
  },
  "Banking & prudential (crypto)": {
    include: "Banking rules for crypto custody, capital treatment, and prudential guidance.",
    exclude: "Do not list generic Fed meetings.",
  },
  "Sanctions and enforcement": {
    include: "Sanctions, OFAC actions, and state enforcement against crypto actors.",
    exclude: "Do not list exchange insolvency unless sanctions are the headline.",
  },
  "Legal cases": {
    include: "Major court cases and rulings about crypto.",
    exclude: "Do not list criminal fraud without a landmark legal ruling.",
  },
  "Government adoption": {
    include: "Nation-state adoption, legal tender, strategic reserves, and public-sector BTC use.",
    exclude: "Do not list private merchant adoption (Bitcoin adoption).",
  },
  CBDCs: {
    include: "Central bank digital currency launches, pilots, and major CBDC policy shifts.",
    exclude: "Do not list Bitcoin-only events unless CBDC is the headline.",
  },
  "Enforcement & crime": {
    include: "Major prosecutions, seizures, mixer bans, and landmark fraud/Ponzi cases.",
    exclude:
      "Exchange operational collapse without a criminal/enforcement angle → Exchanges. DeFi hacks → DeFi.",
  },
  "Smart contracts & L1s": {
    include: "Ethereum and other L1 launches, upgrades, merges, and major altcoin ecosystem milestones.",
    exclude: "Do not list Bitcoin protocol events or DeFi protocol-specific launches (use DeFi).",
  },
  Stablecoins: {
    include: "Stablecoin launches, peg breaks, and regulatory moments (UST, USDC, etc.).",
    exclude: "Do not list Bitcoin events.",
  },
  DeFi: {
    include: "DeFi protocol launches, hacks, and governance milestones.",
    exclude: "Do not list Bitcoin or centralized exchange events.",
  },
  "NFTs and gaming": {
    include: "NFT marketplaces, collections, and crypto gaming milestones.",
    exclude: "Do not list Bitcoin.",
  },
  "Cross-chain and bridges": {
    include: "Bridges, interoperability protocols, and cross-chain hacks.",
    exclude: "Do not list Bitcoin L2 (Scaling and Layer 2).",
  },
  "Web3 industry and funding": {
    include: "Major VC rounds and industry-scale web3 company milestones.",
    exclude: "Do not list Bitcoin mining companies or BTC tradfi (Institutional Bitcoin & flows).",
  },
};

export function mainEventsLeafPromptRules(leaf: string): MainEventsLeafPromptRule {
  return (
    MAIN_EVENTS_LEAF_PROMPT_RULES[leaf] ?? {
      include: "Landmark dates where this storyline is the primary headline.",
      exclude: "Do not duplicate events that belong primarily on sibling leaves.",
    }
  );
}

/** Single-leaf guidance block for agent prompts (fit checks, alignment, etc.). */
export function formatTopicLeafAgentGuidance(leaf: string): string {
  const rules = mainEventsLeafPromptRules(leaf);
  const group = topicGroupForLeaf(leaf);
  const header = group ? `${group} › ${leaf}` : leaf;
  return `${header}\nInclude: ${rules.include}\nExclude: ${rules.exclude}`;
}

/**
 * Full hierarchy prompt for topic-assignment agents — group context plus per-leaf include/exclude rules.
 */
export function buildTopicHierarchyAgentPromptBlock(): string {
  return TOPIC_HIERARCHY.map((group) => {
    const leafBlocks = group.leaves
      .map((leaf) => {
        const rules = mainEventsLeafPromptRules(leaf);
        return `  - ${leaf}\n    Include: ${rules.include}\n    Exclude: ${rules.exclude}`;
      })
      .join("\n");
    return `${group.name} — ${group.description}\n${leafBlocks}`;
  }).join("\n\n");
}

/** Warn in dev if rules drift from hierarchy. */
export function assertMainEventsLeafPromptRulesComplete(): void {
  for (const leaf of TOPIC_HIERARCHY_LEAVES) {
    if (!MAIN_EVENTS_LEAF_PROMPT_RULES[leaf]) {
      throw new Error(`Missing MAIN_EVENTS_LEAF_PROMPT_RULES for leaf: ${leaf}`);
    }
  }
}

export type StoryHierarchySection = {
  name: string;
  leaves: string[];
};

export type StoryHierarchyPillar = {
  name: string;
  sections: StoryHierarchySection[];
};

/** Editorial story lines stored on `historical_news_analyses.story_line`. */
export const STORY_HIERARCHY: StoryHierarchyPillar[] = [
  {
    name: "Bitcoin",
    sections: [
      {
        name: "Origins a Satoshi",
        leaves: [
          "Genesis and Hal Finney",
          "Early developers",
          "Early Bitcoin community",
          "Satoshi exit",
          "Dorian Nakamoto",
          "Craig Wright",
          "HBO Satoshi",
          "Satoshi statue",
          "Bitcoin logo",
          "WikiLeaks and Bitcoin",
        ],
      },
      {
        name: "Kultura a příběhy",
        leaves: [
          "Pizza Day",
          "Bitcoin memes and folklore",
          "Giving bitcoin away",
          "Accepted then reversed",
          "Legendary wallets",
        ],
      },
      {
        name: "Ztracené coiny",
        leaves: ["Lost coins", "James Howells", "Stefan Thomas"],
      },
      {
        name: "Protokol a technika",
        leaves: [
          "Protocol upgrades",
          "Survival bugs",
          "Block size wars",
          "Bitcoin Cash forks",
          "Halvings",
          "Lightning Network",
          "Colored Coins",
          "Ordinals and inscriptions",
          "BRC-20 and Runes",
        ],
      },
      {
        name: "Mining",
        leaves: ["Mining and energy", "Mining industry", "China mining ban"],
      },
      {
        name: "Burzy, hacky a darknet",
        leaves: [
          "Mt. Gox",
          "Exchanges and founders",
          "Exchange hacks 2011\u20132016",
          "Bitfinex hack",
          "Bitcoinica",
          "Silk Road",
        ],
      },
      {
        name: "Adopce",
        leaves: [
          "Merchants accepting bitcoin",
          "Bitcoin in the physical world",
          "Physical bitcoin and hardware wallets",
          "Bitcoin towns and cities",
          "El Salvador bitcoin",
          "Corporate bitcoin treasuries",
          "Bitcoin price milestones",
        ],
      },
    ],
  },
  {
    name: "Web3",
    sections: [
      {
        name: "Rané altcoiny a sítě",
        leaves: [
          "Early altcoins",
          "Namecoin and Monegraph",
          "Mastercoin",
          "Counterparty and Rare Pepe",
          "Ripple and Stellar",
          "Dogecoin",
          "Alt layer-1 networks",
          "Solana",
          "Helium",
          "Worldcoin",
        ],
      },
      {
        name: "Ethereum",
        leaves: [
          "Ethereum launch",
          "Ethereum upgrades",
          "Ethereum layer 2s",
          "L2 airdrops",
          "The DAO",
          "Parity hacks",
          "ICO boom",
          "ENS",
          "Lido and stETH",
          "Restaking",
          "MEV and Flashbots",
        ],
      },
      {
        name: "DeFi",
        leaves: [
          "MakerDAO and Dai",
          "Uniswap",
          "SushiSwap",
          "Curve",
          "Yield farming",
          "Chainlink",
          "EtherDelta",
          "DeFi governance interventions",
          "Tornado Cash",
        ],
      },
      {
        name: "Exploity a hacky",
        leaves: [
          "Smart contract exploits",
          "Poly Network",
          "Ronin",
          "Wormhole",
          "Nomad",
          "Euler",
          "Mango Markets",
          "Cream Finance",
          "KyberSwap",
        ],
      },
      {
        name: "Původ NFT",
        leaves: [
          "Genesis Pepe",
          "Dorsey first tweet",
          "Early Ethereum NFTs",
          "CryptoPunks",
          "CryptoKitties",
          "ERC-721",
          "Early NFT marketplaces",
        ],
      },
      {
        name: "NFT umění",
        leaves: ["Art Blocks", "Async Art", "Beeple", "Pak", "Burned art", "Checks VV", "Terraforms"],
      },
      {
        name: "NFT kolekce a kultura",
        leaves: [
          "Bored Ape Yacht Club",
          "Pudgy Penguins",
          "Nouns",
          "Meme NFTs",
          "Collector DAOs",
          "Music NFTs",
          "Sports NFTs",
          "Brand NFTs and loyalty",
        ],
      },
      {
        name: "NFT trh",
        leaves: ["NFT marketplace wars", "NFT crash", "NFT disputes and mistakes"],
      },
      {
        name: "Metaverse a hry",
        leaves: ["Decentraland", "Virtual land", "Play-to-earn"],
      },
      {
        name: "Infrastruktura a aplikace",
        leaves: ["Decentralized storage", "Phone and browser wallets", "Web3 social"],
      },
    ],
  },
  {
    name: "Macro",
    sections: [
      {
        name: "Centrální banky a krize",
        leaves: [
          "Central banks and cheap money",
          "Bank runs and capital controls",
          "Covid crash 2020",
          "2022\u201323 rates and bank failures",
          "Crashes and flash crashes",
        ],
      },
      {
        name: "Regulace a státy",
        leaves: [
          "US regulators and crypto",
          "Asia crypto regulation",
          "MiCA and UK rules",
          "Ripple v SEC",
          "Governments adopting bitcoin",
          "Government bitcoin sales",
          "CBDCs",
          "Ukraine crypto aid",
        ],
      },
      {
        name: "Instituce a Wall Street",
        leaves: [
          "Bitcoin ETFs",
          "Public crypto companies",
          "Public pensions and crypto",
          "Bank custody and trading",
          "Bank blockchain rails",
          "Tokenized bonds and funds",
          "Enterprise blockchain",
          "Crypto derivatives",
        ],
      },
      {
        name: "Stablecoiny a platby",
        leaves: [
          "Tether",
          "USDC",
          "BUSD",
          "Libra/Diem",
          "Card networks and stablecoins",
          "Crypto payment processors",
          "Fintech apps and crypto",
          "Crypto banking",
        ],
      },
      {
        name: "Pády, podvody a soudy",
        leaves: [
          "FTX",
          "2022 contagion",
          "Terra/Luna",
          "Binance and CZ",
          "Executives in court",
          "QuadrigaCX",
          "OneCoin",
          "BitConnect",
          "PlusToken",
          "Exchange hacks 2018\u20132024",
        ],
      },
      {
        name: "Mainstream",
        leaves: ["Crypto sports sponsorships", "Crypto charity and crowdfunding"],
      },
    ],
  },
];

export const STORY_HIERARCHY_LEAVES = STORY_HIERARCHY.flatMap((pillar) =>
  pillar.sections.flatMap((section) => section.leaves),
);

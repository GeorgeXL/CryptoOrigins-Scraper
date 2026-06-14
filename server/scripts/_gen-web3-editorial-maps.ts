/**
 * Editorial TARGET_BY_DATE generator for Web3 & other crypto leaves.
 * Rules from shared/main-events-leaf-prompts.ts — no storyline-fit-heuristics.
 */
import "dotenv/config";
import { storage } from "../storage";

type Leaf =
  | "Smart contracts & L1s"
  | "Stablecoins"
  | "DeFi"
  | "NFTs and gaming"
  | "Cross-chain and bridges"
  | "Web3 industry and funding";

const BTC_HALVING = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

function hasBitcoinHeadline(s: string) {
  return /\b(bitcoin|btc|satoshi|bitpay|coinbase|lightning network|halving)\b/i.test(s);
}

function isMacroOffTopic(s: string) {
  return /\b(lawrence summers|iraqi oil|g8 and g20|senator dodd|health-care firms hire|shadow chancellor|tobin tax|debt control plan|brazil emerges as latin america|hdcp master key|violent protests spread nationwide|imf offers|pharma waste)\b/i.test(
    s,
  );
}

/** Per-leaf editorial overrides (checked first). */
const OVERRIDES: Partial<Record<Leaf, Record<string, string | null>>> = {
  "Smart contracts & L1s": {
    "2009-04-04": null,
    "2009-12-12": null,
    "2010-06-02": null,
    "2011-09-07": "Early Bitcoin history",
    "2012-04-07": "Smart contracts & L1s",
    "2015-10-02": "Protocol & upgrades",
    "2017-08-12": "Protocol & upgrades",
    "2017-08-20": "Bitcoin price & cycles",
    "2018-06-08": "Protocol & upgrades",
    "2018-06-09": "Smart contracts & L1s",
    "2018-10-18": "Protocol & upgrades",
    "2018-11-04": "Protocol & upgrades",
    "2018-11-07": "Bitcoin price & cycles",
    "2019-04-20": "Satoshi identity",
    "2019-11-15": "Protocol & upgrades",
    "2020-01-04": "Bitcoin mining",
    "2020-05-15": "Stablecoins",
    "2020-05-17": "Stablecoins",
    "2020-07-17": "DeFi",
    "2020-09-05": "DeFi",
    "2020-09-16": "DeFi",
    "2020-10-12": "DeFi",
    "2021-04-10": "Bitcoin price & cycles",
    "2021-07-16": "DeFi",
    "2022-01-17": "DeFi",
    "2022-04-11": "DeFi",
    "2022-05-10": "Stablecoins",
    "2022-05-23": "NFTs and gaming",
    "2022-09-14": "Smart contracts & L1s",
    "2022-12-08": "DeFi",
    "2023-01-29": "Bitcoin price & cycles",
    "2023-05-15": "Protocol & upgrades",
    "2023-07-16": "Stablecoins",
    "2023-10-28": "Smart contracts & L1s",
    "2024-04-04": "Smart contracts & L1s",
    "2024-08-14": "Institutional Bitcoin & flows",
    "2013-08-04": "Exchanges",
    "2013-10-12": "Exchanges",
    "2014-05-31": "Smart contracts & L1s",
    "2023-07-31": "Cross-chain and bridges",
    "2013-01-05": "Bitcoin price & cycles",
    "2019-01-07": "Smart contracts & L1s",
    "2019-03-08": "Smart contracts & L1s",
    "2019-11-30": "Enforcement & crime",
    "2021-07-22": "Smart contracts & L1s",
    "2022-12-21": "Smart contracts & L1s",
    "2024-06-11": "Web3 industry and funding",
    "2018-04-08": "Smart contracts & L1s",
    "2018-07-15": "Web3 industry and funding",
    "2020-01-04": "Bitcoin mining",
    "2022-05-01": "Smart contracts & L1s",
    "2022-07-06": "Bitcoin mining",
    "2022-11-05": "Bitcoin mining",
  },
  Stablecoins: {
    "2013-01-12": "Smart contracts & L1s",
    "2020-06-01": null,
    "2020-10-22": "DeFi",
    "2020-11-02": "Bitcoin price & cycles",
    "2023-03-20": "Government adoption",
    "2023-05-25": "Scaling and Layer 2",
    "2024-05-13": "Bitcoin price & cycles",
    "2024-12-04": "Stablecoins",
    "2023-07-16": "Stablecoins",
  },
  DeFi: {
    "2009-07-05": null,
    "2009-08-15": "Global growth and recession",
    "2009-09-19": "Global growth and recession",
    "2009-12-14": "Debt crises",
    "2022-02-14": "Smart contracts & L1s",
    "2022-04-04": "Cross-chain and bridges",
    "2022-12-15": "Institutional Bitcoin & flows",
  },
  "NFTs and gaming": {
    "2009-05-26": null,
    "2014-05-05": null,
    "2015-04-01": "Enforcement & crime",
    "2016-04-05": "Bitcoin adoption",
    "2016-09-04": "Bitcoin adoption",
    "2017-12-03": "Smart contracts & L1s",
    "2021-11-12": null,
    "2022-05-01": "Smart contracts & L1s",
    "2023-03-22": "Scaling and Layer 2",
  },
  "Cross-chain and bridges": {
    "2010-09-14": null,
    "2012-10-10": null,
    "2016-01-12": "Enforcement & crime",
    "2014-04-21": "Bitcoin adoption",
    "2015-08-08": "Bitcoin adoption",
    "2015-08-14": "Smart contracts & L1s",
    "2016-08-20": "Bitcoin adoption",
    "2016-09-09": "Bitcoin adoption",
    "2016-11-30": "Institutional Bitcoin & flows",
    "2017-06-20": "Bitcoin adoption",
    "2018-03-04": "Bitcoin adoption",
    "2018-03-12": "Bitcoin adoption",
    "2019-02-17": "Bitcoin adoption",
    "2019-12-11": "Web3 industry and funding",
    "2020-04-24": "Bitcoin price & cycles",
    "2020-12-14": "Scaling and Layer 2",
    "2021-03-25": "CBDCs",
    "2022-03-23": "DeFi",
    "2022-03-31": "Smart contracts & L1s",
    "2022-05-04": "Smart contracts & L1s",
    "2022-04-04": "Cross-chain and bridges",
    "2023-03-03": "Cross-chain and bridges",
    "2024-11-15": "DeFi",
    "2013-12-24": "Exchanges",
    "2023-07-31": "Cross-chain and bridges",
  },
  "Web3 industry and funding": {
    "2009-11-10": "Politics and elections",
    "2011-12-13": "Exchanges",
    "2012-04-15": "Bitcoin adoption",
    "2012-09-26": "Exchanges",
    "2013-03-31": "Securities regulation",
    "2013-05-16": "Bitcoin adoption",
    "2013-05-20": "Smart contracts & L1s",
    "2013-06-08": "Exchanges",
    "2013-07-11": "Web3 industry and funding",
    "2013-09-18": "Exchanges",
    "2013-12-13": "Exchanges",
    "2014-01-19": "Exchanges",
    "2014-04-24": "Bitcoin adoption",
    "2014-05-11": "Exchanges",
    "2014-07-08": "Wallets & self-custody",
    "2014-08-11": "Exchanges",
    "2014-08-19": "Exchanges",
    "2014-10-20": "Bitcoin adoption",
    "2014-11-18": "Scaling and Layer 2",
    "2014-12-31": "Web3 industry and funding",
    "2015-01-20": "Exchanges",
    "2015-03-13": "Bitcoin mining",
    "2015-04-07": "Protocol & upgrades",
    "2015-06-10": "Bitcoin adoption",
    "2015-07-21": "Exchanges",
    "2015-09-28": "Smart contracts & L1s",
    "2015-10-27": "Institutional Bitcoin & flows",
    "2016-02-02": "Scaling and Layer 2",
    "2016-02-04": "Web3 industry and funding",
    "2016-02-07": "Exchanges",
    "2016-04-18": "Exchanges",
    "2016-04-29": "Institutional Bitcoin & flows",
    "2016-05-22": "Smart contracts & L1s",
    "2016-07-15": "Smart contracts & L1s",
    "2016-09-11": null,
    "2016-09-16": "Bitcoin adoption",
    "2016-09-27": "Exchanges",
    "2016-09-30": "Exchanges",
    "2016-10-10": "Exchanges",
    "2017-06-22": "Wallets & self-custody",
    "2017-06-24": "Smart contracts & L1s",
    "2018-08-15": "Bitcoin mining",
    "2018-12-31": "ETFs and investment products",
    "2022-03-09": "Tax policy",
    "2022-06-07": "DeFi",
    "2016-01-13": "Web3 industry and funding",
    "2016-09-30": "Exchanges",
    "2015-01-19": "Government adoption",
    "2015-04-15": "Government adoption",
    "2015-07-01": "Web3 industry and funding",
    "2018-04-30": "Web3 industry and funding",
    "2015-03-12": "Web3 industry and funding",
    "2016-01-08": "Web3 industry and funding",
    "2017-01-30": "Web3 industry and funding",
    "2018-07-15": "Web3 industry and funding",
    "2018-08-01": "Web3 industry and funding",
    "2019-12-11": "Web3 industry and funding",
    "2020-06-02": "Web3 industry and funding",
    "2021-06-01": "Web3 industry and funding",
    "2022-02-21": "NFTs and gaming",
    "2022-05-25": "Web3 industry and funding",
  },
};

function classifySmartContractsL1s(date: string, s: string): string | null {
  const leaf: Leaf = "Smart contracts & L1s";
  if (OVERRIDES[leaf]?.[date] !== undefined) return OVERRIDES[leaf]![date]!;
  if (!s.trim()) return null;
  if (isMacroOffTopic(s)) return null;
  if (BTC_HALVING.has(date)) return "Halving events";

  if (/\b(bitcoin core|bitcoin unlimited|bitcoin knots|segwit2x|block size war|bip[\s-]?\d.*bitcoin|taproot.*bitcoin)\b/i.test(s) && !/\b(ethereum|eth |solana|cardano)\b/i.test(s))
    return "Protocol & upgrades";
  if (/\b(bitcoin cash|bitcoin sv|bitcoin gold|bitcoin private|bchabc|bchn)\b/i.test(s) && /\b(halving|51% attack|stress test|zero-fee|cashtokens|unlimited releases)\b/i.test(s)) {
    if (/\b(halving|51%|stress test)\b/i.test(s)) return "Smart contracts & L1s";
    return "Protocol & upgrades";
  }
  if (/\b(bitcoin hash rate|bitcoin mining difficulty|bitcoin outpaces)\b/i.test(s)) return "Bitcoin mining";
  if (/\b(bitcoin surges|bitcoin climbs|bitcoin dominance|bitcoin outpaces ether)\b/i.test(s)) return "Bitcoin price & cycles";
  if (/\b(craig wright|satoshi identity)\b/i.test(s)) return "Satoshi identity";
  if (/\b(cbbtc|wbtc|institutional.*bitcoin)\b/i.test(s) && !/\b(ethereum|eth )\b/i.test(s)) return "Institutional Bitcoin & flows";

  if (/\b(stablecoin|usdt|usdc|ust |depeg|tether|dai |gho |busd|paypal usd|visa.*stablecoin)\b/i.test(s)) return "Stablecoins";
  if (/\b(uniswap|aave|compound|yearn|sushiswap|defichain|curve finance|makerdao|liquidity mining|flash loan|yield farm|chef nomi|yfi |sushi)\b/i.test(s))
    return "DeFi";
  if (/\b(nft|cryptopunks|gamestop.*wallet|magic eden ordinals)\b/i.test(s)) return "NFTs and gaming";
  if (/\b(bridge|ccip|cross-chain|omnichain|ibc )\b/i.test(s) && !/\b(l1 launch|mainnet launch|hard fork)\b/i.test(s)) return "Cross-chain and bridges";
  if (/\b(raises \$|seed round|series [a-z] funding|venture capital|vc fund)\b/i.test(s) && !/\b(ethereum|solana|mainnet|hard fork|merge)\b/i.test(s))
    return "Web3 industry and funding";

  if (/\b(i0coin|litecoin|dogecoin|ethereum|eth |solana|cardano|polkadot|monero|ripple|xrp|eos |tezos|avalanche|cosmos|binance chain|bnb chain|polygon|arbitrum|optimism|zksync|filecoin|zcash|dash |stellar|chainlink|namecoin|decred|counterparty|huntercoin|primecoin|quark|ravencoin|kaspa|expanse|golem|steem|waves|iota|tron|terra|luna|near |aptos|sui |sei |multiversx|syscoin|ergo|fraxtal|dydx chain|arweave|kaspa)\b/i.test(s))
    return leaf;
  if (/\b(mainnet launch|hard fork|merge|upgrade|genesis|l1 |layer-1|layer 1|proof.of.stake|proof.of.work transition|byzantium|homestead|london upgrade|shanghai|arrow glacier|constantinople|spurious dragon|tangerine whistle|shelley|alonz|vasil|beacon chain|parachain|rollup|evm)\b/i.test(s))
    return leaf;
  if (/\b(altcoin|meme coin|meme-driven token)\b/i.test(s)) return leaf;
  if (/\b(blockchain lab|digital currency initiative|mit.*digital currency)\b/i.test(s) && !hasBitcoinHeadline(s)) return leaf;

  if (hasBitcoinHeadline(s) && !/\b(ethereum|eth |solana|altcoin|dogecoin|litecoin|xrp|ripple)\b/i.test(s)) {
    if (/\b(protocol|fork|bip|upgrade|release)\b/i.test(s)) return "Protocol & upgrades";
    if (/\b(mining|hash rate|asic)\b/i.test(s)) return "Bitcoin mining";
    if (/\b(price|ath|surge|crash)\b/i.test(s)) return "Bitcoin price & cycles";
    if (/\b(merchant|payment|accept)\b/i.test(s)) return "Bitcoin adoption";
    return "Protocol & upgrades";
  }

  return leaf;
}

function classifyStablecoins(date: string, s: string): string | null {
  const leaf: Leaf = "Stablecoins";
  if (OVERRIDES[leaf]?.[date] !== undefined) return OVERRIDES[leaf]![date]!;
  if (!s.trim()) return null;
  if (isMacroOffTopic(s)) return null;

  if (/\b(bitcoin climbs|bitcoin subreddit|digital yuan|china's digital yuan)\b/i.test(s) && !/\b(stablecoin|usdt|usdc|tether|dai|ust|peg)\b/i.test(s))
    return "Bitcoin price & cycles";
  if (/\b(bitcoin-backed lending|hodl hodl.*borrow)\b/i.test(s)) return "DeFi";
  if (/\b(bitcoin ordinals|brc-20|liquid network)\b/i.test(s)) return "Scaling and Layer 2";
  if (/\b(government adoption|african crypto adoption|car as an example)\b/i.test(s)) return "Government adoption";
  if (/\b(freicoin|altcoin)\b/i.test(s) && !/\b(stablecoin|peg|tether|usdt|usdc)\b/i.test(s)) return "Smart contracts & L1s";
  if (/\b(libra|diem)\b/i.test(s)) return "CBDCs";
  if (/\b(stablecoin|usdt|usdc|ust |tether|dai |busd|gho |usdp|gusd|fei |pax |realcoin|paypal usd|pyusd|ustbl|sky protocol|usds|aave.*gho|multi-collateral dai|stableswap)\b/i.test(s))
    return leaf;
  if (/\b(peg break|depeg|lose.*peg|dollar parity)\b/i.test(s) && /\b(crypto|token|coin)\b/i.test(s)) return leaf;

  if (hasBitcoinHeadline(s) && !/\b(stablecoin|usdt|usdc|tether|dai)\b/i.test(s)) return null;
  return leaf;
}

function classifyDeFi(date: string, s: string): string | null {
  const leaf: Leaf = "DeFi";
  if (OVERRIDES[leaf]?.[date] !== undefined) return OVERRIDES[leaf]![date]!;
  if (!s.trim()) return null;
  if (isMacroOffTopic(s)) return null;

  if (/\b(health-care|tobin tax|debt control|shadow chancellor|bonuses backed by state)\b/i.test(s)) {
    if (/\b(bank|bonus|debt|tax)\b/i.test(s)) return "Global growth and recession";
    return null;
  }
  if (/\b(ronin.*tornado|tornado cash)\b/i.test(s)) return "Cross-chain and bridges";
  if (/\b(cardano transaction volume)\b/i.test(s)) return "Smart contracts & L1s";
  if (/\b(bitcoin and ether dip)\b/i.test(s)) return "Bitcoin price & cycles";

  if (/\b(defi|uniswap|aave|compound|curve|makerdao|balancer|yearn|sushiswap|sushi|crv |yfi |mkr |liquidity mining|yield farm|flash loan|governance token|liquidity pool|lending protocol|tornado cash governance|sovryn hack|augur)\b/i.test(s))
    return leaf;
  return null;
}

function classifyNftsGaming(date: string, s: string): string | null {
  const leaf: Leaf = "NFTs and gaming";
  if (OVERRIDES[leaf]?.[date] !== undefined) return OVERRIDES[leaf]![date]!;
  if (!s.trim()) return null;
  if (isMacroOffTopic(s)) return null;

  if (/\b(openbazaar|bitzon|decentralized bitcoin marketplace|bitcoin-only marketplace)\b/i.test(s)) return "Bitcoin adoption";
  if (/\b(cryptokitties|ethereum network)\b/i.test(s) && date === "2017-12-03") return "Smart contracts & L1s";
  if (/\b(bitcoin ordinals|ordinals)\b/i.test(s) && /\b(magic eden|marketplace)\b/i.test(s)) return "Scaling and Layer 2";

  if (/\b(nfts?|cryptopunks|opensea|blur |looksrare|magic eden|metaverse|gaming|gamestop.*wallet|pleasrdao|metabirkins|trump nft|vampire attack|seaport|creator royalties)\b/i.test(s))
    return leaf;
  return null;
}

function classifyCrossChain(date: string, s: string): string | null {
  const leaf: Leaf = "Cross-chain and bridges";
  if (OVERRIDES[leaf]?.[date] !== undefined) return OVERRIDES[leaf]![date]!;
  if (!s.trim()) return null;
  if (isMacroOffTopic(s)) return null;

  if (/\b(stripe launches connect)\b/i.test(s)) return null;
  if (/\b(restaurant acceptance|bitcoin roundabout|unicode adds the bitcoin|cash-to-crypto|newsagents)\b/i.test(s))
    return "Bitcoin adoption";
  if (/\b(rakuten.*bitnet|banco santander explores bitcoin|royal mint.*blockchain gold)\b/i.test(s))
    return "Bitcoin adoption";
  if (/\b(argentina.*bitcoin.*pesticide|settle.*bitcoin)\b/i.test(s)) return "Bitcoin adoption";
  if (/\b(bitcoin transaction fees jump)\b/i.test(s)) return "Bitcoin price & cycles";
  if (/\b(square crypto funds)\b/i.test(s)) return "Scaling and Layer 2";
  if (/\b(blue sky|jack dorsey)\b/i.test(s)) return "Web3 industry and funding";
  if (/\b(xrp.*cbdc|cbdc)\b/i.test(s)) return "CBDCs";
  if (/\b(ronin.*hack|steal.*ronin)\b/i.test(s)) return "DeFi";
  if (/\b(internet computer.*bitcoin|chain key)\b/i.test(s)) return "Smart contracts & L1s";
  if (/\b(syntropy.*bitcoin integration)\b/i.test(s)) return "Smart contracts & L1s";
  if (/\b(aave.*spiderchain|spiderchain)\b/i.test(s)) return "DeFi";
  if (/\b(dash core client)\b/i.test(s)) return "Smart contracts & L1s";

  if (/\b(bridge|cross-chain|ccip|cosmos hub|ibc |world wire|stellar-based|omnichain|zetachain|avail|madara|portal for cross-chain|ronin bridge|btc\.b mint|interoperab)\b/i.test(s))
    return leaf;
  if (/\b(the graph network|decentralized indexing)\b/i.test(s)) return "Smart contracts & L1s";
  return null;
}

function classifyWeb3Funding(date: string, s: string): string | null {
  const leaf: Leaf = "Web3 industry and funding";
  if (OVERRIDES[leaf]?.[date] !== undefined) return OVERRIDES[leaf]![date]!;
  if (!s.trim()) return null;
  if (isMacroOffTopic(s)) return null;

  if (/\b(senator dodd|banking agencies)\b/i.test(s)) return "Politics and elections";
  if (/\b(bitinstant|coinbase raises|korbit|bitpay raises|xapo raises|bitx secures|bitnet raises|coinsecure|unocoin|zebpay|heml\.is)\b/i.test(s) && /\b(bitcoin exchange|wallet|payments|merchant)\b/i.test(s)) {
    if (/\b(wallet|xapo)\b/i.test(s)) return "Wallets & self-custody";
    if (/\b(bitpay|merchant|payments)\b/i.test(s)) return "Bitcoin adoption";
    return "Exchanges";
  }
  if (/\b(opencoin.*ripple|ripple expands)\b/i.test(s)) return "Smart contracts & L1s";
  if (/\b(blockstream.*sidechain)\b/i.test(s)) return "Scaling and Layer 2";
  if (/\b(21 inc|bitmain|bitfury|marathon digital|riot platform|hut 8|cleanspark)\b/i.test(s)) return "Bitcoin mining";
  if (/\b(mining)\b/i.test(s) && /\b(raise|funding|ipo)\b/i.test(s)) return "Bitcoin mining";
  if (/\b(bitcoin foundation)\b/i.test(s)) return "Protocol & upgrades";
  if (/\b(coinbase raises.*banks|digital currency group|mastercard.*dcg|western union.*dcg)\b/i.test(s)) return "Institutional Bitcoin & flows";
  if (/\b(dcg raises|dcg acquires)\b/i.test(s) && !/\b(web3 industry)\b/i.test(s)) return "Institutional Bitcoin & flows";
  if (/\b(bakkt raises|etf|futures approval)\b/i.test(s)) return "ETFs and investment products";
  if (/\b(irs tax rules)\b/i.test(s)) return "Tax policy";
  if (/\b(cronos.*accelerator)\b/i.test(s)) return "DeFi";
  if (/\b(anonymous.*bitcoin gift|water project)\b/i.test(s)) return "Bitcoin adoption";
  if (/\b(bitcoin\.com hires)\b/i.test(s)) return null;
  if (/\b(angellist invest|sec approves)\b/i.test(s)) return "Securities regulation";
  if (/\b(coindl|music industry|hypebot)\b/i.test(s)) return "Bitcoin adoption";
  if (/\b(chris dixon backs bitcoin)\b/i.test(s)) return "Web3 industry and funding";
  if (/\b(bitcoin startup funding surges|merchant adoption)\b/i.test(s) && /\b(60,000 stores|funding surges)\b/i.test(s)) {
    if (/\b(merchant)\b/i.test(s)) return "Bitcoin adoption";
    return leaf;
  }

  if (/\b(raises \$|secures \$|seed funding|series [a-z]|strategic round|angel round|venture|vc fund|crypto fund|blockchain fund|ico raises|crowdfunding|angel group|startup program|accelerator|binance labs|haun ventures|paradigm|pantera|a16z|andreessen|coinbase ventures|polychain|sequoia|multicoin)\b/i.test(s))
    return leaf;
  if (/\b(web3|blockchain startup|crypto startup|nft marketplace.*raise|dao governance toolkit|blue sky|interwork alliance|digital asset holdings|blythe masters)\b/i.test(s)) return leaf;
  if (/\b(acquires|merger)\b/i.test(s) && /\b(coindesk|blockchain|crypto|web3)\b/i.test(s)) return leaf;
  return null;
}

export const CLASSIFIERS: Record<Leaf, (date: string, s: string) => string | null> = {
  "Smart contracts & L1s": classifySmartContractsL1s,
  Stablecoins: classifyStablecoins,
  DeFi: classifyDeFi,
  "NFTs and gaming": classifyNftsGaming,
  "Cross-chain and bridges": classifyCrossChain,
  "Web3 industry and funding": classifyWeb3Funding,
};

export async function generateForLeaf(leaf: Leaf) {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const byTarget: Record<string, number> = {};

  for (const row of rows) {
    const target = CLASSIFIERS[leaf](row.date, row.summary ?? "");
    map[row.date] = target;
    const key = target ?? "(clear)";
    byTarget[key] = (byTarget[key] ?? 0) + 1;
    if (target === leaf) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else stats.moved += 1;
  }

  return { leaf, total: rows.length, stats, byTarget, map };
}

async function main() {
  const leafArg = process.argv[2] as Leaf | undefined;
  const leaves: Leaf[] = leafArg
    ? [leafArg]
    : [
        "Smart contracts & L1s",
        "Stablecoins",
        "DeFi",
        "NFTs and gaming",
        "Cross-chain and bridges",
        "Web3 industry and funding",
      ];

  for (const leaf of leaves) {
    const { total, stats, byTarget, map } = await generateForLeaf(leaf);
    console.error(JSON.stringify({ leaf, total, stats, byTarget }, null, 2));

    const slug = leaf
      .toLowerCase()
      .replace(/ & /g, "-")
      .replace(/ /g, "-");
    console.log(`\n// === ${leaf} (${total} rows) ===`);
    console.log(`const TARGET_BY_DATE: Record<string, string | null> = {`);
    for (const [date, target] of Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) {
      const val = target === null ? "null" : `"${target}"`;
      console.log(`  "${date}": ${val},`);
    }
    console.log(`};`);
  }
}

const isMain = process.argv[1]?.includes("_gen-web3-editorial-maps");
if (isMain) main().catch(console.error);

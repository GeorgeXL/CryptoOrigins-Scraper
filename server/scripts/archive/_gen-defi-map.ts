/** One-off generator for retag-defi TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "DeFi";

const STRONG_DEFI =
  /\b(defi|uniswap|aave|compound|balancer|curve finance|curve protocol|makerdao|maker dao|yearn|sushiswap|sushi swap|crv governance|comp token|bal token|flash loan|liquidity mining|yield farming|liquidity pool lending|governance token|comet|metadao|endgame plan|sovryn hack|tornado cash governance|bug bounty|chef nomi|flash swaps|debt tokenization|yeth vault|crv inflation|uniswap foundation|augur launches|prediction markets on ethereum|yfi|sushi holdings|uni governance|lido launches|liquid staking|steth|uniswap v3|miso|dydx governance|euler finance|cream finance|poly network|poly network suffers|sushi approval contract|arbitrum dao|vyper compiler bug|dns hijack.*curve|dns attack.*balancer|liquidity pool model|money market protocol|decentralized lending|concentrated liquidity|single-asset borrowing|fair launch|governance control|admin keys|decentralization vote|community votes|governance backlash|governance token launch|token launchpad|protocol rebrands|protocol launch|protocol launches|protocol relaunch|protocol upgrade|protocol exit|exit from defi|flash loan attack|approval contract exploit|largest defi hack|defi exploit|defi breach|defi security breach|defi hack|drains? \$\d+.*(protocol|defi|vault|pool)|draining funds through|steals? governance|governance vote|governance token airdrop|bug bounty for.*v4|reduces crv inflation|split into metadaos|establish.*foundation|transfer[s]? control|miso launchpad|yeth vault|chef nomi|sushi swap control|compound v3|aave v2|aave v1|balancer protocol|yearn finance|yearn launches|crv token|bal token launches|uni governance token|dydx launches its governance)\b/i;

const NOT_CRYPTO =
  /\b(lobby congress|shadow chancellor|tobin tax|health-care firms hire|revolving-door|dogecoin founder boosts|elliptic curve hash avoiding random oracles)\b/i;

const DEBT_MACRO =
  /\b(debt control plan|automatic cuts if targets|bipartisan experts urge)\b/i;

const VC_FUNDING =
  /\b(venture capital firm|a16z invests|invests \$\d+ million in maker|raises \$\d+(\.\d+)? million in a seed|seed round led by|accelerator to fund|100m accelerator|\$\d+m accelerator)\b/i;

const WALLET =
  /\b(metamask launches.*(swaps|mobile)|metamask.*mobile app|metamask launches the swaps)\b/i;

const BRIDGE_HACK =
  /\b(ronin exploit|ronin bridge|wormhole bridge|wormhole bridge is exploited|move over \d+ ether from ronin|bridge is exploited for \d+.*weth)\b/i;

const REGULATION =
  /\b(estonia tightens crypto rules|revoking licenses over laundering)\b/i;

const TOKEN_HYPE =
  /\b(chainlink enters top 10 most purchased tokens|investors drive a surge in buying interest|outperforms bitcoin as deflationary|ethereum outperforms bitcoin)\b/i;

const WEB3_INFRA =
  /\b(the graph launches subgraph studio|subgraph studio)\b/i;

const EXCHANGE =
  /\b(poloniex|coinbase (launch|launches|ipo|exchange|resume|resumes)|binance|kraken|bitfinex|gemini|bittrex|okcoin|huobi|bitstamp|mt\.?gox|exchange (hack|launch|launches|resume|resumes|insolvency|withdrawal halt)|resumes.*trading after deposit|deposit delays.*surges|trading after deposit delays|centralized exchange|cex\b|sam bankman-fried after selling)\b/i;

const BITCOIN_FOCUS =
  /\b(bitcoin defi|bitcoin-backed lending|stacks as bitcoin|on stacks as bitcoin|spiderchain|bringing defi tools to bitcoin|open-source bitcoin defi|square launches tbd|tbd.*bitcoin|alex launches on stacks|rbbtc|liquid staking on bitcoin|btc collateral|borrow.*bitcoin collateral|bitcoin or ethereum collateral)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2010-01-05": null,
  "2016-05-28": "Exchanges",
  "2018-07-11": LEAF,
  "2018-09-24": "Web3 industry and funding",
  "2018-09-27": LEAF,
  "2018-11-01": LEAF,
  "2019-04-01": "Web3 industry and funding",
  "2020-01-01": LEAF,
  "2020-01-07": LEAF,
  "2020-03-31": LEAF,
  "2020-05-17": LEAF,
  "2020-05-18": LEAF,
  "2020-06-15": LEAF,
  "2020-06-21": "Securities regulation",
  "2020-06-23": LEAF,
  "2020-07-01": LEAF,
  "2020-07-17": LEAF,
  "2020-08-13": LEAF,
  "2020-09-02": LEAF,
  "2020-09-05": LEAF,
  "2020-09-07": LEAF,
  "2020-09-16": LEAF,
  "2020-10-06": "Wallets & self-custody",
  "2020-10-10": LEAF,
  "2020-10-29": LEAF,
  "2020-12-03": LEAF,
  "2020-12-18": LEAF,
  "2021-05-05": LEAF,
  "2021-05-20": LEAF,
  "2021-07-16": "Bitcoin adoption",
  "2021-08-10": LEAF,
  "2021-08-29": LEAF,
  "2021-09-08": LEAF,
  "2021-10-27": LEAF,
  "2022-01-17": "Bitcoin adoption",
  "2022-02-02": "Cross-chain and bridges",
  "2022-03-06": LEAF,
  "2022-03-23": "Cross-chain and bridges",
  "2022-06-07": "Web3 industry and funding",
  "2022-08-09": LEAF,
  "2022-08-24": LEAF,
  "2022-08-26": LEAF,
  "2022-09-20": LEAF,
  "2022-10-06": LEAF,
  "2022-10-24": LEAF,
  "2023-01-22": LEAF,
  "2023-03-13": LEAF,
  "2023-04-09": LEAF,
  "2023-04-16": LEAF,
  "2023-05-22": LEAF,
  "2023-07-30": LEAF,
  "2024-02-25": null,
  "2024-08-13": LEAF,
  "2024-11-15": "Bitcoin adoption",
  "2024-11-26": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (NOT_CRYPTO.test(s)) return null;
  if (DEBT_MACRO.test(s)) return "Debt crises";
  if (EXCHANGE.test(s) && !STRONG_DEFI.test(s)) return "Exchanges";
  if (BITCOIN_FOCUS.test(s) && !STRONG_DEFI.test(s)) return "Bitcoin adoption";
  if (VC_FUNDING.test(s)) return "Web3 industry and funding";
  if (WALLET.test(s)) return "Wallets & self-custody";
  if (REGULATION.test(s)) return "Securities regulation";
  if (BRIDGE_HACK.test(s)) return "Cross-chain and bridges";
  if (TOKEN_HYPE.test(s)) return null;
  if (WEB3_INFRA.test(s)) return "Web3 industry and funding";

  if (STRONG_DEFI.test(s)) return LEAF;

  if (date < "2017-01-01" && !/\b(ethereum|crypto|blockchain|defi)\b/i.test(s)) return null;

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const moves: Record<string, number> = {};

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "");
    map[row.date] = target;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else {
      stats.moved += 1;
      moves[target] = (moves[target] ?? 0) + 1;
    }
  }

  console.error(JSON.stringify({ total: rows.length, stats, moves }, null, 2));

  const lines = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, target]) => {
      const val = target === null ? "null" : `"${target}"`;
      return `  "${date}": ${val},`;
    });

  console.log("const TARGET_BY_DATE: Record<string, string | null> = {");
  console.log(lines.join("\n"));
  console.log("};");
}

main().catch(console.error);

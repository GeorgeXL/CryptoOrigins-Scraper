/** One-off generator for retag-cross-chain-bridges TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "Cross-chain and bridges";

const STRONG_CROSS_CHAIN =
  /\b(bridge|cross-chain|ccip|cosmos hub|ibc |world wire|stellar-based|omnichain|zetachain|portal for cross-chain|ronin bridge|ronin network|ronin exploit|horizon bridge|nomad bridge|qbridge|thorchain|bepswap|btc\.b mint|poly network|interoperab|cross-chain swap|cross-chain liquidity|cross-chain deFi|cross-chain hack|cross-chain theft|cross-chain crypto|cross-chain messaging|cross-chain trading|cross-chain communication|cross-chain warning|launder.*ronin|move over \d+ ether from ronin)\b/i;

const BITCOIN_L2 =
  /\b(zk rollup|bitvm|bitcoin programmability|citrea|madara rollup|avail.*mainnet|data availability for rollups)\b/i;

const NOT_CRYPTO =
  /\b(austerity|irish bailout|death cross|weak jobs data|stripe launches connect|gt nexus|tradecard merge|supply chain platform)\b/i;

const BITCOIN_ADOPTION =
  /\b(restaurant acceptance|newsagents|cash-to-crypto|bitcoin roundabout|unicode adds the bitcoin|settle.*cross-border.*bitcoin|pesticide deal with bitcoin|rakuten.*bitnet|banco santander explores bitcoin|consumers' research backs blockchain|barclays tests bitcoin|charity payment platform)\b/i;

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  const overrides: Record<string, string | null> = {
    "2010-05-01": null,
    "2010-07-03": null,
    "2010-11-29": null,
    "2012-10-10": null,
    "2013-01-08": null,
    "2013-12-24": "Exchanges",
    "2014-04-21": "Bitcoin adoption",
    "2014-07-04": "Banking & prudential (crypto)",
    "2015-05-16": "Government adoption",
    "2015-05-20": "Wallets & self-custody",
    "2015-06-22": "Bitcoin adoption",
    "2015-07-22": "Institutional Bitcoin & flows",
    "2015-08-08": "Bitcoin adoption",
    "2016-01-28": "Web3 industry and funding",
    "2016-03-29": "Institutional Bitcoin & flows",
    "2016-08-20": "Bitcoin adoption",
    "2016-09-09": "Bitcoin adoption",
    "2016-09-23": "Web3 industry and funding",
    "2016-11-30": "Institutional Bitcoin & flows",
    "2017-05-30": "Protocol & upgrades",
    "2017-06-20": "Bitcoin adoption",
    "2017-06-28": "Web3 industry and funding",
    "2017-08-23": "Enforcement & crime",
    "2018-03-04": "Bitcoin adoption",
    "2018-03-12": "Bitcoin adoption",
    "2018-05-18": null,
    "2019-01-28": LEAF,
    "2019-02-17": "Bitcoin adoption",
    "2019-03-08": null,
    "2019-03-13": LEAF,
    "2019-08-22": LEAF,
    "2020-06-01": LEAF,
    "2021-03-25": "CBDCs",
    "2021-04-01": LEAF,
    "2022-01-08": LEAF,
    "2022-01-27": LEAF,
    "2022-03-16": LEAF,
    "2022-03-29": LEAF,
    "2022-03-31": "Smart contracts & L1s",
    "2022-04-04": LEAF,
    "2022-06-23": LEAF,
    "2022-06-28": LEAF,
    "2022-08-01": LEAF,
    "2022-11-17": LEAF,
    "2022-11-19": "Exchanges",
    "2023-02-15": LEAF,
    "2023-03-03": LEAF,
    "2023-07-04": LEAF,
    "2023-07-17": LEAF,
    "2023-07-31": LEAF,
    "2023-12-20": "Scaling and Layer 2",
    "2024-07-23": "Scaling and Layer 2",
    "2024-08-06": LEAF,
    "2024-12-16": "Scaling and Layer 2",
  };

  if (overrides[date] !== undefined) return overrides[date];

  if (NOT_CRYPTO.test(s)) return null;
  if (BITCOIN_L2.test(s)) return "Scaling and Layer 2";
  if (BITCOIN_ADOPTION.test(s)) return "Bitcoin adoption";
  if (STRONG_CROSS_CHAIN.test(s)) return LEAF;

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

  console.log(JSON.stringify({ total: rows.length, stats, moves }, null, 2));

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

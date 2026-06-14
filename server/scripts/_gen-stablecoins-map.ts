/** One-off generator for retag-stablecoins TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";

const LEAF = "Stablecoins";

const STABLECOIN =
  /\b(stablecoin[s]?|usdt|tether|usdc|dai\b|busd|gusd|usdp|tusd|ust\b|fei protocol|fei\b|gho\b|pyusd|husd|realcoin|pax dollar|paxos.*(stablecoin|pax)|centre (consortium|launches|dissolves)|circle (acquires|reveals|freezes|assumes).*usdc|multi-collateral dai|depeg|loses (its )?\$1 peg|loses dollar parity|dollar parity|peg break|reserve disclosure|burns? \d+.*usdt|libra|diem|paypal usd|paypal launches.*stablecoin|gold-backed stablecoin|ausdt|usds\b|sky protocol|ustbl|stably launches.*stablecoin|brale and spark|shapeshift.*tether|dominica grants tusd|gemini'?s gusd|nextbridge closes.*ustbl|stablecoin growth|stablecoin payment[s]?|stablecoin remittance[s]?|ofac-sanctioned wallet[s]?|algorithmic stablecoin|dollar-backed stablecoin|yuan-based stablecoin|brc-20 option|ton, making it a top tether|terrausd|terra launches algorithmic|mica regulation for stablecoin|stablecoin oversight|unbacked stablecoin|stops issuing busd|visa.*stablecoin patent|husd|terra blockchain is halted|terra \(luna\) and terrausd)\b/i;

const OFF_TOPIC =
  /\b(violent protests|freicoin trades|health-care firms hire|shadow chancellor|tobin tax|debt control plan|community way dollar|cannabiscoin|cannabis.*pegging each coin to a gram)\b/i;

const DEFI =
  /\b(stableswap|liquidity mining|flash loan|lending platform|borrow stablecoins by locking|aave v|uniswap|compound launches|yield farming|amm ideal for stablecoins|hodl hodl launches a no-kyc)\b/i;

const CBDC =
  /\b(digital yuan|cbdc|central bank digital)\b/i;

const EXCHANGE =
  /\b(kucoin suffers major hack|binance clarifies its terra|exchange hack|withdrawal halt|kraken shows odd price)\b/i;

const BITCOIN_LED =
  /\b(bitcoin jumps|bitcoin climbs|microstrategy buys|bitcoin and stablecoins drive|bitcoin-backed|buys \$?\d+.*bitcoin|boosting its holdings to \d+.*btc)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-08-14": null,
  "2014-10-06": LEAF,
  "2014-11-20": LEAF,
  "2015-04-20": LEAF,
  "2017-09-12": null,
  "2018-06-29": LEAF,
  "2018-09-10": LEAF,
  "2018-09-26": LEAF,
  "2018-10-24": LEAF,
  "2019-05-04": "Bitcoin price & cycles",
  "2019-06-18": LEAF,
  "2019-09-05": LEAF,
  "2019-10-11": LEAF,
  "2019-11-10": "DeFi",
  "2019-11-18": LEAF,
  "2020-03-01": LEAF,
  "2020-04-26": LEAF,
  "2020-05-15": LEAF,
  "2020-08-28": LEAF,
  "2020-09-27": "Exchanges",
  "2020-12-01": LEAF,
  "2021-02-23": LEAF,
  "2021-04-04": LEAF,
  "2021-08-24": LEAF,
  "2021-08-30": "Institutional Bitcoin & flows",
  "2022-01-01": LEAF,
  "2022-05-07": LEAF,
  "2022-05-09": LEAF,
  "2022-05-10": null,
  "2022-05-12": LEAF,
  "2022-05-15": "Exchanges",
  "2022-06-04": null,
  "2022-06-10": LEAF,
  "2022-07-14": LEAF,
  "2022-10-07": LEAF,
  "2023-01-31": LEAF,
  "2023-02-21": LEAF,
  "2023-03-05": LEAF,
  "2023-03-11": LEAF,
  "2023-03-20": "Bitcoin adoption",
  "2023-07-07": LEAF,
  "2023-07-16": LEAF,
  "2023-08-08": LEAF,
  "2023-08-22": LEAF,
  "2023-08-24": LEAF,
  "2023-08-31": LEAF,
  "2023-10-30": LEAF,
  "2023-11-15": LEAF,
  "2023-12-09": LEAF,
  "2024-04-22": LEAF,
  "2024-06-17": LEAF,
  "2024-06-30": LEAF,
  "2024-08-27": LEAF,
  "2024-09-18": LEAF,
  "2024-12-04": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (OFF_TOPIC.test(s)) return null;
  if (BITCOIN_LED.test(s) && !STABLECOIN.test(s)) {
    if (/microstrategy|institutional|holdings to \d+.*btc/i.test(s)) return "Institutional Bitcoin & flows";
    if (/adoption|african/i.test(s)) return "Bitcoin adoption";
    return "Bitcoin price & cycles";
  }
  if (CBDC.test(s)) return "CBDCs";
  if (DEFI.test(s) && !STABLECOIN.test(s)) return "DeFi";
  if (EXCHANGE.test(s) && !STABLECOIN.test(s)) return "Exchanges";
  if (STABLECOIN.test(s)) return LEAF;

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

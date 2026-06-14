/** One-off generator for retag-bitcoin-mining TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";

const LEAF = "Bitcoin mining";
const HALVING_DATES = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

const STRONG_MINING =
  /\b(hash ?rate|hashrate|exahash|petahash|terahash|mining (pool|rig|farm|facility|company|hardware|difficulty|center|centre)|miner[s]? (buy|ship|expand|sell|halt|revenue|profit)|antminer|bitmain|marathon digital|marathon patent|riot platforms|cleanspark|bitdeer|f2pool|antpool|foundry|core scientific|hut 8|iris energy|self[- ]min|mines block|asic\b|gpu mining|cpu mining|21 inc|21 bitcoin computer|bitfury|primeasic|coinlab.*mines|butterfly labs|stratum v2|mining chip|mining rig|mining gear|mining facility|mining project|mining expand|mining-backed|hash power|hashing power|51%|bitberries|coinconnect.*mining|coingeek mining|duke energy explores bitcoin mining|shell backs bitcoin mining|solar.*mine|mine[s]? bitcoin|bitcoin mine[s]? block|industrial mining|regulated crypto industry.*mining|surplus power.*mining)\b/i;

const HALVING_LED =
  /\b(halving (day|event|block|countdown)|block reward halving|reward halving|post[- ]halving|pre[- ]halving|ahead of the upcoming halving|fewer than \d+ blocks remaining|lower rewards and rising fees|nears the next halving)\b/i;

const EXCHANGE =
  /\b(exchange (hack|launch|launches|listing|insolvency|withdrawal|pauses|pause)|mt\.?gox|bitfinex|binance|coinbase (ipo|listing|launches)|kraken|cex\.io enter|btc china launches a mining pool and merchant payment|merchant payment service enabling bitcoin)\b/i;

const PROTOCOL =
  /\b(bitcoin core|bitcoin foundation launches|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|block size|stratum v2 upgrades for bitcoin mining pools|brink.*developer|bitcoin core developer|protocol upgrade|21 inc raises \$116 million)\b/i;

const PRICE_LED =
  /\b(price (hits|rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound)|trades (near|at)|bullish|bearish|all[- ]time high|\bath\b|market cap|40% price surge|addresses holding 0\.1 btc|supply nears its cap)\b/i;

const INSTITUTIONAL =
  /\b(microstrategy|corporate treasury|treasury (buy|purchase|hold)|buys? \d+.*bitcoin for \$|nydig raises|institutional flow|fixed deposits.*interest|restates past results after sec|fidelity digital as a second bitcoin custodian|sells \$250m in notes to buy more bitcoin)\b/i;

const EARLY =
  /\b(pizza day|genesis block|whitepaper|satoshi (posts|mails|vanishes)|origin-era|bitcoin foundation launches, glbse)\b/i;

const ALT_L1 =
  /\b(ethereum complete|litecoin mining|monero|solana|cardano|altcoin)\b/i;

const ENFORCEMENT =
  /\b(ftc shuts down|authorities destroy a bitcoin mining center|arrest members)\b/i;

const GOVERNMENT =
  /\b(government adoption|legal tender|el salvador)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-12-16": "Protocol & upgrades",
  "2010-11-25": "Protocol & upgrades",
  "2012-02-10": "Protocol & upgrades",
  "2012-03-16": "Protocol & upgrades",
  "2012-03-31": "Protocol & upgrades",
  "2012-08-24": "Protocol & upgrades",
  "2012-10-07": "Bitcoin mining",
  "2013-05-11": "Protocol & upgrades",
  "2013-11-05": "Protocol & upgrades",
  "2014-09-15": "Derivatives",
  "2014-09-23": "Bitcoin mining",
  "2014-10-19": "Exchanges",
  "2015-03-13": "Bitcoin mining",
  "2015-05-01": "Bitcoin mining",
  "2015-06-02": "Bitcoin mining",
  "2015-06-20": "Protocol & upgrades",
  "2015-09-10": "Protocol & upgrades",
  "2015-09-21": "Bitcoin mining",
  "2015-11-28": "Protocol & upgrades",
  "2016-02-16": "Bitcoin mining",
  "2016-04-04": "Bitcoin mining",
  "2016-07-18": "Protocol & upgrades",
  "2016-11-04": "Bitcoin price & cycles",
  "2017-02-05": "Bitcoin mining",
  "2017-02-15": "Bitcoin mining",
  "2017-07-01": "Protocol & upgrades",
  "2017-08-21": "Protocol & upgrades",
  "2017-08-31": "Protocol & upgrades",
  "2018-02-03": "Bitcoin mining",
  "2018-04-04": "Early Bitcoin history",
  "2018-04-08": "Smart contracts & L1s",
  "2018-04-21": "Protocol & upgrades",
  "2018-04-23": "Protocol & upgrades",
  "2018-06-07": "Protocol & upgrades",
  "2018-06-25": "Protocol & upgrades",
  "2018-07-06": "Protocol & upgrades",
  "2018-07-15": "Smart contracts & L1s",
  "2018-08-15": "Bitcoin mining",
  "2018-11-04": "Protocol & upgrades",
  "2019-01-27": "Protocol & upgrades",
  "2019-04-11": "Bitcoin mining",
  "2019-07-07": "Bitcoin mining",
  "2019-07-22": "Bitcoin mining",
  "2019-09-19": "Protocol & upgrades",
  "2019-10-23": "Exchanges",
  "2019-10-31": "Bitcoin mining",
  "2019-12-03": "Protocol & upgrades",
  "2020-01-04": "Smart contracts & L1s",
  "2020-01-15": "Bitcoin mining",
  "2020-01-20": "Bitcoin price & cycles",
  "2020-01-25": "Bitcoin mining",
  "2020-01-29": "Protocol & upgrades",
  "2020-02-05": "Bitcoin mining",
  "2020-02-08": "Bitcoin price & cycles",
  "2020-02-27": "Bitcoin mining",
  "2020-03-20": "Protocol & upgrades",
  "2020-03-21": "Protocol & upgrades",
  "2020-05-03": "Bitcoin mining",
  "2020-05-09": "Bitcoin mining",
  "2020-05-10": "Bitcoin mining",
  "2020-05-16": "Protocol & upgrades",
  "2020-05-19": "Protocol & upgrades",
  "2020-08-15": null,
  "2021-04-08": "Protocol & upgrades",
  "2021-04-12": "Bitcoin mining",
  "2021-05-25": "Bitcoin mining",
  "2021-08-16": "Protocol & upgrades",
  "2021-08-27": "Institutional Bitcoin & flows",
  "2021-12-13": "Early Bitcoin history",
  "2021-12-31": "Bitcoin mining",
  "2022-01-23": "Bitcoin mining",
  "2022-04-01": "Early Bitcoin history",
  "2022-06-08": "Bitcoin mining",
  "2022-07-06": "Bitcoin mining",
  "2022-07-24": null,
  "2022-10-11": "Bitcoin mining",
  "2022-11-05": "Smart contracts & L1s",
  "2023-05-08": "Protocol & upgrades",
  "2023-05-16": "Bitcoin mining",
  "2023-05-21": "Bitcoin mining",
  "2023-07-24": "Bitcoin mining",
  "2023-08-05": "Bitcoin mining",
  "2023-12-18": "Protocol & upgrades",
  "2023-12-30": "Legal cases",
  "2024-01-30": "Bitcoin price & cycles",
  "2024-02-04": "Bitcoin price & cycles",
  "2024-02-29": "Bitcoin price & cycles",
  "2024-03-01": "Bitcoin mining",
  "2024-03-09": "Bitcoin price & cycles",
  "2024-03-17": "Bitcoin mining",
  "2024-03-19": "Derivatives",
  "2024-03-23": "Bitcoin mining",
  "2024-03-24": "Bitcoin mining",
  "2024-03-25": "Bitcoin mining",
  "2024-04-10": "Bitcoin mining",
  "2024-04-11": "Bitcoin mining",
  "2024-04-14": "Bitcoin mining",
  "2024-04-15": "Bitcoin price & cycles",
  "2024-04-21": "Protocol & upgrades",
  "2024-05-10": "Bitcoin mining",
  "2024-06-24": "Bitcoin price & cycles",
  "2024-07-29": "Bitcoin mining",
  "2024-08-01": "Bitcoin price & cycles",
  "2024-08-19": "Early Bitcoin history",
  "2024-08-29": "Institutional Bitcoin & flows",
  "2024-09-11": "Bitcoin price & cycles",
  "2024-09-12": "Bitcoin price & cycles",
  "2024-09-13": "Bitcoin price & cycles",
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];
  if (HALVING_DATES.has(date)) return PRICE_LED.test(s) ? "Bitcoin price & cycles" : LEAF;

  if (GOVERNMENT.test(s) && !STRONG_MINING.test(s)) return "Government adoption";
  if (ENFORCEMENT.test(s) && STRONG_MINING.test(s)) return LEAF;
  if (EXCHANGE.test(s) && !STRONG_MINING.test(s)) return "Exchanges";
  if (ALT_L1.test(s) && !STRONG_MINING.test(s)) return "Smart contracts & L1s";
  if (HALVING_LED.test(s) && !STRONG_MINING.test(s)) {
    return PRICE_LED.test(s) ? "Bitcoin price & cycles" : LEAF;
  }
  if (PROTOCOL.test(s) && !STRONG_MINING.test(s)) return "Protocol & upgrades";
  if (INSTITUTIONAL.test(s) && !STRONG_MINING.test(s)) return "Institutional Bitcoin & flows";
  if (PRICE_LED.test(s) && !STRONG_MINING.test(s)) return "Bitcoin price & cycles";
  if (EARLY.test(s) && !STRONG_MINING.test(s)) return "Early Bitcoin history";

  if (STRONG_MINING.test(s)) return LEAF;
  if (/\b(bitcoin|btc)\b/i.test(s) && /\bmin(e|ing|er)\b/i.test(s)) return LEAF;

  return LEAF;
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

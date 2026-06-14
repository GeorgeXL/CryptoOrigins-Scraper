/** One-off generator for retag-government-adoption TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Government adoption";

const STRONG_GOVERNMENT =
  /\b(legal tender|nation[- ]state|national (bitcoin )?adoption|government adoption|el salvador (adopt|bitcoin law|legal|expands|hosts|wins|president|buys|assembly|trust|residency|anniversary|volcano bond|chivo|bukele|imF deal|holdings?|treasury|reserves?|target)|central african republic|car (adopt|bitcoin|legal|sango|hub)|pontinha adopt|indira kempis|samson mow.*nation|prince philip.*bitcoin adoption|jurisdiction.*official currency|official currency|e-passport|e-residency.*bitcoin|state.*bitcoin (law|policy|reserve)|strategic bitcoin reserve|nation.*bitcoin reserve|bitcoin reserve (fund|policy|plan|using seized)|pay (state|city|property|public) (tax|taxes|fees|fines|bills).*bitcoin|accept(s|ing)? (bitcoin|btc|crypto).*(tax|taxes|fees|fines|public services|city payments|state payments|treasury)|bitcoin.*(tax|taxes|fees|fines|public services|city payments|state payments)|miami (moves|adopt).*bitcoin.*(tax|payment|city)|zug (becomes|accepts).*bitcoin.*(tax|public|payment)|colorado.*accept.*bitcoin.*tax|innisfil.*property tax.*bitcoin|ohio.*pay taxes.*bitcoin|fort worth.*first.*city.*mine bitcoin|honduras.*bitcoin valley|honduras.*land (title|registry).*bitcoin|georgia partners.*blockchain land registry|uk welfare.*blockchain payment|banco do brasil.*pay taxes|paraguay.*bitcoin legal tender|rio de janeiro.*treasury.*bitcoin|us treasury calls bitcoin|florida cfo.*pension.*bitcoin|government plans.*bitcoin reserve|seized assets.*bitcoin|one million bitcoins)\b/i;

const CBDC =
  /\b(cbdc|central bank digital|mintchip|digital peso|em[cC]ash|digital yuan|digital euro|sovereign digital currency|central bank.*(digital|blockchain|currency)|ibm.*central bank.*digital|mercado bitcoin.*cbdc pilot|blockchain for major currencies.*central bank)\b/i;

const ADOPTION =
  /\b(merchant[s]?|payment processor[s]?|bitpay|accept[s]? (bitcoin|btc|crypto)|accepting (bitcoin|btc|crypto)|bitcoin (payment[s]?|checkout|pay|paid|donation[s]?|atm[s]?|debit card|gift card)|pay with bitcoin|paid in bitcoin|retailer[s]?|store[s]? accept|restaurant[s]? accept|airline[s]? accept|bitcoin atm|spend bitcoin|lightning (network )?(payment[s]?|checkout|accept)|opennode|strike (launch|add|enable|partner)|pick n pay|mcdonald'?s accept|virgin galactic|overstock|newegg|living on bitcoin|everyday (purchase|payment|spending)|mainstream.*(payment|accept)|athena bitcoin.*atm|tourism economy|draw visitors)\b/i;

const INSTITUTIONAL =
  /\b(microstrategy|corporate treasury|grayscale|blackrock|etf|custody|institutional|citibank.*btc unit|pension.*bitcoin|portfolio hedge)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (pool|rig|farm|company|hardware|hub|facility|industry)|miner[s]?|antminer|bitmain|marathon|f2pool|51%|asic\b|gpu mining|mines bitcoin|self[- ]mining|bitcoin mining|recognizes bitcoin mining|mining facility|surplus power.*mining|state leaders backing.*mining)\b/i;

const REGULATION =
  /\b(visa denied|denied a visa|regulator|regulation|fca rules|sec charges|legal case|court rules|crypto ban|blockchain records.*legal|smart contracts as legal|crypto bank|financial system for digital assets|blockchain council.*legislation|france fintech.*regulators|white house appoints.*cto|deputy u\.s\. cto|embassies.*training|officials back blockchain.*regulators warn|binance signs.*invest)\b/i;

const PROTOCOL =
  /\b(bitcoin core|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|microsoft.*ion on bitcoin|decentralized identity|gradbase.*verify degrees|marriage certificates on ethereum|blockchain identity pilot.*refugees|blockchain-based digital peso)\b/i;

const ENFORCEMENT =
  /\b(silk road|insider trading|galleon pays)\b/i;

const EXCHANGE =
  /\b(exchange hack|mt\.?gox|bitfinex|binance hack|coinbase ipo|kraken|withdrawal halt)\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound|momentum|pressure)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|falls below \$|slides? to \$|rebounds? to \$|climbs with tech stocks)\b/i;

const WEB3 =
  /\b(startup[s]?|sxsw|coinpip|global bitcoin hub|jan3|chief strategy officer|adopting bitcoin conference|110\+ speakers|opennode tests.*sandbox)\b/i;

const MACRO_NO_CRYPTO =
  /\b(obama|geithner|summers|bush|congress|senate|parliament|prime minister|president(?!.*bitcoin)|chancellor|treasury unveils|bailout|stimulus|imf|eurostat|g20|merkel|austerity|deficit|nationalizes|nationalised|bankruptcy|stress test|executive pay|bonus rules|emissions trading|climate fund|rail line|ticketmaster|equitable life|bp shares|gulf spill|pentagon audit|audit commission|bolsover council|public finances|brighton and hove council|scottish borders council|venezuela devalues|soros.*climate|poland signs|ecowas|live nation|barclays.*bonus|greece asks|canada raises|virtual currencies for real-world|china.*ban on using virtual currencies)\b/i;

function hasBitcoinContext(text: string) {
  return /\b(bitcoin|btc|crypto|blockchain|legal tender|el salvador|satoshi)\b/i.test(text);
}

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-05-09": "Global growth and recession",
  "2010-07-27": "Protocol & upgrades",
  "2011-05-21": "Bitcoin adoption",
  "2011-11-25": null,
  "2012-04-04": "CBDCs",
  "2014-07-26": "CBDCs",
  "2014-12-09": "Bitcoin adoption",
  "2014-12-26": null,
  "2015-01-08": "Bitcoin regulation",
  "2015-01-19": "Web3 industry and funding",
  "2015-02-11": LEAF,
  "2015-03-09": LEAF,
  "2015-03-17": "CBDCs",
  "2015-04-15": "Web3 industry and funding",
  "2015-05-12": "Bitcoin regulation",
  "2015-05-16": "Smart contracts & L1s",
  "2015-07-01": "Web3 industry and funding",
  "2015-12-15": LEAF,
  "2011-08-12": null,
  "2016-04-22": "Smart contracts & L1s",
  "2016-07-01": null,
  "2016-07-10": "Smart contracts & L1s",
  "2016-10-12": "Bitcoin regulation",
  "2017-04-02": "Bitcoin regulation",
  "2017-10-06": "CBDCs",
  "2017-12-12": "Bitcoin regulation",
  "2018-01-11": LEAF,
  "2018-01-28": "Protocol & upgrades",
  "2018-02-23": LEAF,
  "2018-03-08": "Bitcoin regulation",
  "2018-04-30": "Web3 industry and funding",
  "2018-09-30": "Banking & prudential (crypto)",
  "2018-12-02": LEAF,
  "2019-01-07": "Smart contracts & L1s",
  "2019-03-08": "Smart contracts & L1s",
  "2019-03-29": LEAF,
  "2019-07-22": "Bitcoin mining",
  "2020-06-11": "Protocol & upgrades",
  "2020-07-21": "Web3 industry and funding",
  "2020-09-06": LEAF,
  "2020-09-20": "CBDCs",
  "2021-03-12": LEAF,
  "2021-06-05": LEAF,
  "2021-06-25": LEAF,
  "2021-06-26": "Bitcoin adoption",
  "2021-08-03": LEAF,
  "2021-09-01": LEAF,
  "2021-09-06": LEAF,
  "2021-09-15": LEAF,
  "2021-09-16": LEAF,
  "2021-10-30": LEAF,
  "2021-11-03": LEAF,
  "2021-11-06": LEAF,
  "2022-01-15": LEAF,
  "2022-02-11": "Bitcoin mining",
  "2022-03-01": "Web3 industry and funding",
  "2022-03-03": LEAF,
  "2022-04-26": LEAF,
  "2022-04-29": LEAF,
  "2022-05-22": LEAF,
  "2022-07-03": LEAF,
  "2022-07-31": null,
  "2022-09-03": "Web3 industry and funding",
  "2022-09-07": LEAF,
  "2022-09-23": LEAF,
  "2022-09-28": "Web3 industry and funding",
  "2022-11-28": LEAF,
  "2023-02-13": LEAF,
  "2023-02-27": "Web3 industry and funding",
  "2023-06-24": "CBDCs",
  "2023-08-05": "Bitcoin mining",
  "2023-12-08": LEAF,
  "2024-07-30": LEAF,
  "2024-10-30": "Institutional Bitcoin & flows",
  "2024-12-08": LEAF,
  "2024-12-09": LEAF,
  "2024-12-20": LEAF,
  "2024-12-28": LEAF,
  "2009-02-16": "Global growth and recession",
  "2009-02-23": "Politics and elections",
  "2009-06-28": "Bailouts and stimulus",
  "2010-11-18": "Global growth and recession",
  "2011-04-14": "Global growth and recession",
  "2011-07-16": null,
  "2011-07-29": null,
  "2014-01-15": "Bitcoin adoption",
  "2013-06-07": "Bitcoin regulation",
  "2014-04-20": "Bitcoin regulation",
  "2014-04-28": "Enforcement & crime",
  "2014-07-25": "CBDCs",
  "2014-11-14": LEAF,
  "2015-03-16": "Enforcement & crime",
  "2015-03-20": "Bitcoin regulation",
  "2016-05-13": "Enforcement & crime",
  "2016-12-06": "Bitcoin regulation",
  "2016-12-16": "Bitcoin regulation",
  "2017-04-01": LEAF,
  "2017-06-16": "Enforcement & crime",
  "2017-10-05": "CBDCs",
  "2018-02-20": LEAF,
  "2018-03-20": LEAF,
  "2018-11-05": LEAF,
  "2019-07-06": "Global growth and recession",
  "2019-12-21": LEAF,
  "2020-01-28": "Bitcoin regulation",
  "2022-03-17": LEAF,
  "2023-04-20": "Bitcoin regulation",
  "2024-08-07": "Bitcoin regulation",
  "2024-12-09": LEAF,
  "2024-12-11": "Bitcoin mining",
  "2024-12-22": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (MACRO_NO_CRYPTO.test(s) && !hasBitcoinContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    if (ranking.primary && ranking.primary !== LEAF && (ranking.candidates[0]?.score ?? 0) >= 10) {
      return ranking.primary;
    }
    return null;
  }

  if (CBDC.test(s) && !STRONG_GOVERNMENT.test(s)) return "CBDCs";

  if (STRONG_GOVERNMENT.test(s)) return LEAF;

  if (MINING.test(s) && !/\b(city|state|nation|government|legal tender|public)\b/i.test(s)) return "Bitcoin mining";

  if (INSTITUTIONAL.test(s) && !/\b(tax|legal tender|public services|city payments|state payments|nation)\b/i.test(s)) {
    return "Institutional Bitcoin & flows";
  }

  if (ENFORCEMENT.test(s)) return "Enforcement & crime";
  if (EXCHANGE.test(s)) return "Exchanges";
  if (PROTOCOL.test(s) && !/\b(tax|legal tender|public services)\b/i.test(s)) return "Protocol & upgrades";
  if (REGULATION.test(s) && !/\b(pay taxes|tax payment|legal tender|public services)\b/i.test(s)) return "Bitcoin regulation";
  if (WEB3.test(s) && !/\b(el salvador|legal tender|nation|state tax|city tax|public services)\b/i.test(s)) {
    return "Web3 industry and funding";
  }
  if (ADOPTION.test(s)) return "Bitcoin adoption";
  if (PRICE_ONLY.test(s)) return "Bitcoin price & cycles";

  if (!hasBitcoinContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    if (ranking.primary && ranking.primary !== LEAF && (ranking.candidates[0]?.score ?? 0) >= 12) {
      return ranking.primary;
    }
    return null;
  }

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 5);
  if (ranking.primary && ranking.primary !== LEAF && ranking.confidence === "high") return ranking.primary;
  if (ranking.candidates[0] && ranking.candidates[0].leaf !== LEAF && ranking.candidates[0].score >= 14) {
    return ranking.candidates[0].leaf;
  }

  return null;
}

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const map: Record<string, string | null> = {};
  const stats = { keep: 0, moved: 0, cleared: 0 };
  const byTarget: Record<string, number> = {};

  for (const row of rows) {
    const target = classify(row.date, row.summary ?? "");
    map[row.date] = target;
    const key = target ?? "(clear)";
    byTarget[key] = (byTarget[key] ?? 0) + 1;
    if (target === LEAF) stats.keep += 1;
    else if (target === null) stats.cleared += 1;
    else stats.moved += 1;
  }

  console.error(JSON.stringify({ total: rows.length, stats, byTarget }, null, 2));

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

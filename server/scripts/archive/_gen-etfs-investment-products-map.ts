/** One-off generator for retag-etfs-investment-products TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "ETFs and investment products";

const STRONG_ETF =
  /\b(gbtc|grayscale.*(trust|etf|convert|gbtc|discount|terms)|bitcoin investment trust|spot (bitcoin )?etfs?|futures etfs?|bitcoin etfs?|bitcoin funds?|bitcoin trusts?|etf approvals?|etf optimism|etf buzz|exchange[- ]traded funds?|exchange[- ]traded notes?|sec (approv\w*|reject\w*|delay\w*|review\w*|acknowledg\w*).*etfs?|etfs? (launch|listing|file|filing|inflows?|outflows?|records?|options?|trading volumes?|decisions?|status|applications?|ticker)|winklevoss.*(etf|trust|bitcoin trust)|solidx.*etf|proshares.*(bitcoin|etf)|vaneck.*(etf|etn)|bitwise.*etf|valkyrie.*etf|invesco.*etf|franklin templeton.*etf|wisdomtree.*etf|21shares|hashdex.*etf|ibit|fbtc|bitb|arkb|hodl|btc etf|bitcoin etps?|bitcoin etns?|bitcoin trackers?|tracker certificates?.*bitcoin|vontobel.*bitcoin tracker|bitcoin tracker one|nyse arca.*etf|bats.*bitcoin|listed.*bitcoin etfs?|first (spot )?bitcoin etf|spot crypto etfs?|bitcoin and ether etfs?|ether etfs?|ethereum etfs?|crypto etns?|etns? to institutions|advisors.*spot bitcoin etfs?|largest.*spot bitcoin etf|overtakes.*gbtc|net inflows?.*etfs?|net outflows?.*etfs?|etfs?.*inflows?|etfs?.*outflows?|etfs?.*holdings?|etf options?|goldman sachs.*bitcoin etfs?|goldman joins etf|etf race|morgan stanley.*bitcoin etfs?|cetera approves.*bitcoin etfs?|fca opens crypto etns?|london stock exchange.*etns?|hong kong.*etfs?|brazil approves.*etfs?|sec delays.*etfs?|xbt provider|digitalx.*fund|blockfi files.*trust|trusts? go public|files? .*bitcoin trust|crypto assets fund|purpose (bitcoin )?etf|qbtc11|3iq.*bitcoin fund|coinshares.*etp|jacobi.*etf|purpose investments)\b/i;

const INSTITUTIONAL =
  /\b(microstrategy|corporate treasury|treasury (buy|purchase|hold|add|allocation)|buys? (over )?\$?\d+.*(million|billion).*btc|adds? \d+.*btc|balance sheet.*bitcoin|genesis acquires.*btc.*gbtc|selling gbtc shares|tim draper wins.*auction|wall street.*\$60 million.*bitcoin investment trust.*wealthy|mit raises.*bitcoin developers|whale (buy|add|move)|dormant.*whale|leave exchanges.*btc|accumulation begin)\b/i;

const ADOPTION =
  /\b(merchant[s]?|payment processor[s]?|bitpay|accept[s]? (bitcoin|btc|crypto)|bitcoin (payment[s]?|checkout|donation[s]?|atm[s]?)|pay with bitcoin|retailer[s]? accept|bitcoin users donate|venezuela.*hyperinflation.*bitcoin|cyprus bailout.*bitcoin soaring|spaniards rush.*bitcoin apps)\b/i;

const EXCHANGE =
  /\b((crypto|bitcoin) exchange (hack|launch|launches|listing|insolvency|withdrawal|abuses|pauses|pause)|mt\.?gox|homeland security.*dwolla|bitfinex|binance (hack|launch|pauses|withdrawal|settle)|coinbase (ipo|listing|launches)|kraken (launch|hack)|withdrawal halt|network congestion.*withdrawal)\b/i;

const DERIVATIVES =
  /\b(futures launch|bitcoin futures|options launch|bitcoin options|cme (group )?(launch|announces).*bitcoin futures|cboe.*bitcoin futures|cash-settled bitcoin futures|bitcoin reference rate|real-time index.*bitcoin|perpetual swap|perp contract|bakkt|ledgerx|deribit|bitmex|funding rate|open interest.*bitcoin)\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound|momentum|pressure)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%|falls below \$|slides? to \$|rebounds? to \$|bitcoin hovers|bitcoin tops|bitcoin swings|bitcoin climbs|bitcoin and dogecoin gain traction)\b/i;

const HALVING =
  /\b(halving (day|event|block|countdown|may not)|block reward halving|reward halving|post[- ]halving|pre[- ]halving|supply squeeze.*halving)\b/i;

const REGULATION =
  /\b(regulator|regulation|fca rules|sec charges|legal case|court rules|crypto ban|nigeria lifts.*ban|banking prudential)\b/i;

const PROTOCOL =
  /\b(bitcoin core|bip[\s-]?\d|segwit|taproot|soft fork|hard fork|protocol upgrade|developer funding|ordinals|brc-20)\b/i;

const MINING =
  /\b(hash ?rate|hashrate|mining (pool|rig|farm|company|hardware|difficulty)|miner[s]? (buy|ship|expand|sell|halt)|antminer|bitmain|51%|asic\b|gpu mining)\b/i;

const MACRO_OFF =
  /\b(stimulus bill|investment corp shifts|interest rate|imf aid|banking collapse|finance chiefs reshape imf|swine flu|numis reports|fundraiser.*fraud|climate change fund|debt worries|public distrust|rescue fund|oil spill|peace talks|planning fights|euro zone rescue|arch cru|trayvon martin|civil rights probe|swift institute launches|senate panel)\b/i;

function hasBitcoinContext(text: string) {
  return /\b(bitcoin|btc|crypto|etf|gbtc|grayscale|winklevoss|trust|blockchain)\b/i.test(text);
}

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2013-03-27": "Bitcoin price & cycles",
  "2014-02-02": "Bitcoin price & cycles",
  "2014-12-05": "Institutional Bitcoin & flows",
  "2015-04-03": "Bitcoin adoption",
  "2016-03-27": "Protocol & upgrades",
  "2016-05-03": "Derivatives",
  "2016-09-24": null,
  "2017-09-25": "Bitcoin price & cycles",
  "2019-11-13": "Bitcoin regulation",
  "2022-07-21": "Bitcoin price & cycles",
  "2023-12-23": "Bitcoin regulation",
  "2024-03-22": LEAF,
  "2024-04-05": LEAF,
  "2024-04-07": "Institutional Bitcoin & flows",
  "2024-08-15": LEAF,
  "2024-01-05": LEAF,
  "2024-08-20": LEAF,
  "2013-10-20": null,
  "2017-06-18": LEAF,
  "2019-11-13": LEAF,
  "2020-08-22": LEAF,
  "2020-11-19": LEAF,
  "2021-01-30": LEAF,
  "2021-09-30": LEAF,
  "2023-06-22": LEAF,
  "2023-11-10": LEAF,
  "2015-05-07": null,
  "2009-02-19": null,
  "2009-11-27": null,
  "2010-05-09": "Bailouts and stimulus",
  "2012-02-08": "Debt crises",
  "2012-02-29": null,
  "2012-04-25": null,
  "2012-07-21": null,
  "2013-01-19": null,
  "2013-10-23": "Exchanges",
  "2018-12-31": "Derivatives",
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  const etf = STRONG_ETF.test(s);
  const institutional = INSTITUTIONAL.test(s);
  const adoption = ADOPTION.test(s);

  if (MACRO_OFF.test(s) && !hasBitcoinContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary) return ranking.primary;
    return null;
  }

  if (EXCHANGE.test(s) && !etf) return "Exchanges";
  if (institutional && !etf) return "Institutional Bitcoin & flows";
  if (etf && !adoption) return LEAF;
  if (DERIVATIVES.test(s) && !etf) return "Derivatives";
  if (HALVING.test(s) && !etf) return "Halving events";
  if (PROTOCOL.test(s) && !etf && !institutional) return "Protocol & upgrades";
  if (MINING.test(s) && !etf) return "Bitcoin mining";
  if (REGULATION.test(s) && !etf) return "Bitcoin regulation";
  if (adoption && !etf) return "Bitcoin adoption";
  if (PRICE_ONLY.test(s) && !etf && !institutional) return "Bitcoin price & cycles";

  if (!hasBitcoinContext(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    if (ranking.primary && ranking.primary !== LEAF && (ranking.candidates[0]?.score ?? 0) >= 12) {
      return ranking.primary;
    }
    return null;
  }

  if (etf) return LEAF;

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

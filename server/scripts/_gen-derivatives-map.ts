/** One-off generator for retag-derivatives TARGET_BY_DATE. */
import "dotenv/config";
import { storage } from "../storage";

const LEAF = "Derivatives";

const STRONG_DERIV =
  /\b(bitcoin (futures|options|perp[s]?|perpetual[s]?|swap[s]?|derivative[s]?)|btc futures|btc options|cboe bitcoin|cm[e]? bitcoin|ledgerx|bitmex|deribit|icbit|bitcoin futures (market|contract|trading|launch|listing|approval)|futures (contract|market|trading|launch|listing)|options (market|contract|trading|launch)|cftc.*(bitcoin|btc).*(future|option|derivative)|regulated (bitcoin|btc) derivative|bitcoin etf.*future|future[s]? etf|bakkt.*(future|launch)|ledgerx.*(approval|launch)|cme.*(launch|list|bitcoin future)|cboe.*(launch|list|bitcoin future)|bitcoin (call|put) option|hashrate future|mining future.*bitcoin)\b/i;

const ETF =
  /\b(spot etf|bitcoin etf approval|etf approval|exchange-traded fund|gbtc|grayscale.*(trust|etf)|trust.*(launch|approval)|investment product|listed btc|spot bitcoin etf|sec approv.*etf)\b/i;

const EXCHANGE =
  /\b(exchange (hack|launch|launches|insolvency|withdrawal halt|shutdown|pauses)|mt\.?gox|bitfinex hack|binance hack|coinbase ipo|kraken launch|withdrawal halt|insolvency)\b/i;

const PRICE_ONLY =
  /\b(price (rises|falls|surge|drop|crash|rally|tumble|slip|climb|holds|gain|slide|rebound)|trades (near|at|above|below)|bullish|bearish|all[- ]time high|\bath\b|market cap|sell[- ]?off|liquidat|drops? to \$|gains? \d+\.\d+%)\b/i;

const MACRO_OFF =
  /\b(healthcare|health care|unemployment|housing market|recession|stimulus|bailout|derivatives rules|obama administration unveils|brooksley born|gensler races|house republicans delay|trade groups lobby|markit|dtcc|nyse euronext|deutsche boerse|federal reserve official backs centralized otc|oil and gas traders|zimbabwe marks|military aid to pakistan|barrick gold|cit group|fasb|icma and hong kong|china's foreign exchange|james purnell|conservatives seek to revive fox|g-20 ministers|japan intervenes)\b/i;

const INSTITUTIONAL =
  /\b(microstrategy|corporate treasury|custody launch|blackrock.*fund|institutional (flow|custody|investor)|grayscale holdings|nydig|fidelity custody)\b/i;

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  const overrides: Record<string, string | null> = {
    "2009-05-13": null,
    "2009-05-25": null,
    "2009-06-22": null,
    "2009-08-11": null,
    "2009-09-01": null,
    "2009-09-08": null,
    "2009-10-06": null,
    "2009-12-24": null,
    "2010-01-14": null,
    "2010-04-18": null,
    "2010-10-22": null,
    "2011-02-15": null,
    "2011-05-04": null,
    "2012-09-30": LEAF,
    "2012-10-01": LEAF,
    "2013-06-22": null,
    "2015-09-19": LEAF,
    "2017-03-25": LEAF,
    "2017-12-01": LEAF,
    "2017-12-10": LEAF,
    "2017-12-11": LEAF,
    "2017-12-17": LEAF,
    "2017-12-18": LEAF,
    "2018-01-17": LEAF,
    "2018-01-26": LEAF,
    "2018-02-07": LEAF,
    "2018-08-03": LEAF,
    "2019-09-23": LEAF,
    "2021-02-08": LEAF,
    "2021-04-14": LEAF,
    "2021-10-19": LEAF,
    "2022-06-13": LEAF,
    "2023-01-11": LEAF,
    "2023-04-17": LEAF,
    "2023-04-21": LEAF,
    "2023-10-23": LEAF,
    "2024-01-10": LEAF,
    "2024-03-19": LEAF,
    "2024-01-11": LEAF,
  };

  if (overrides[date] !== undefined) return overrides[date];

  if (MACRO_OFF.test(s) && !STRONG_DERIV.test(s)) return null;
  if (ETF.test(s) && !STRONG_DERIV.test(s)) return "ETFs and investment products";
  if (EXCHANGE.test(s) && !STRONG_DERIV.test(s)) return "Exchanges";
  if (INSTITUTIONAL.test(s) && !STRONG_DERIV.test(s)) return "Institutional Bitcoin & flows";
  if (PRICE_ONLY.test(s) && !STRONG_DERIV.test(s)) return "Bitcoin price & cycles";

  if (STRONG_DERIV.test(s)) return LEAF;

  if (/\b(bitcoin|btc)\b/i.test(s) && /\b(future|option|derivative|perp|swap|cme|cboe|ledgerx|bitmex|deribit|icbit|bakkt|cftc)\b/i.test(s)) {
    return LEAF;
  }

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

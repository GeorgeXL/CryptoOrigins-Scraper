/** One-off generator for retag-banking-stress TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Banking stress";

const TRADFI_BANK =
  /\b(bank[s]?|banking|bankers?|lender[s]?|fdic|aig\b|rbs\b|lloyds|hbos|aib\b|citigroup|barclays|ubs\b|credit suisse|deutsche bank|jpmorgan|goldman|wells fargo|hsbc|societe generale|fortis|kaupthing|anglo irish|bankia|monte dei paschi|svb|silicon valley bank|signature bank|silvergate|first republic|indymac|firstfed|lehman|bear stearns|merrill lynch|countrywide|kabul bank|popular inc|cit group|oneWest|virgin money|santander|blackstone.*property|bristol.*west|pibs)\b/i;

const CRYPTO_EXCHANGE =
  /\b(crypto exchange|bitcoin exchange|ftx collapse|ftx bankruptcy|binance hack|mt\.? gox|quadriga)\b/i;

const CRYPTO_LED =
  /\b(bitcoin|btc|ripple|crypto|cryptocurrency|ethereum)\b/i;

const BANK_STRESS =
  /\b(bank (failure|failures|fail|rescue|bailout|bail[- ]?in|collapse|crisis|stress|run|closure|closures|shut|shuts|recapital|recapitaliz|nationaliz|insolvency|insolvent|funding|liquidat|seize|seized)|failed bank[s]?|banking (crisis|stress|rescue|bailout|system|sector|group|collapse|reform|act)|toxic (assets?|loans?)|emergency (lending|funding|loan[s]?|support)|secretly lends?|interbank lending|libor|rig(s|ged)? libor|trading loss|trading losses|chapter 11|depositors? (lose|loss|haircut|convert|levy)|capital (raise|buffers?|rules|requirements)|recapitali[sz]e|bail[- ]?in|haircut on (big )?depositors|shoe[s]?.*shareholders|voting machine|stricter capital rules|asset sales.*capital|eurozone banks|european banks may fail|bank shares? collapse|shareholders? reject|executive warns.*banking crash|troubled (commercial )?property loans|cut risky assets|cyprus (advances )?rescue|bank of cyprus|greek banks receive|shuts banks|cash limits|loan losses|set aside.*loan|fitness to run.*bank|branch sale|sale collapse|stress test|systemic risk|too-big-to-fail|credit crunch.*bank|bank failures top|winding down.*lehman|lehman creditor|regulators shut|regulators seize|bank run|fitness to run|bonus.*bailout|bailout.*bonus|fitness to run a uk bank|lends.*own shares|banking scandal|banking turmoil|banking sector|bank reform|banking reform|banking group|bank holding|bank stake|bank shares|bank bonuses|bank rescue|bank failure|banking operations|banking crisis|banking stress|banking system|banking sector|banking group|banking collapse|banking scandal|banking turmoil|banking reform|banking act|banking rules|banking crash|banking stability|banking stability fears|banking stability|banking stability|deposit levy|levy on bank|big depositors|extra capital|risk buffers|mortgage securities|mortgage fraud)\b/i;

const BAILOUT_STIMULUS =
  /\b(stimulus|bailout funds?|foreclosure relief|auto bailout|tarp|700 billion bank rescue|bank rescue plan|cheap bank funding|funding for lending)\b/i;

const DEBT =
  /\b(debt (crisis|ceiling|restructuring|default)|sovereign debt|eurozone debt|debt crisis|fiscal showdown)\b/i;

const MONETARY =
  /\b(monetary policy|interest rate|basel iii|balance sheet policy)\b/i;

const HOUSING =
  /\b(mortgage[s]?|housing|fannie|freddie|home loan[s]?)\b/i;

const SECURITIES =
  /\b(mortgage (trade|fraud|securities)|sec claims|misleading mortgage)\b/i;

const LABOR =
  /\b(unemployment|jobless|jobs (data|report)|labor market|labour market|strike[s]?|union[s]?|postal service.*jobs)\b/i;

const POLITICS =
  /\b(election|campaign|wikileaks.*protest|withdraw their accounts in protest)\b/i;

const GLOBAL =
  /\b(recession|gdp|global (economy|growth|recovery)|markets rally|volatility|emerging market banks surge|investment banking lifts|earnings|quarterly (loss|profit))\b/i;

const OFF_TOPIC =
  /\b(tepco|fukushima|reactor[s]?|nuclear|ge'?s role|jeffrey immelt|hank paulson.*ge|fed (hack|confirms hack)|pharma|chilean miners|digital banking head|outage causes|absa'?s digital|microsoft shareholders reject adding bitcoin)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-03-10": "Global growth and recession",
  "2009-04-30": "Global growth and recession",
  "2009-08-10": null,
  "2010-01-15": "Global growth and recession",
  "2010-04-30": "Securities regulation",
  "2010-05-05": null,
  "2010-12-18": null,
  "2012-04-08": null,
  "2012-04-19": null,
  "2012-05-25": null,
  "2012-10-03": "Securities regulation",
  "2012-11-16": "Securities regulation",
  "2013-02-06": null,
  "2013-07-26": null,
  "2013-07-20": "Debt crises",
  "2009-10-23": LEAF,
  "2010-10-29": LEAF,
  "2024-12-15": "Bitcoin price & cycles",
};

function isCryptoTopic(leaf: string): boolean {
  return /\b(bitcoin|crypto|institutional|exchange|defi|stablecoin|mining|etf)\b/i.test(leaf);
}

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  if (CRYPTO_EXCHANGE.test(s) && !TRADFI_BANK.test(s)) return "Exchanges";

  if (CRYPTO_LED.test(s) && !TRADFI_BANK.test(s)) return "Bitcoin price & cycles";

  if (OFF_TOPIC.test(s)) return null;

  if (BANK_STRESS.test(s) || (TRADFI_BANK.test(s) && /\b(rescue|bailout|failure|collapse|crisis|stress|run|loss|fine|shut|seize|liquidat|insolv|recapital|deposit|capital|branch|reform|turmoil|scandal|regulator)\b/i.test(s))) {
    return LEAF;
  }

  if (BAILOUT_STIMULUS.test(s) && TRADFI_BANK.test(s)) return LEAF;
  if (BAILOUT_STIMULUS.test(s)) return "Bailouts and stimulus";

  if (SECURITIES.test(s)) return "Securities regulation";
  if (DEBT.test(s) && !TRADFI_BANK.test(s)) return "Debt crises";
  if (HOUSING.test(s) && !TRADFI_BANK.test(s)) return "Housing";
  if (LABOR.test(s)) return "Labor market";
  if (MONETARY.test(s) && !TRADFI_BANK.test(s)) return "Monetary policy & rates";
  if (POLITICS.test(s) && !TRADFI_BANK.test(s)) return "Politics and elections";

  if (GLOBAL.test(s)) {
    if (TRADFI_BANK.test(s)) return LEAF;
    return "Global growth and recession";
  }

  if (TRADFI_BANK.test(s)) return LEAF;

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 5);
  if (ranking.primary && ranking.primary !== LEAF && !isCryptoTopic(ranking.primary)) {
    if (ranking.confidence === "high" || (ranking.candidates[0]?.score ?? 0) >= 12) {
      return ranking.primary;
    }
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

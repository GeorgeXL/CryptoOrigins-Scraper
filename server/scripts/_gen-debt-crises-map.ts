/** One-off generator for retag-debt-crises TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";
import { evaluateStorylineFitHeuristic } from "@shared/storyline-fit-heuristics";

const LEAF = "Debt crises";

const DEBT_CRISIS =
  /\b(debt (crisis|ceiling|default|restructur|swap|limit|standoff|payment delay|commission|brinkmanship|deal|limit fight|promises|haircut|oversight|insurance)|sovereign debt|national debt|government debt|public debt|bond yield|borrowing cost|borrowing costs|credit (rating|downgrade|outlook)|bailout (fund|package|negotiation|repayment|deal|support|program)|greek (debt|bailout|crisis|default)|eurozone debt|portugal.*bailout|ireland.*bailout|spain.*bailout|italy.*(debt|borrowing)|dubai world|deficit (fear|crisis|ceiling|cut|revision|swell|higher|worries)|efsf|esm |fiscal compact|junk status|repay(ing|ment).*bailout|debt settlement|debt cancellation|debt restructuring|imf.*(loan|bailout|debt|program)|paris club|incinerator debt|target2|fitch.*(downgrade|cut|outlook|negative)|moody'?s.*(downgrade|cut|junk)|s&p.*(downgrade|cut|outlook|negative|junk)|standard & poor.*(downgrade|cut|outlook|negative|junk)|dagong.*downgrade|trillion[- ]dollar deficit|budget deficit|deficits swell|deficits? (rise|swell|grow|higher)|borrowing|debt surpass|debt tops|debt limit|debt ceiling|extraordinary measures|puerto rico.*(default|debt|promesa|bonds)|argentina.*(default|debt|holdout)|lebanon.*(default|debt|eurobond)|zambia.*(default|debt|eurobond)|sri lanka.*(default|debt|suspend)|ghana.*(debt|default|suspend)|promesa|debt oversight|holdout bondholder|eurobond|suspend(s|ing)? payment|avert(s|ing)? default|default fears|default risk|voluntary debt swap|debt swap|fiscal showdown|debt interest|debt promises|debt control plan|budget commission.*debt|tackle debt|unsustainable.*debt|debt grows|debt keeps rising|debt worries|debt fears|debt turmoil|debt deal|lift(s|ing)? the debt limit|hits? (its )?debt ceiling|failing to reach a deal with.*creditor)\b/i;

const SOVEREIGN_RATING =
  /\b((fitch|moody'?s|s&p|standard & poor).*(downgrade|cut|outlook|junk|negative).*(greece|spain|portugal|italy|uk|u\.s\.|us|united states|sovereign|eurozone|euro zone|britain)|credit (rating|outlook).*(negative|downgrade|junk|cut).*(debt|deficit|borrowing)|downgrades? (greece|spain|portugal|italy|uk|u\.s\.|us|nine euro zone sovereign).*(credit|debt|rating)|soaring debt and record borrowing)\b/i;

const BANKING_STRESS =
  /\b(bankia|bank (bailout|rescue|recapital)|banking (crisis|stress)|cyprus.*bailout|deposit (haircut|freeze)|dubai.*abu dhabi bailout|icelandic bank|landsbanki|failed bank investments)\b/i;

const MONETARY =
  /\b(federal reserve probes|fed probes|central bank.*(rate|policy|qe)|monetary policy|interest rate (cut|hike)|yuan swaps?|reserve currency|dollar weakness grows)\b/i;

const SECURITIES_LAW =
  /\b(sec charges|sec sues|cftc|subprime cdo|mortgage-backed|justice department.*sue.*s&p|ratings? (fraud|lawsuit).*subprime)\b/i;

const GLOBAL_GROWTH =
  /\b(recession drains|social security trust|soros warns euro|imf admits errors.*growth|china expands yuan swaps)\b/i;

const POLITICS =
  /\b(political unrest.*debt insurance|saudi and bahraini debt insurance.*unrest)\b/i;

const CRYPTO_LED =
  /\b(bitcoin|btc|ethereum|ether|cryptocurrency|crypto asset|crypto market)\b/i;

const OFF_TOPIC =
  /\b(ancient greek ideas on debt|reinhart and kenneth rogoff.?s debt threshold|academic|essay on debt|law firms urge companies to rewrite contracts|lawrence summers argues structural forces|s&p lobbies u\.s\. government|social security cuts, spending reductions|harrisburg faces crushing incinerator)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-01-06": LEAF,
  "2009-05-21": LEAF,
  "2009-07-20": LEAF,
  "2009-08-25": LEAF,
  "2009-09-24": null,
  "2009-11-30": LEAF,
  "2009-12-14": LEAF,
  "2010-01-18": "Banking stress",
  "2010-01-19": LEAF,
  "2010-01-20": LEAF,
  "2010-02-26": LEAF,
  "2010-03-27": LEAF,
  "2010-04-07": LEAF,
  "2010-04-15": LEAF,
  "2010-04-21": LEAF,
  "2010-04-22": LEAF,
  "2010-04-23": LEAF,
  "2010-05-21": LEAF,
  "2010-06-28": LEAF,
  "2010-08-19": "Banking stress",
  "2010-11-10": null,
  "2011-02-16": LEAF,
  "2011-04-10": LEAF,
  "2011-07-20": LEAF,
  "2011-08-02": "Monetary policy & rates",
  "2011-08-09": null,
  "2011-10-06": LEAF,
  "2012-02-22": LEAF,
  "2012-05-15": LEAF,
  "2012-06-14": LEAF,
  "2012-08-09": null,
  "2012-08-19": null,
  "2012-10-06": LEAF,
  "2012-10-28": LEAF,
  "2012-11-11": LEAF,
  "2013-02-04": "Legal cases",
  "2014-07-31": LEAF,
  "2015-08-03": LEAF,
  "2016-06-30": LEAF,
  "2016-07-01": LEAF,
  "2020-03-07": LEAF,
  "2020-11-13": LEAF,
  "2022-04-12": LEAF,
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  const heuristic = evaluateStorylineFitHeuristic(LEAF, s);
  if (heuristic.conflict && heuristic.suggestedLeaf) {
    return heuristic.suggestedLeaf;
  }

  if (CRYPTO_LED.test(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    return "Bitcoin price & cycles";
  }

  if (OFF_TOPIC.test(s)) return null;

  if (SECURITIES_LAW.test(s)) return "Legal cases";

  if (POLITICS.test(s)) return "Politics and elections";
  if (GLOBAL_GROWTH.test(s) && !DEBT_CRISIS.test(s) && !SOVEREIGN_RATING.test(s)) {
    return "Global growth and recession";
  }
  if (BANKING_STRESS.test(s) && !DEBT_CRISIS.test(s)) return "Banking stress";
  if (MONETARY.test(s) && !DEBT_CRISIS.test(s) && !SOVEREIGN_RATING.test(s)) {
    return "Monetary policy & rates";
  }

  if (DEBT_CRISIS.test(s) || SOVEREIGN_RATING.test(s)) return LEAF;

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 5);
  if (ranking.primary && ranking.primary !== LEAF) {
    if (ranking.confidence === "high" || (ranking.candidates[0]?.score ?? 0) >= 10) {
      return ranking.primary;
    }
  }

  if (ranking.candidates.some((c) => c.leaf === LEAF && c.score >= 6)) return LEAF;
  if (ranking.primary && ranking.primary !== LEAF) return ranking.primary;
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

  const moves = rows
    .filter((r) => map[r.date] !== LEAF)
    .map((r) => ({ date: r.date, to: map[r.date], summary: r.summary?.slice(0, 90) }));
  console.error("moves:", JSON.stringify(moves, null, 2));

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

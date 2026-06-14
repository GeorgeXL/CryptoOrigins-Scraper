/** One-off generator for retag-monetary-policy-rates TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";
import { evaluateStorylineFitHeuristic } from "@shared/storyline-fit-heuristics";

const LEAF = "Monetary policy & rates";

const MONETARY_POLICY =
  /\b(federal reserve|\bfed\b|interest rate[s]?|rate (cut|hike|hold|decision|near zero|unchanged)|central bank|ecb\b|bank of england|bank of japan|boj|bundesbank|swiss national bank|monetary policy|qe\d|quantitative easing|open-ended stimulus|mortgage bond|treasur(y|ies) buying|discount window|libor|euribor|reserve requirement|tighter policy|taper|yield curve|fomc|bernanke|yellen|powell|draghi|kohn|weidmann|hildebbrand|zoellick|negative real interest|keeps rates|cuts interest|raises interest|rate hike|rate cut)\b/i;

const INFLATION =
  /\b(inflation (crisis|surge|print|rate|cools|climbs|hits)|hyperinflation|consumer price|cpi|bolivar.*devalu|zimbabwe abandon|devalues the bolivar)\b/i;

const BANKING_STRESS =
  /\b(bank (failure|rescue|bailout|stress|crash)|hbos|jpmorgan.*loss|barclays.*libor|greek bank|cyprus.*deposit|svb|banking crash)\b/i;

const DEBT =
  /\b(debt (ceiling|crisis)|sovereign debt|deficit|bailout push|treasury.*debt)\b/i;

const GLOBAL_GROWTH =
  /\b(recession|recovery|gdp|growth (slow|weak)|unemployment)\b/i;

const CRYPTO_PRICE =
  /\b(bitcoin (price|surge|fall|rally|drop|crash|trading|gains|slides|rebound|hovers)|btc (price|trading|surge|fall)|crypto (market|trading|price))\b/i;

const CRYPTO_ADOPTION =
  /\b(bitcoin usage|bitcoin adoption|accept bitcoin|pay with bitcoin|lightning network payment)\b/i;

const BITCOIN_REGULATION =
  /\b(bitcoin regulation|crypto regulation|sec.*bitcoin|fca.*crypto)\b/i;

const OFF_TOPIC =
  /\b(caterpillar|xerox|at&t|3m|pelosi.*tax cut|estonia.*euro transition|bep prints|siemens.*nuclear|philippines|hong kong weakens.*peg|china.*reserve[s]? top|dollar weakens.*imbalances|world bank.*dollar dominance|treasury delays.*china currency|economist's view|steve keen|gao.*conflict|imf.*global reserve currency|talaf|ripple.*svb)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-01-29": "Inflation",
  "2009-04-23": "Debt crises",
  "2009-06-07": "Global growth and recession",
  "2009-06-15": null,
  "2009-09-28": LEAF,
  "2010-01-09": "Inflation",
  "2010-07-22": null,
  "2010-08-02": "Politics and elections",
  "2010-10-26": "Inflation",
  "2011-01-01": "Global growth and recession",
  "2011-04-15": "Inflation",
  "2011-04-19": "Global growth and recession",
  "2011-04-20": "Inflation",
  "2011-05-18": "Global growth and recession",
  "2011-09-17": null,
  "2011-11-24": "Bailouts and stimulus",
  "2012-06-02": "Debt crises",
  "2012-06-27": "Banking stress",
  "2012-10-21": "Global growth and recession",
  "2013-07-16": "Bitcoin adoption",
  "2016-10-08": "Bitcoin price & cycles",
  "2020-09-29": "Bitcoin adoption",
  "2020-12-08": "Institutional Bitcoin & flows",
  "2014-04-07": "Bitcoin regulation",
  "2015-11-17": "Bitcoin regulation",
  "2022-05-07": "Bitcoin regulation",
  "2023-03-12": "Banking stress",
  "2022-06-04": "Stablecoins",
  "2013-11-16": "Bitcoin regulation",
  "2014-04-25": "Bitcoin regulation",
  "2014-06-24": "Bitcoin regulation",
  "2017-01-18": "Bitcoin regulation",
  "2009-07-22": LEAF,
  "2011-09-15": LEAF,
  "2014-04-07": "Bitcoin regulation",
  "2022-05-07": "Bitcoin regulation",
  "2015-06-28": "Banking stress",
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  const heuristic = evaluateStorylineFitHeuristic(LEAF, s);
  if (heuristic.conflict && heuristic.suggestedLeaf) {
    return heuristic.suggestedLeaf;
  }

  if (CRYPTO_PRICE.test(s)) return "Bitcoin price & cycles";
  if (CRYPTO_ADOPTION.test(s)) return "Bitcoin adoption";
  if (BITCOIN_REGULATION.test(s)) return "Bitcoin regulation";

  if (/\b(bitcoin|btc|crypto|ethereum|ether)\b/i.test(s)) {
    if (CRYPTO_ADOPTION.test(s)) return "Bitcoin adoption";
    if (BITCOIN_REGULATION.test(s)) return "Bitcoin regulation";
    if (/\b(institutional|microstrategy|saylor|corporate treasury|hedge against inflation)\b/i.test(s)) {
      return "Institutional Bitcoin & flows";
    }
    // Crypto-led headline — macro policy is backdrop only
    return "Bitcoin price & cycles";
  }

  if (OFF_TOPIC.test(s) && !MONETARY_POLICY.test(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.confidence === "high" && ranking.primary) return ranking.primary;
    return null;
  }

  if (BANKING_STRESS.test(s) && !MONETARY_POLICY.test(s)) return "Banking stress";
  if (DEBT.test(s) && !MONETARY_POLICY.test(s) && !INFLATION.test(s)) return "Debt crises";
  if (INFLATION.test(s) && !MONETARY_POLICY.test(s)) return "Inflation";
  if (GLOBAL_GROWTH.test(s) && !MONETARY_POLICY.test(s)) return "Global growth and recession";

  if (MONETARY_POLICY.test(s)) return LEAF;

  const ranking = rankTopicCandidatesFromSummary({ summary: s }, 5);
  if (ranking.primary && ranking.primary !== LEAF && ranking.confidence === "high") {
    return ranking.primary;
  }
  if (ranking.candidates[0] && ranking.candidates[0].leaf !== LEAF && ranking.candidates[0].score >= 12) {
    return ranking.candidates[0].leaf;
  }

  return LEAF;
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
    .map((r) => ({ date: r.date, to: map[r.date], summary: r.summary?.slice(0, 80) }));
  console.error("moves sample:", JSON.stringify(moves.slice(0, 10), null, 2));

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

/** One-off generator for retag-labor-market TARGET_BY_DATE. */
import "dotenv/config";

import { storage } from "../storage";
import { rankTopicCandidatesFromSummary } from "../services/editorial-pipeline/storyline-taxonomy";
import { evaluateStorylineFitHeuristic } from "@shared/storyline-fit-heuristics";

const LEAF = "Labor market";

const LABOR =
  /\b(unemployment|jobless|jobs? (report|data|loss|growth|cut|vanish|add|boom|openings)|payroll[s]?|labor market|labour market|layoff[s]?|strike[s]?|union[s]?|wage[s]?|workers?|employer[s]?|hiring|apprenticeship[s]?|buyout[s]?|bonus(es)?|middle class|executive pay|inequality.*wage|pay gap|pension plan[s]?|state jobs?|mail center[s]?.*job|postal service.*(job|worker|buyout)|general strike|adp says|nonfarm|jobless claims)\b/i;

const POLITICS =
  /\b(fundraise[s]?|campaign|democrat[s]?|republican[s]?|election)\b/i;

const BAILOUTS =
  /\b(stimulus|bailout|fiscal package|emergency program)\b/i;

const DEBT =
  /\b(deficit|debt ceiling|budget review|fiscal outlook)\b/i;

const GLOBAL_GROWTH =
  /\b(recession|recovery|gdp|growth (slow|weak)|bernanke signals)\b/i;

const MONETARY =
  /\b(federal reserve|interest rate|monetary policy|fomc|bernanke)\b/i;

const ENFORCEMENT =
  /\b(fintrac|penalt(y|ies)|laundering|fraud case[s]?|kucoin)\b/i;

const BITCOIN_ADOPTION =
  /\b(bitcoin ecosystem|paycheck[s]? into bitcoin|bitcoin jobs|coinality|strike lets|accept bitcoin|pay with bitcoin)\b/i;

const CRYPTO_PRICE =
  /\b(bitcoin (price|surge|fall|rally|drop|crash|trading)|btc (price|trading))\b/i;

const OFF_TOPIC =
  /\b(phoenix rescue|chilean miners?|trapped miners?|rescue capsule)\b/i;

/** Date-specific editorial overrides (checked first). */
const OVERRIDES: Record<string, string | null> = {
  "2009-02-26": LEAF,
  "2009-04-05": LEAF,
  "2009-07-01": LEAF,
  "2009-07-02": LEAF,
  "2009-07-20": "Debt crises",
  "2009-08-26": LEAF,
  "2009-11-02": LEAF,
  "2010-02-05": LEAF,
  "2010-05-29": "Enforcement & crime",
  "2010-06-15": LEAF,
  "2010-07-03": LEAF,
  "2010-08-03": "Politics and elections",
  "2010-08-05": "Bailouts and stimulus",
  "2010-09-26": null,
  "2011-01-08": "Global growth and recession",
  "2011-03-27": LEAF,
  "2011-04-28": LEAF,
  "2011-05-06": LEAF,
  "2011-05-31": "Bitcoin adoption",
  "2011-07-18": LEAF,
  "2011-12-05": LEAF,
  "2012-01-15": LEAF,
  "2012-01-17": LEAF,
  "2012-04-09": LEAF,
  "2012-10-27": LEAF,
  "2014-04-30": "Bitcoin adoption",
  "2015-02-16": LEAF,
  "2020-02-01": "Politics and elections",
  "2021-10-14": "Bitcoin adoption",
};

function classify(date: string, summary: string): string | null {
  const s = summary.trim();
  if (!s) return null;

  if (OVERRIDES[date] !== undefined) return OVERRIDES[date];

  const heuristic = evaluateStorylineFitHeuristic(LEAF, s);
  if (heuristic.conflict && heuristic.suggestedLeaf) {
    return heuristic.suggestedLeaf;
  }

  if (OFF_TOPIC.test(s)) return null;
  if (ENFORCEMENT.test(s)) return "Enforcement & crime";
  if (BITCOIN_ADOPTION.test(s)) return "Bitcoin adoption";
  if (CRYPTO_PRICE.test(s)) return "Bitcoin price & cycles";

  if (/\b(bitcoin|btc|crypto|ethereum|ether)\b/i.test(s)) {
    const ranking = rankTopicCandidatesFromSummary({ summary: s }, 3);
    if (ranking.primary && ranking.primary !== LEAF) return ranking.primary;
    return "Bitcoin adoption";
  }

  if (POLITICS.test(s) && !LABOR.test(s)) return "Politics and elections";
  if (BAILOUTS.test(s) && !LABOR.test(s)) return "Bailouts and stimulus";
  if (DEBT.test(s) && !LABOR.test(s)) return "Debt crises";
  if (MONETARY.test(s) && !LABOR.test(s)) return "Monetary policy & rates";
  if (GLOBAL_GROWTH.test(s) && !LABOR.test(s)) return "Global growth and recession";

  if (LABOR.test(s)) return LEAF;

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

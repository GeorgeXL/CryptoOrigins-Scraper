/**
 * Retag rows on Monetary policy & rates — editorial map from main-events-leaf-prompts rules.
 *
 * Usage:
 *   npx tsx server/scripts/retag-monetary-policy-rates.ts --dry-run
 *   npx tsx server/scripts/retag-monetary-policy-rates.ts --apply
 *   npx tsx server/scripts/retag-monetary-policy-rates.ts --apply --from 2010-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Monetary policy & rates";

/** Editorial map for every row currently tagged Monetary policy & rates (100 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-14": "Monetary policy & rates",
  "2009-01-28": "Monetary policy & rates",
  "2009-01-29": "Inflation",
  "2009-02-24": "Monetary policy & rates",
  "2009-03-03": "Monetary policy & rates",
  "2009-03-05": "Monetary policy & rates",
  "2009-03-11": "Monetary policy & rates",
  "2009-03-18": "Monetary policy & rates",
  "2009-03-19": "Monetary policy & rates",
  "2009-03-20": "Monetary policy & rates",
  "2009-05-27": "Monetary policy & rates",
  "2009-05-29": "Monetary policy & rates",
  "2009-06-07": "Global growth and recession",
  "2009-06-15": null,
  "2009-06-18": "Monetary policy & rates",
  "2009-07-09": "Monetary policy & rates",
  "2009-07-18": "Monetary policy & rates",
  "2009-08-12": "Monetary policy & rates",
  "2009-09-15": "Monetary policy & rates",
  "2009-09-28": "Monetary policy & rates",
  "2009-10-08": "Monetary policy & rates",
  "2009-10-27": "Monetary policy & rates",
  "2009-11-13": "Monetary policy & rates",
  "2009-11-16": "Monetary policy & rates",
  "2009-12-03": "Monetary policy & rates",
  "2010-01-11": "Monetary policy & rates",
  "2010-01-20": "Debt crises",
  "2010-01-23": "Monetary policy & rates",
  "2010-01-28": "Monetary policy & rates",
  "2010-05-11": "Monetary policy & rates",
  "2010-05-12": "Monetary policy & rates",
  "2010-06-01": "Monetary policy & rates",
  "2010-06-13": "Monetary policy & rates",
  "2010-06-17": "Monetary policy & rates",
  "2010-06-23": "Monetary policy & rates",
  "2010-08-10": "Monetary policy & rates",
  "2010-10-31": "Monetary policy & rates",
  "2010-11-03": "Monetary policy & rates",
  "2010-11-04": "Monetary policy & rates",
  "2010-11-23": "Monetary policy & rates",
  "2010-12-01": "Monetary policy & rates",
  "2011-03-10": "Monetary policy & rates",
  "2011-03-14": "Monetary policy & rates",
  "2011-03-21": "Monetary policy & rates",
  "2011-04-26": "Monetary policy & rates",
  "2011-05-11": "Monetary policy & rates",
  "2011-09-08": "Monetary policy & rates",
  "2011-09-16": "Monetary policy & rates",
  "2011-09-17": null,
  "2011-10-04": "Monetary policy & rates",
  "2011-10-19": "Monetary policy & rates",
  "2011-12-08": "Monetary policy & rates",
  "2011-12-27": "Monetary policy & rates",
  "2012-01-05": "Monetary policy & rates",
  "2012-01-25": "Monetary policy & rates",
  "2012-02-27": "Monetary policy & rates",
  "2012-07-02": "Monetary policy & rates",
  "2012-07-26": "Monetary policy & rates",
  "2012-08-26": "Monetary policy & rates",
  "2012-08-31": "Monetary policy & rates",
  "2012-09-13": "Monetary policy & rates",
  "2012-09-14": "Monetary policy & rates",
  "2012-10-21": "Global growth and recession",
  "2012-12-12": "Monetary policy & rates",
  "2012-12-16": "Monetary policy & rates",
  "2012-12-26": "Inflation",
  "2013-03-14": "Monetary policy & rates",
  "2013-06-04": "Bitcoin price & cycles",
  "2013-07-16": "Bitcoin adoption",
  "2013-08-19": "Monetary policy & rates",
  "2013-11-16": "Bitcoin regulation",
  "2013-12-31": "Monetary policy & rates",
  "2014-04-07": "Bitcoin regulation",
  "2014-04-15": "Bitcoin price & cycles",
  "2015-06-28": "Banking stress",
  "2016-01-30": "Monetary policy & rates",
  "2016-04-24": "Bitcoin price & cycles",
  "2016-10-07": "Monetary policy & rates",
  "2017-02-19": "Bitcoin price & cycles",
  "2017-02-22": "Bitcoin price & cycles",
  "2017-04-08": "Bitcoin price & cycles",
  "2017-08-25": "Monetary policy & rates",
  "2018-10-09": "Bitcoin price & cycles",
  "2019-07-11": "Bitcoin price & cycles",
  "2020-03-03": "Monetary policy & rates",
  "2020-07-16": "Monetary policy & rates",
  "2020-09-29": "Bitcoin adoption",
  "2021-02-21": "Monetary policy & rates",
  "2021-03-01": "Inflation",
  "2021-03-17": "Bitcoin price & cycles",
  "2022-03-08": "Bitcoin price & cycles",
  "2022-06-04": "Stablecoins",
  "2022-08-30": "Bitcoin price & cycles",
  "2022-11-06": "Bitcoin price & cycles",
  "2023-01-06": "Bitcoin price & cycles",
  "2023-06-13": "Bitcoin regulation",
  "2024-01-31": "Bitcoin price & cycles",
  "2024-06-08": "Bitcoin price & cycles",
  "2024-06-14": "Debt crises",
  "2024-12-18": "Monetary policy & rates",
};

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = true;
  let from: string | null = null;
  let to: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--apply") dryRun = false;
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--from" && args[i + 1]) from = args[++i]!;
    else if (args[i] === "--to" && args[i + 1]) to = args[++i]!;
  }

  return { dryRun, from, to };
}

function inDateRange(date: string, from: string | null, to: string | null) {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

async function applyTarget(date: string, target: string | null, dryRun: boolean) {
  if (dryRun) return;

  if (!target) {
    await syncStorylineAssignmentsForDate(date, []);
    await db
      .update(historicalNewsAnalyses)
      .set({ topicCategories: [] })
      .where(eq(historicalNewsAnalyses.date, date));
    return;
  }

  await db
    .update(historicalNewsAnalyses)
    .set({ topicCategories: [target] })
    .where(eq(historicalNewsAnalyses.date, date));
  await syncStorylineAssignmentsForDate(date, [target]);
}

async function main() {
  const { dryRun, from, to } = parseArgs();
  const rows = await storage.getAnalysesForStorylineLeaf(LEAF);
  const slice = rows.filter((row) => inDateRange(row.date, from, to));

  const stats = { keep: 0, moved: 0, cleared: 0, skipped: 0, missingMap: 0 };

  console.log(
    JSON.stringify({
      mode: dryRun ? "dry-run" : "apply",
      totalOnLeaf: rows.length,
      from,
      to,
      batchSize: slice.length,
    }),
  );

  for (const row of slice) {
    const target = TARGET_BY_DATE[row.date];
    if (target === undefined) {
      stats.missingMap += 1;
      console.log(JSON.stringify({ date: row.date, action: "SKIP", reason: "no map entry" }));
      continue;
    }

    if (target === LEAF) {
      stats.keep += 1;
      console.log(JSON.stringify({ date: row.date, action: "KEEP", target }));
      continue;
    }

    if (target === null) {
      stats.cleared += 1;
      console.log(
        JSON.stringify({
          date: row.date,
          action: dryRun ? "WOULD_CLEAR" : "CLEAR",
          summary: row.summary?.slice(0, 80),
        }),
      );
      await applyTarget(row.date, null, dryRun);
      continue;
    }

    stats.moved += 1;
    console.log(
      JSON.stringify({
        date: row.date,
        action: dryRun ? "WOULD_MOVE" : "MOVE",
        from: LEAF,
        to: target,
        summary: row.summary?.slice(0, 80),
      }),
    );
    await applyTarget(row.date, target, dryRun);
  }

  console.log(JSON.stringify({ stats }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Retag rows on Bitcoin regulation — Laws, bans, and regulator actions specifically targeting Bitcoin.
 *
 * Usage:
 *   npx tsx server/scripts/retag-bitcoin-regulation.ts --dry-run
 *   npx tsx server/scripts/retag-bitcoin-regulation.ts --apply
 *   npx tsx server/scripts/retag-bitcoin-regulation.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Bitcoin regulation";

/** Editorial map for every row currently tagged Bitcoin regulation (128 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-06-30": "Bitcoin regulation",
  "2011-04-04": null,
  "2011-06-09": "Enforcement & crime",
  "2011-06-10": "Enforcement & crime",
  "2012-09-24": "Bitcoin regulation",
  "2012-09-27": "Bitcoin regulation",
  "2013-03-18": "Bitcoin regulation",
  "2013-05-07": "Bitcoin regulation",
  "2013-05-13": "Bitcoin regulation",
  "2013-05-30": "Bitcoin regulation",
  "2013-05-31": "Bitcoin regulation",
  "2013-06-13": "Bitcoin regulation",
  "2013-06-23": "Bitcoin regulation",
  "2013-06-24": "Bitcoin regulation",
  "2013-07-08": "Bitcoin regulation",
  "2013-07-12": "Bitcoin regulation",
  "2013-08-12": "Bitcoin regulation",
  "2013-08-15": "Bitcoin regulation",
  "2013-08-17": "Bitcoin regulation",
  "2013-09-05": "Bitcoin regulation",
  "2013-09-13": "Bitcoin regulation",
  "2013-09-19": "Bitcoin regulation",
  "2013-09-28": "Bitcoin regulation",
  "2013-10-21": "Tax policy",
  "2013-11-14": "Bitcoin regulation",
  "2013-11-16": "Bitcoin regulation",
  "2013-11-19": "Bitcoin regulation",
  "2013-12-14": "Bitcoin regulation",
  "2013-12-15": "Tax policy",
  "2013-12-23": "Bitcoin regulation",
  "2014-01-04": "Bitcoin regulation",
  "2014-01-29": "Bitcoin regulation",
  "2014-02-13": "Bitcoin regulation",
  "2014-02-26": "Bitcoin regulation",
  "2014-03-02": "Tax policy",
  "2014-03-26": "Bitcoin regulation",
  "2014-04-07": "Monetary policy & rates",
  "2014-04-09": "Bitcoin regulation",
  "2014-05-14": "Bitcoin regulation",
  "2014-06-06": "Bitcoin regulation",
  "2014-06-19": "Bitcoin regulation",
  "2014-06-24": "Bitcoin regulation",
  "2014-06-28": "Bitcoin regulation",
  "2014-06-29": "Bitcoin regulation",
  "2014-07-06": "Bitcoin regulation",
  "2014-07-11": "Bitcoin regulation",
  "2014-07-17": "Bitcoin regulation",
  "2014-08-02": "Bitcoin regulation",
  "2014-08-06": "Bitcoin regulation",
  "2014-08-09": "Bitcoin regulation",
  "2014-08-12": "Bitcoin regulation",
  "2014-08-20": "Tax policy",
  "2014-09-21": "Bitcoin regulation",
  "2014-10-03": "Bitcoin regulation",
  "2014-10-31": "Bitcoin regulation",
  "2014-11-27": "Bitcoin regulation",
  "2014-12-04": "Bitcoin regulation",
  "2015-01-13": "Bitcoin regulation",
  "2015-02-03": "Bitcoin regulation",
  "2015-02-14": "Bitcoin regulation",
  "2015-05-02": "Bitcoin regulation",
  "2015-05-05": null,
  "2015-05-15": "Bitcoin regulation",
  "2015-06-04": "Bitcoin regulation",
  "2015-06-05": "Bitcoin regulation",
  "2015-06-11": "Bitcoin regulation",
  "2015-06-19": "Bitcoin regulation",
  "2015-06-24": "Bitcoin regulation",
  "2015-07-12": "Bitcoin regulation",
  "2015-07-28": "Bitcoin regulation",
  "2015-07-29": "Bitcoin regulation",
  "2015-08-10": "Bitcoin regulation",
  "2015-09-03": "Bitcoin regulation",
  "2015-09-17": "Bitcoin regulation",
  "2015-09-20": "Bitcoin regulation",
  "2015-09-22": "Bitcoin regulation",
  "2015-10-26": "Bitcoin regulation",
  "2015-11-16": "Bitcoin regulation",
  "2015-12-16": "Bitcoin regulation",
  "2015-12-24": "Bitcoin regulation",
  "2016-03-16": "Bitcoin regulation",
  "2016-03-21": "Tax policy",
  "2016-03-31": "Bitcoin regulation",
  "2016-04-20": "Bitcoin regulation",
  "2016-06-06": "Bitcoin regulation",
  "2016-06-22": "Bitcoin regulation",
  "2016-07-05": "Bitcoin regulation",
  "2016-07-28": "Bitcoin regulation",
  "2016-08-12": "Bitcoin regulation",
  "2016-09-26": "Bitcoin regulation",
  "2016-11-17": "Bitcoin regulation",
  "2016-11-25": "Bitcoin regulation",
  "2017-01-06": "Bitcoin regulation",
  "2017-03-07": "Bitcoin regulation",
  "2017-05-31": "Bitcoin regulation",
  "2017-06-03": "Bitcoin regulation",
  "2017-06-06": "Bitcoin regulation",
  "2017-06-10": "Bitcoin regulation",
  "2017-06-27": "Bitcoin regulation",
  "2017-07-04": "Bitcoin regulation",
  "2017-08-10": "Bitcoin regulation",
  "2017-09-08": "Bitcoin regulation",
  "2017-10-18": "Bitcoin regulation",
  "2017-12-12": "Bitcoin regulation",
  "2017-12-26": "Bitcoin regulation",
  "2018-02-10": "Banking & prudential (crypto)",
  "2018-04-07": "Bitcoin regulation",
  "2019-02-04": "Legal cases",
  "2019-10-02": "Bitcoin regulation",
  "2020-09-24": "Bitcoin regulation",
  "2021-04-16": "Bitcoin regulation",
  "2021-05-19": "Bitcoin regulation",
  "2021-06-15": "Bitcoin regulation",
  "2021-09-24": "Bitcoin regulation",
  "2021-11-23": "Bitcoin regulation",
  "2022-02-28": "Bitcoin regulation",
  "2022-03-11": "Bitcoin regulation",
  "2022-04-21": "Bitcoin regulation",
  "2022-07-16": "Bitcoin regulation",
  "2022-07-18": "Bitcoin regulation",
  "2022-10-14": "Bitcoin regulation",
  "2023-02-11": "Bitcoin regulation",
  "2023-06-13": "Bitcoin regulation",
  "2023-08-16": "Bitcoin regulation",
  "2023-12-25": "Bitcoin regulation",
  "2024-03-21": "Bitcoin regulation",
  "2024-06-04": "Bitcoin regulation",
  "2024-07-01": "Bitcoin regulation",
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

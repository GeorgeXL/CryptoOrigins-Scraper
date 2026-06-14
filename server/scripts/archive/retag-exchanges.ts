/**
 * Retag rows on Exchanges — keep exchange founding, launch, licensing, hacks, insolvency, withdrawal halts, and shutdowns.
 *
 * Usage:
 *   npx tsx server/scripts/retag-exchanges.ts --dry-run
 *   npx tsx server/scripts/retag-exchanges.ts --apply
 *   npx tsx server/scripts/retag-exchanges.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Exchanges";

/** Editorial map for every row currently tagged Exchanges (360 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-07-15": "Exchanges",
  "2010-02-06": "Exchanges",
  "2010-03-17": "Exchanges",
  "2010-07-26": "Exchanges",
  "2010-10-17": "Exchanges",
  "2011-01-07": "Exchanges",
  "2011-03-01": "Exchanges",
  "2011-03-16": "Exchanges",
  "2011-04-05": "Exchanges",
  "2011-04-27": "Exchanges",
  "2011-06-01": "Exchanges",
  "2011-06-02": "Exchanges",
  "2011-06-19": "Exchanges",
  "2011-06-20": "Exchanges",
  "2011-07-10": "Exchanges",
  "2011-07-11": "Exchanges",
  "2011-07-12": "Exchanges",
  "2011-07-14": "Exchanges",
  "2011-08-01": "Exchanges",
  "2011-08-05": "Exchanges",
  "2011-08-11": "Exchanges",
  "2011-11-16": "Exchanges",
  "2011-11-17": "Exchanges",
  "2011-12-06": "Exchanges",
  "2011-12-13": "Exchanges",
  "2011-12-21": "Exchanges",
  "2012-01-06": "Exchanges",
  "2012-02-13": "Exchanges",
  "2012-02-24": "Exchanges",
  "2012-03-01": "Exchanges",
  "2012-03-06": "Exchanges",
  "2012-05-01": "Exchanges",
  "2012-05-09": "Exchanges",
  "2012-05-11": "Exchanges",
  "2012-05-14": "Exchanges",
  "2012-05-29": "Exchanges",
  "2012-06-05": "Exchanges",
  "2012-06-23": "Exchanges",
  "2012-07-01": "Exchanges",
  "2012-07-15": "Exchanges",
  "2012-07-16": "Exchanges",
  "2012-07-30": "Exchanges",
  "2012-08-13": "Exchanges",
  "2012-08-16": "Exchanges",
  "2012-08-29": "Exchanges",
  "2012-09-04": "Exchanges",
  "2012-09-05": "Exchanges",
  "2012-09-25": "Exchanges",
  "2012-09-26": "Exchanges",
  "2012-10-26": "Exchanges",
  "2012-12-06": "Exchanges",
  "2012-12-09": "Exchanges",
  "2012-12-10": "Exchanges",
  "2013-02-10": "Exchanges",
  "2013-02-27": "Exchanges",
  "2013-03-07": "Exchanges",
  "2013-03-08": "Exchanges",
  "2013-03-10": "Exchanges",
  "2013-04-03": "Exchanges",
  "2013-04-04": "Exchanges",
  "2013-04-14": "Exchanges",
  "2013-04-18": "Exchanges",
  "2013-04-19": "Exchanges",
  "2013-04-21": "Exchanges",
  "2013-04-25": "Exchanges",
  "2013-04-27": "Exchanges",
  "2013-04-28": "Exchanges",
  "2013-05-02": "Exchanges",
  "2013-05-04": "Exchanges",
  "2013-05-09": "Exchanges",
  "2013-05-14": "Exchanges",
  "2013-05-15": "Exchanges",
  "2013-05-17": "Exchanges",
  "2013-05-29": "Exchanges",
  "2013-06-01": "Exchanges",
  "2013-06-08": "Exchanges",
  "2013-06-17": "Exchanges",
  "2013-06-21": "Exchanges",
  "2013-06-29": "Exchanges",
  "2013-07-04": "Exchanges",
  "2013-07-13": "Exchanges",
  "2013-07-21": "Exchanges",
  "2013-07-29": "Exchanges",
  "2013-08-06": "Exchanges",
  "2013-08-23": "Exchanges",
  "2013-09-04": "Exchanges",
  "2013-09-10": "Exchanges",
  "2013-09-18": "Exchanges",
  "2013-09-29": "Exchanges",
  "2013-10-03": "Exchanges",
  "2013-10-13": "Exchanges",
  "2013-10-23": "Exchanges",
  "2013-10-24": "Exchanges",
  "2013-10-26": "Exchanges",
  "2013-11-03": "Exchanges",
  "2013-11-04": "Exchanges",
  "2013-11-10": "Exchanges",
  "2013-11-13": "Exchanges",
  "2013-12-13": "Exchanges",
  "2013-12-17": "Exchanges",
  "2014-01-17": "Exchanges",
  "2014-01-19": "Exchanges",
  "2014-02-01": "Exchanges",
  "2014-02-07": "Exchanges",
  "2014-02-11": "Exchanges",
  "2014-02-12": "Exchanges",
  "2014-02-14": "Exchanges",
  "2014-02-15": "Exchanges",
  "2014-02-16": "Exchanges",
  "2014-02-17": "Exchanges",
  "2014-02-24": "Exchanges",
  "2014-02-25": "Exchanges",
  "2014-02-28": "Exchanges",
  "2014-03-09": "Exchanges",
  "2014-03-12": "Exchanges",
  "2014-03-17": "Exchanges",
  "2014-03-20": "Exchanges",
  "2014-03-23": "Exchanges",
  "2014-03-30": "Exchanges",
  "2014-03-31": "Bitcoin adoption",
  "2014-04-02": "Exchanges",
  "2014-04-03": "Exchanges",
  "2014-04-26": "Exchanges",
  "2014-05-02": "Exchanges",
  "2014-05-06": "Exchanges",
  "2014-05-10": "Exchanges",
  "2014-05-11": "Exchanges",
  "2014-05-15": "Exchanges",
  "2014-05-16": "Exchanges",
  "2014-05-24": "Exchanges",
  "2014-05-28": "Exchanges",
  "2014-05-31": "Smart contracts & L1s",
  "2014-06-12": "Exchanges",
  "2014-07-09": "Exchanges",
  "2014-07-12": "Exchanges",
  "2014-08-11": "Exchanges",
  "2014-08-19": "Exchanges",
  "2014-08-23": "Exchanges",
  "2014-09-14": "Exchanges",
  "2014-09-17": "Exchanges",
  "2014-09-24": "Exchanges",
  "2014-10-11": "Exchanges",
  "2014-10-18": "Exchanges",
  "2014-10-30": "Exchanges",
  "2014-11-04": "Exchanges",
  "2015-01-05": "Exchanges",
  "2015-01-07": "Exchanges",
  "2015-01-09": "Exchanges",
  "2015-01-17": "Exchanges",
  "2015-01-20": "Exchanges",
  "2015-01-23": "Exchanges",
  "2015-01-25": "Exchanges",
  "2015-01-26": "Exchanges",
  "2015-02-07": "Exchanges",
  "2015-02-15": "Exchanges",
  "2015-02-17": "Exchanges",
  "2015-03-05": "Exchanges",
  "2015-03-19": "Exchanges",
  "2015-03-22": "Exchanges",
  "2015-03-23": "Exchanges",
  "2015-03-26": "Exchanges",
  "2015-03-27": "Exchanges",
  "2015-04-06": "Exchanges",
  "2015-04-08": "Exchanges",
  "2015-04-17": "Exchanges",
  "2015-04-22": "Exchanges",
  "2015-05-10": "Exchanges",
  "2015-05-22": "Exchanges",
  "2015-05-24": "Exchanges",
  "2015-06-03": "Exchanges",
  "2015-06-26": "Exchanges",
  "2015-06-29": "Exchanges",
  "2015-07-07": "Exchanges",
  "2015-07-08": "Exchanges",
  "2015-07-21": "Exchanges",
  "2015-07-26": "Exchanges",
  "2015-08-01": "Exchanges",
  "2015-08-02": "Exchanges",
  "2015-08-26": "Exchanges",
  "2015-08-31": "Exchanges",
  "2015-09-14": "Exchanges",
  "2015-09-15": "Exchanges",
  "2015-10-07": "Exchanges",
  "2015-10-09": "Exchanges",
  "2015-11-10": "Exchanges",
  "2015-12-20": "Exchanges",
  "2016-01-06": "Exchanges",
  "2016-01-19": "Exchanges",
  "2016-01-23": "Exchanges",
  "2016-01-27": "Exchanges",
  "2016-02-18": "Exchanges",
  "2016-02-20": "Exchanges",
  "2016-03-24": "Exchanges",
  "2016-03-30": "Exchanges",
  "2016-04-01": "Bitcoin adoption",
  "2016-04-09": "Exchanges",
  "2016-04-11": "Exchanges",
  "2016-04-12": "Exchanges",
  "2016-04-13": "Bitcoin adoption",
  "2016-04-18": "Exchanges",
  "2016-04-19": "Exchanges",
  "2016-04-25": "Exchanges",
  "2016-04-28": "Exchanges",
  "2016-05-19": "Exchanges",
  "2016-05-26": "Exchanges",
  "2016-05-28": "Exchanges",
  "2016-06-03": "Exchanges",
  "2016-07-03": "Exchanges",
  "2016-07-26": "Exchanges",
  "2016-07-29": "Exchanges",
  "2016-08-02": "Exchanges",
  "2016-08-03": "Exchanges",
  "2016-08-04": "Exchanges",
  "2016-08-06": "Exchanges",
  "2016-08-07": "Exchanges",
  "2016-08-10": "Exchanges",
  "2016-08-29": "Exchanges",
  "2016-09-03": "Exchanges",
  "2016-09-18": "Exchanges",
  "2016-09-21": "Exchanges",
  "2016-09-22": "Exchanges",
  "2016-09-27": "Exchanges",
  "2016-09-30": "Web3 industry and funding",
  "2016-10-01": "Exchanges",
  "2016-11-21": "Exchanges",
  "2016-12-02": "Exchanges",
  "2016-12-12": "Exchanges",
  "2016-12-13": "Exchanges",
  "2017-01-10": "Exchanges",
  "2017-01-19": "Exchanges",
  "2017-01-21": "Exchanges",
  "2017-02-08": "Exchanges",
  "2017-02-10": "Exchanges",
  "2017-02-13": "Exchanges",
  "2017-02-14": "Exchanges",
  "2017-02-16": "Exchanges",
  "2017-02-17": "Exchanges",
  "2017-03-19": "Exchanges",
  "2017-03-24": "Exchanges",
  "2017-04-07": "Exchanges",
  "2017-04-09": "Exchanges",
  "2017-04-16": "Exchanges",
  "2017-04-17": "Exchanges",
  "2017-06-13": "Exchanges",
  "2017-06-26": "Exchanges",
  "2017-07-01": "Exchanges",
  "2017-07-10": "Exchanges",
  "2017-07-14": "Exchanges",
  "2017-07-19": "Exchanges",
  "2017-07-29": "Exchanges",
  "2017-08-02": "Exchanges",
  "2017-09-26": "Exchanges",
  "2017-10-17": "Exchanges",
  "2017-10-29": "Exchanges",
  "2018-01-29": "Exchanges",
  "2018-02-21": "Exchanges",
  "2018-03-05": "Exchanges",
  "2018-03-23": "Exchanges",
  "2018-04-26": "Exchanges",
  "2018-04-28": "Exchanges",
  "2018-06-10": "Exchanges",
  "2018-06-19": "Exchanges",
  "2018-06-27": "Exchanges",
  "2018-07-07": "Exchanges",
  "2018-07-20": "Exchanges",
  "2018-07-31": "Exchanges",
  "2018-08-14": "Exchanges",
  "2018-09-04": "Exchanges",
  "2018-09-14": "Exchanges",
  "2018-09-20": "Exchanges",
  "2018-11-18": "Exchanges",
  "2018-12-21": "Exchanges",
  "2019-01-12": "Exchanges",
  "2019-01-18": "Exchanges",
  "2019-01-26": "Exchanges",
  "2019-01-31": "Exchanges",
  "2019-02-05": "Exchanges",
  "2019-02-21": "Exchanges",
  "2019-03-15": "Exchanges",
  "2019-03-22": "Exchanges",
  "2019-03-28": "Exchanges",
  "2019-04-17": "Exchanges",
  "2019-05-07": "Exchanges",
  "2019-05-19": "Exchanges",
  "2019-05-31": "Exchanges",
  "2019-06-01": "Exchanges",
  "2019-07-21": "Exchanges",
  "2019-07-23": "Exchanges",
  "2019-08-07": "Exchanges",
  "2019-10-23": "Exchanges",
  "2019-10-27": "Exchanges",
  "2019-11-04": "Exchanges",
  "2019-11-27": "Exchanges",
  "2019-12-04": "Exchanges",
  "2019-12-22": "Exchanges",
  "2019-12-24": "Exchanges",
  "2020-01-03": "Exchanges",
  "2020-02-19": "Exchanges",
  "2020-02-29": "Exchanges",
  "2020-04-02": "Exchanges",
  "2020-05-23": "Exchanges",
  "2020-08-26": "Exchanges",
  "2020-09-25": "Exchanges",
  "2020-09-27": "Exchanges",
  "2020-10-02": "Exchanges",
  "2020-12-06": "Exchanges",
  "2020-12-25": "Exchanges",
  "2021-04-14": "Exchanges",
  "2021-06-11": "Exchanges",
  "2021-07-05": "Exchanges",
  "2021-08-11": "Exchanges",
  "2021-08-19": "Exchanges",
  "2021-11-13": "Exchanges",
  "2021-11-17": "Exchanges",
  "2022-02-01": "Exchanges",
  "2022-02-09": "Exchanges",
  "2022-02-13": "Exchanges",
  "2022-03-19": "Exchanges",
  "2022-05-15": "Exchanges",
  "2022-05-21": "Exchanges",
  "2022-08-27": "Exchanges",
  "2022-09-05": "Exchanges",
  "2022-09-12": "Exchanges",
  "2022-09-13": "Exchanges",
  "2022-09-24": "Exchanges",
  "2022-10-23": "Exchanges",
  "2022-11-03": "Exchanges",
  "2022-11-13": "Exchanges",
  "2022-11-16": "Exchanges",
  "2022-12-18": "Exchanges",
  "2022-12-30": "Exchanges",
  "2023-01-20": "Exchanges",
  "2023-02-05": "Exchanges",
  "2023-02-10": "Exchanges",
  "2023-03-14": "Exchanges",
  "2023-05-07": "Exchanges",
  "2023-05-23": "Exchanges",
  "2023-06-07": "Exchanges",
  "2023-08-02": "Exchanges",
  "2023-08-13": "Exchanges",
  "2023-09-09": "Exchanges",
  "2023-09-13": "Exchanges",
  "2023-09-15": "Exchanges",
  "2023-09-24": "Exchanges",
  "2023-10-31": "Exchanges",
  "2023-11-08": "Exchanges",
  "2023-11-21": "Exchanges",
  "2023-11-22": "Exchanges",
  "2024-01-18": "Exchanges",
  "2024-01-23": "Exchanges",
  "2024-03-13": "Exchanges",
  "2024-04-01": "Exchanges",
  "2024-04-18": "Exchanges",
  "2024-06-09": "Exchanges",
  "2024-07-05": "Exchanges",
  "2024-07-08": "Exchanges",
  "2024-07-24": "Exchanges",
  "2024-08-03": "Smart contracts & L1s",
  "2024-08-14": "Exchanges",
  "2024-10-11": "Exchanges",
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

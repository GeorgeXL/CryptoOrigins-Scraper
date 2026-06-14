/**
 * Retag rows on Institutional Bitcoin & flows — keep custody launches, bank/tradfi BTC products, corporate treasury buys, and institutional flow landmarks.
 *
 * Usage:
 *   npx tsx server/scripts/retag-institutional-bitcoin-flows.ts --dry-run
 *   npx tsx server/scripts/retag-institutional-bitcoin-flows.ts --apply
 *   npx tsx server/scripts/retag-institutional-bitcoin-flows.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Institutional Bitcoin & flows";

/** Editorial map for every row currently tagged Institutional Bitcoin & flows (274 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-02-06": null,
  "2009-02-28": null,
  "2009-03-13": null,
  "2009-03-24": null,
  "2009-05-05": null,
  "2009-06-02": null,
  "2009-06-12": null,
  "2009-06-17": null,
  "2009-06-26": null,
  "2009-07-14": null,
  "2009-07-16": null,
  "2009-07-21": null,
  "2009-08-15": null,
  "2009-09-05": null,
  "2009-09-16": null,
  "2009-09-22": null,
  "2009-09-26": null,
  "2009-10-04": null,
  "2009-11-07": null,
  "2009-12-17": null,
  "2009-12-21": null,
  "2010-01-08": null,
  "2010-02-21": null,
  "2010-02-22": null,
  "2010-04-16": null,
  "2010-06-04": null,
  "2010-06-19": null,
  "2010-09-28": null,
  "2010-10-20": null,
  "2010-10-21": null,
  "2010-11-12": null,
  "2010-12-20": null,
  "2010-12-25": null,
  "2011-01-22": null,
  "2011-05-18": null,
  "2011-05-26": null,
  "2011-06-16": null,
  "2011-06-25": null,
  "2011-09-15": null,
  "2011-10-01": null,
  "2011-10-09": null,
  "2011-10-21": "Institutional Bitcoin & flows",
  "2011-10-24": null,
  "2011-10-26": null,
  "2011-11-04": null,
  "2011-11-06": null,
  "2011-11-24": null,
  "2011-11-26": null,
  "2011-12-01": null,
  "2012-01-22": null,
  "2012-01-23": null,
  "2012-03-09": null,
  "2012-03-12": null,
  "2012-05-05": null,
  "2012-06-02": null,
  "2012-06-07": null,
  "2012-06-12": null,
  "2012-07-08": null,
  "2012-07-25": null,
  "2012-09-03": null,
  "2012-12-11": null,
  "2013-01-02": "Institutional Bitcoin & flows",
  "2013-01-26": null,
  "2013-02-05": null,
  "2013-03-23": null,
  "2013-06-15": null,
  "2013-06-18": "Institutional Bitcoin & flows",
  "2013-07-19": null,
  "2013-07-31": "Institutional Bitcoin & flows",
  "2013-08-09": "Institutional Bitcoin & flows",
  "2013-08-22": null,
  "2013-08-25": "Institutional Bitcoin & flows",
  "2013-11-02": null,
  "2013-12-01": null,
  "2013-12-05": "Institutional Bitcoin & flows",
  "2013-12-11": null,
  "2013-12-16": "Institutional Bitcoin & flows",
  "2013-12-26": "Bitcoin adoption",
  "2014-01-22": null,
  "2014-02-05": "Institutional Bitcoin & flows",
  "2014-02-22": "Institutional Bitcoin & flows",
  "2014-03-04": "Institutional Bitcoin & flows",
  "2014-03-13": null,
  "2014-07-02": null,
  "2014-07-03": null,
  "2014-11-22": "Institutional Bitcoin & flows",
  "2014-11-26": null,
  "2014-12-05": "Institutional Bitcoin & flows",
  "2014-12-19": null,
  "2015-01-12": "Institutional Bitcoin & flows",
  "2015-02-20": null,
  "2015-02-26": "Institutional Bitcoin & flows",
  "2015-03-17": null,
  "2015-04-16": null,
  "2015-04-30": "Institutional Bitcoin & flows",
  "2015-05-03": "Institutional Bitcoin & flows",
  "2015-06-06": "Bitcoin adoption",
  "2015-06-25": null,
  "2015-07-22": null,
  "2015-09-07": null,
  "2015-09-23": "Institutional Bitcoin & flows",
  "2015-10-23": null,
  "2015-10-27": null,
  "2015-10-29": null,
  "2015-11-05": null,
  "2015-11-17": "Institutional Bitcoin & flows",
  "2015-11-22": "Bitcoin adoption",
  "2015-11-26": "Institutional Bitcoin & flows",
  "2015-12-04": null,
  "2015-12-17": null,
  "2016-01-31": "Institutional Bitcoin & flows",
  "2016-03-09": null,
  "2016-03-29": null,
  "2016-04-02": "Institutional Bitcoin & flows",
  "2016-04-06": null,
  "2016-04-29": "Institutional Bitcoin & flows",
  "2016-07-07": null,
  "2016-07-14": null,
  "2016-09-24": null,
  "2016-11-30": null,
  "2016-12-01": "Institutional Bitcoin & flows",
  "2016-12-19": null,
  "2016-12-27": null,
  "2017-01-26": "Institutional Bitcoin & flows",
  "2017-02-01": "Institutional Bitcoin & flows",
  "2017-02-07": "Institutional Bitcoin & flows",
  "2017-02-11": "Institutional Bitcoin & flows",
  "2017-05-02": "Institutional Bitcoin & flows",
  "2017-05-16": "Institutional Bitcoin & flows",
  "2017-06-22": null,
  "2017-07-12": null,
  "2017-09-14": "Institutional Bitcoin & flows",
  "2017-10-02": "Institutional Bitcoin & flows",
  "2017-12-14": null,
  "2018-04-09": null,
  "2018-05-02": "Institutional Bitcoin & flows",
  "2018-05-03": "Institutional Bitcoin & flows",
  "2018-05-13": null,
  "2018-05-14": "Institutional Bitcoin & flows",
  "2018-06-18": null,
  "2018-07-02": "Institutional Bitcoin & flows",
  "2018-08-24": "Institutional Bitcoin & flows",
  "2018-09-12": null,
  "2018-09-15": "Institutional Bitcoin & flows",
  "2018-09-19": "Institutional Bitcoin & flows",
  "2018-09-30": null,
  "2018-10-01": "Institutional Bitcoin & flows",
  "2018-10-02": null,
  "2018-10-17": "Institutional Bitcoin & flows",
  "2018-10-19": "Institutional Bitcoin & flows",
  "2018-10-29": "Institutional Bitcoin & flows",
  "2019-02-26": "Institutional Bitcoin & flows",
  "2019-06-11": "Institutional Bitcoin & flows",
  "2019-07-31": "Derivatives",
  "2019-09-06": null,
  "2019-09-07": "Institutional Bitcoin & flows",
  "2019-09-08": null,
  "2019-09-23": "Institutional Bitcoin & flows",
  "2019-10-07": null,
  "2019-11-12": null,
  "2019-11-28": "Institutional Bitcoin & flows",
  "2020-02-25": "Institutional Bitcoin & flows",
  "2020-02-26": null,
  "2020-04-17": "Institutional Bitcoin & flows",
  "2020-05-28": "Institutional Bitcoin & flows",
  "2020-06-29": null,
  "2020-07-22": "Institutional Bitcoin & flows",
  "2020-08-11": "Institutional Bitcoin & flows",
  "2020-08-12": "Institutional Bitcoin & flows",
  "2020-08-15": null,
  "2020-09-14": "Institutional Bitcoin & flows",
  "2020-09-29": null,
  "2020-10-03": "Derivatives",
  "2020-10-08": "Institutional Bitcoin & flows",
  "2020-10-22": "ETFs and investment products",
  "2020-10-28": "Institutional Bitcoin & flows",
  "2020-11-05": "Institutional Bitcoin & flows",
  "2020-11-07": null,
  "2020-11-16": null,
  "2020-12-05": "Institutional Bitcoin & flows",
  "2020-12-09": "Institutional Bitcoin & flows",
  "2020-12-11": null,
  "2020-12-21": "Institutional Bitcoin & flows",
  "2021-01-22": "Institutional Bitcoin & flows",
  "2021-01-26": "Institutional Bitcoin & flows",
  "2021-02-04": "Institutional Bitcoin & flows",
  "2021-02-08": "Institutional Bitcoin & flows",
  "2021-02-11": "Institutional Bitcoin & flows",
  "2021-02-13": "Institutional Bitcoin & flows",
  "2021-02-17": "Institutional Bitcoin & flows",
  "2021-03-08": null,
  "2021-03-16": null,
  "2021-03-21": "Institutional Bitcoin & flows",
  "2021-03-28": "Institutional Bitcoin & flows",
  "2021-04-07": "Bitcoin adoption",
  "2021-04-29": "Institutional Bitcoin & flows",
  "2021-06-10": "Institutional Bitcoin & flows",
  "2021-06-16": "Institutional Bitcoin & flows",
  "2021-06-19": null,
  "2021-06-24": "Institutional Bitcoin & flows",
  "2021-07-21": "Institutional Bitcoin & flows",
  "2021-08-22": "Institutional Bitcoin & flows",
  "2021-08-27": "Institutional Bitcoin & flows",
  "2021-08-30": "Institutional Bitcoin & flows",
  "2021-09-02": "Institutional Bitcoin & flows",
  "2021-09-19": "Institutional Bitcoin & flows",
  "2021-10-07": "Institutional Bitcoin & flows",
  "2021-12-02": null,
  "2021-12-12": "Institutional Bitcoin & flows",
  "2021-12-17": "Institutional Bitcoin & flows",
  "2022-01-04": "Institutional Bitcoin & flows",
  "2022-01-20": null,
  "2022-01-28": "Institutional Bitcoin & flows",
  "2022-02-06": "Institutional Bitcoin & flows",
  "2022-02-20": "Institutional Bitcoin & flows",
  "2022-05-08": "Institutional Bitcoin & flows",
  "2022-07-04": "Institutional Bitcoin & flows",
  "2022-07-05": null,
  "2022-07-09": "Institutional Bitcoin & flows",
  "2022-07-25": "Institutional Bitcoin & flows",
  "2022-07-30": null,
  "2022-08-11": "Institutional Bitcoin & flows",
  "2022-09-02": "Institutional Bitcoin & flows",
  "2022-09-18": "Institutional Bitcoin & flows",
  "2022-10-09": "Institutional Bitcoin & flows",
  "2022-10-11": "Institutional Bitcoin & flows",
  "2022-10-19": "Institutional Bitcoin & flows",
  "2022-10-22": "Institutional Bitcoin & flows",
  "2022-11-18": null,
  "2022-12-28": "Institutional Bitcoin & flows",
  "2023-01-08": "Institutional Bitcoin & flows",
  "2023-02-02": null,
  "2023-02-17": "Institutional Bitcoin & flows",
  "2023-04-05": "Institutional Bitcoin & flows",
  "2023-04-25": "Institutional Bitcoin & flows",
  "2023-04-26": "Institutional Bitcoin & flows",
  "2023-08-01": "Institutional Bitcoin & flows",
  "2023-09-25": "Institutional Bitcoin & flows",
  "2023-10-01": "Institutional Bitcoin & flows",
  "2023-10-18": "Institutional Bitcoin & flows",
  "2023-11-02": "Institutional Bitcoin & flows",
  "2023-12-13": "Institutional Bitcoin & flows",
  "2024-01-15": "Bitcoin adoption",
  "2024-01-16": null,
  "2024-01-29": "Institutional Bitcoin & flows",
  "2024-02-20": "Institutional Bitcoin & flows",
  "2024-03-07": "Institutional Bitcoin & flows",
  "2024-03-15": "Institutional Bitcoin & flows",
  "2024-03-26": "ETFs and investment products",
  "2024-03-29": "ETFs and investment products",
  "2024-04-07": "ETFs and investment products",
  "2024-05-06": "Institutional Bitcoin & flows",
  "2024-05-23": "ETFs and investment products",
  "2024-05-26": "ETFs and investment products",
  "2024-06-21": "ETFs and investment products",
  "2024-08-16": "ETFs and investment products",
  "2024-08-18": "ETFs and investment products",
  "2024-08-29": "ETFs and investment products",
  "2024-09-28": "ETFs and investment products",
  "2024-10-01": "Institutional Bitcoin & flows",
  "2024-10-07": "Institutional Bitcoin & flows",
  "2024-10-14": "ETFs and investment products",
  "2024-10-19": "ETFs and investment products",
  "2024-10-30": "Institutional Bitcoin & flows",
  "2024-10-22": null,
  "2024-11-01": "Institutional Bitcoin & flows",
  "2024-11-10": null,
  "2024-11-14": "Institutional Bitcoin & flows",
  "2024-11-29": "Institutional Bitcoin & flows",
  "2024-12-02": "Institutional Bitcoin & flows",
  "2024-12-08": "Institutional Bitcoin & flows",
  "2024-12-19": "Institutional Bitcoin & flows",
  "2024-12-25": null,
  "2024-12-29": "Institutional Bitcoin & flows",
  "2024-12-30": "Institutional Bitcoin & flows",
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

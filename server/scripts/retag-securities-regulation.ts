/**
 * Retag rows on Securities regulation — SEC/CFTC and securities rules affecting crypto markets and products.
 *
 * Usage:
 *   npx tsx server/scripts/retag-securities-regulation.ts --dry-run
 *   npx tsx server/scripts/retag-securities-regulation.ts --apply
 *   npx tsx server/scripts/retag-securities-regulation.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Securities regulation";

/** Editorial map for every row currently tagged Securities regulation. null = clear topic. Unmapped dates default to clear. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-07": null,
  "2009-01-23": null,
  "2009-01-25": null,
  "2009-03-22": null,
  "2009-04-15": null,
  "2009-05-13": null,
  "2009-05-15": null,
  "2009-05-16": null,
  "2009-07-11": null,
  "2009-07-22": null,
  "2009-08-03": null,
  "2009-08-04": null,
  "2009-08-09": null,
  "2009-08-11": null,
  "2009-08-18": null,
  "2009-09-01": null,
  "2009-10-26": null,
  "2009-11-28": null,
  "2010-02-08": null,
  "2010-02-24": null,
  "2010-03-10": null,
  "2010-03-15": null,
  "2010-03-28": null,
  "2010-04-30": null,
  "2010-05-07": null,
  "2010-05-23": null,
  "2010-06-09": null,
  "2010-06-25": null,
  "2010-09-07": null,
  "2010-09-25": null,
  "2010-10-08": null,
  "2010-12-13": null,
  "2010-12-28": "Securities regulation",
  "2011-02-01": "Global growth and recession",
  "2011-02-03": null,
  "2011-07-07": null,
  "2011-08-04": null,
  "2011-08-12": "Bitcoin adoption",
  "2011-08-17": null,
  "2011-10-25": null,
  "2011-12-14": null,
  "2012-01-27": null,
  "2012-02-02": null,
  "2012-02-11": "Enforcement & crime",
  "2012-02-28": null,
  "2012-03-03": null,
  "2012-04-18": null,
  "2012-05-27": null,
  "2012-05-31": null,
  "2012-06-10": null,
  "2012-06-21": null,
  "2012-08-25": null,
  "2012-09-10": null,
  "2012-10-03": null,
  "2012-10-29": null,
  "2012-10-31": null,
  "2012-11-16": null,
  "2012-12-20": null,
  "2013-01-21": "Bitcoin adoption",
  "2013-03-31": null,
  "2013-04-20": null,
  "2013-04-30": null,
  "2013-06-22": null,
  "2013-06-27": null,
  "2013-08-24": "Bailouts and stimulus",
  "2013-08-26": null,
  "2013-09-01": null,
  "2014-01-04": "Bitcoin regulation",
  "2014-05-07": "Securities regulation",
  "2014-06-23": null,
  "2014-08-10": null,
  "2014-09-07": null,
  "2014-11-11": null,
  "2014-11-27": "Bitcoin regulation",
  "2015-01-31": null,
  "2015-02-05": null,
  "2015-04-24": null,
  "2015-05-15": "Bitcoin regulation",
  "2015-05-21": null,
  "2015-07-02": null,
  "2015-07-19": null,
  "2015-09-11": "Securities regulation",
  "2015-12-22": null,
  "2015-12-24": "Bitcoin regulation",
  "2016-03-28": null,
  "2016-04-17": null,
  "2016-05-09": null,
  "2016-06-20": null,
  "2016-08-05": null,
  "2016-09-29": null,
  "2017-04-02": "Bitcoin regulation",
  "2017-04-18": null,
  "2017-07-25": "Securities regulation",
  "2017-08-10": "Bitcoin regulation",
  "2017-08-28": "Securities regulation",
  "2017-09-04": "Securities regulation",
  "2017-12-11": "Securities regulation",
  "2018-02-06": "Securities regulation",
  "2018-03-08": "Securities regulation",
  "2018-04-05": null,
  "2018-04-14": null,
  "2018-06-06": "Securities regulation",
  "2018-06-20": null,
  "2018-08-18": null,
  "2018-09-23": "Securities regulation",
  "2018-11-16": "Securities regulation",
  "2019-05-08": null,
  "2019-06-05": "Securities regulation",
  "2019-06-06": "Securities regulation",
  "2019-08-02": "Securities regulation",
  "2019-10-12": "Securities regulation",
  "2020-01-05": "Securities regulation",
  "2020-05-12": "Securities regulation",
  "2020-06-21": "Bitcoin regulation",
  "2020-12-22": "Securities regulation",
  "2021-06-08": null,
  "2021-08-03": null,
  "2021-09-10": null,
  "2021-11-20": null,
  "2022-01-03": "Early Bitcoin history",
  "2022-04-03": "Politics and elections",
  "2022-04-21": "Bitcoin regulation",
  "2022-10-14": "Bitcoin regulation",
  "2022-11-26": "Securities regulation",
  "2022-12-27": null,
  "2023-01-09": "Securities regulation",
  "2023-02-09": "Securities regulation",
  "2023-03-25": "Securities regulation",
  "2023-06-05": "Securities regulation",
  "2023-06-18": "Securities regulation",
  "2023-08-11": "Securities regulation",
  "2023-09-07": "Securities regulation",
  "2023-10-19": "Securities regulation",
  "2024-01-17": null,
  "2024-05-08": "Securities regulation",
  "2024-05-22": "Securities regulation",
  "2024-05-31": "Securities regulation",
  "2024-08-01": "Securities regulation",
  "2024-08-23": "Securities regulation",
  "2024-09-03": "Securities regulation",
  "2024-09-07": "Securities regulation",
  "2024-11-20": "Securities regulation",
  "2024-12-01": null,
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
    let target = TARGET_BY_DATE[row.date];
    if (target === undefined) {
      stats.missingMap += 1;
      target = null;
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

/**
 * Retag rows on Smart contracts & L1s — Ethereum and other L1 launches, upgrades, merges, and major altcoin ecosystem milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-smart-contracts-l1s.ts --dry-run
 *   npx tsx server/scripts/retag-smart-contracts-l1s.ts --apply
 *   npx tsx server/scripts/retag-smart-contracts-l1s.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Smart contracts & L1s";

/** Editorial map for every row currently tagged Smart contracts & L1s (116 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2010-03-01": "Smart contracts & L1s",
  "2011-10-07": "Smart contracts & L1s",
  "2011-10-13": "Smart contracts & L1s",
  "2012-01-02": "Smart contracts & L1s",
  "2013-08-31": "Smart contracts & L1s",
  "2013-09-14": "Smart contracts & L1s",
  "2013-10-28": "Smart contracts & L1s",
  "2013-12-06": "Smart contracts & L1s",
  "2014-04-18": "Smart contracts & L1s",
  "2014-05-31": "Exchanges",
  "2014-07-21": "Smart contracts & L1s",
  "2014-07-22": "Smart contracts & L1s",
  "2014-08-04": "Smart contracts & L1s",
  "2015-07-30": "Smart contracts & L1s",
  "2015-08-14": "Smart contracts & L1s",
  "2015-08-25": "Halving events",
  "2015-12-28": "Smart contracts & L1s",
  "2016-03-14": "Smart contracts & L1s",
  "2016-05-22": "Smart contracts & L1s",
  "2016-06-10": "Smart contracts & L1s",
  "2016-06-16": "Smart contracts & L1s",
  "2016-07-16": "Smart contracts & L1s",
  "2016-07-24": "Smart contracts & L1s",
  "2016-07-30": "Smart contracts & L1s",
  "2016-09-20": "Smart contracts & L1s",
  "2016-10-06": "Smart contracts & L1s",
  "2016-10-18": "Smart contracts & L1s",
  "2016-10-28": "Smart contracts & L1s",
  "2016-11-01": "Smart contracts & L1s",
  "2016-11-14": "Smart contracts & L1s",
  "2016-11-15": "Smart contracts & L1s",
  "2017-03-29": "Smart contracts & L1s",
  "2017-04-21": "Smart contracts & L1s",
  "2017-04-24": "Smart contracts & L1s",
  "2017-05-04": "Smart contracts & L1s",
  "2017-05-10": "Smart contracts & L1s",
  "2017-09-29": "Smart contracts & L1s",
  "2017-10-15": "Smart contracts & L1s",
  "2017-10-16": "Smart contracts & L1s",
  "2018-01-13": "Smart contracts & L1s",
  "2018-04-01": "Smart contracts & L1s",
  "2018-04-08": "Smart contracts & L1s",
  "2018-05-16": "Smart contracts & L1s",
  "2018-05-30": "Smart contracts & L1s",
  "2018-06-01": "Smart contracts & L1s",
  "2018-06-09": "Smart contracts & L1s",
  "2018-08-13": "Smart contracts & L1s",
  "2018-08-19": "Bitcoin adoption",
  "2018-08-26": "Smart contracts & L1s",
  "2018-09-01": "Smart contracts & L1s",
  "2018-09-08": "Smart contracts & L1s",
  "2018-09-21": "Smart contracts & L1s",
  "2019-01-07": "Smart contracts & L1s",
  "2019-01-24": "Smart contracts & L1s",
  "2019-02-28": "Smart contracts & L1s",
  "2019-04-18": "Smart contracts & L1s",
  "2019-04-19": "Smart contracts & L1s",
  "2019-05-30": "Smart contracts & L1s",
  "2019-08-04": "Bitcoin price & cycles",
  "2019-08-05": "Halving events",
  "2019-11-24": "Smart contracts & L1s",
  "2019-12-10": "Smart contracts & L1s",
  "2020-01-02": "Smart contracts & L1s",
  "2020-03-16": "Smart contracts & L1s",
  "2020-04-07": "Halving events",
  "2020-04-10": "Halving events",
  "2020-05-06": "Smart contracts & L1s",
  "2020-05-26": "Smart contracts & L1s",
  "2020-05-27": "Smart contracts & L1s",
  "2020-06-10": "Smart contracts & L1s",
  "2020-06-18": "Smart contracts & L1s",
  "2020-07-29": "Smart contracts & L1s",
  "2020-08-17": "Smart contracts & L1s",
  "2020-09-01": "Smart contracts & L1s",
  "2020-10-15": "Smart contracts & L1s",
  "2020-10-17": "Smart contracts & L1s",
  "2020-11-11": "Smart contracts & L1s",
  "2021-01-15": "Smart contracts & L1s",
  "2021-03-31": "Smart contracts & L1s",
  "2021-07-22": "Smart contracts & L1s",
  "2021-08-05": "Smart contracts & L1s",
  "2021-08-07": "Smart contracts & L1s",
  "2021-08-28": "Smart contracts & L1s",
  "2021-09-12": "Smart contracts & L1s",
  "2021-09-14": "Smart contracts & L1s",
  "2021-12-09": "Smart contracts & L1s",
  "2021-12-18": "Smart contracts & L1s",
  "2022-02-14": "Smart contracts & L1s",
  "2022-02-15": "Smart contracts & L1s",
  "2022-03-20": "Smart contracts & L1s",
  "2022-04-19": "Smart contracts & L1s",
  "2022-05-01": "Smart contracts & L1s",
  "2022-05-19": "Smart contracts & L1s",
  "2022-09-14": "Smart contracts & L1s",
  "2022-09-15": "Smart contracts & L1s",
  "2022-09-17": "Smart contracts & L1s",
  "2022-09-22": "Smart contracts & L1s",
  "2022-11-24": "Smart contracts & L1s",
  "2022-12-21": "Smart contracts & L1s",
  "2023-03-24": "Smart contracts & L1s",
  "2023-03-27": "Smart contracts & L1s",
  "2023-04-12": "Smart contracts & L1s",
  "2023-07-28": "Smart contracts & L1s",
  "2023-08-25": "Smart contracts & L1s",
  "2023-10-26": "Smart contracts & L1s",
  "2023-12-20": "Smart contracts & L1s",
  "2024-01-12": "Smart contracts & L1s",
  "2024-02-06": "Smart contracts & L1s",
  "2024-02-07": "Smart contracts & L1s",
  "2024-03-12": "Halving events",
  "2024-04-12": null,
  "2024-07-23": "Smart contracts & L1s",
  "2024-08-03": "Exchanges",
  "2024-09-04": "Smart contracts & L1s",
  "2024-09-09": "Smart contracts & L1s",
  "2024-09-19": "Smart contracts & L1s",
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

/**
 * Retag rows on Web3 industry and funding — Major VC rounds and industry-scale web3 company milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-web3-industry-funding.ts --dry-run
 *   npx tsx server/scripts/retag-web3-industry-funding.ts --apply
 *   npx tsx server/scripts/retag-web3-industry-funding.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Web3 industry and funding";

/** Editorial map for every row currently tagged Web3 industry and funding (60 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2010-05-06": "Web3 industry and funding",
  "2013-04-29": "Web3 industry and funding",
  "2013-05-20": "Smart contracts & L1s",
  "2013-07-11": "Web3 industry and funding",
  "2013-07-18": "Web3 industry and funding",
  "2014-12-31": "Web3 industry and funding",
  "2015-01-19": "Government adoption",
  "2015-03-12": "Web3 industry and funding",
  "2015-03-31": "Web3 industry and funding",
  "2015-04-15": "Government adoption",
  "2016-01-08": "Web3 industry and funding",
  "2016-01-13": "Web3 industry and funding",
  "2016-02-04": "Web3 industry and funding",
  "2016-07-15": "Smart contracts & L1s",
  "2017-01-30": "Web3 industry and funding",
  "2017-06-24": "Smart contracts & L1s",
  "2017-09-19": "Web3 industry and funding",
  "2018-01-01": "Web3 industry and funding",
  "2018-04-02": "Web3 industry and funding",
  "2018-04-30": "Web3 industry and funding",
  "2018-07-15": "Web3 industry and funding",
  "2018-07-18": "Web3 industry and funding",
  "2018-08-01": "Web3 industry and funding",
  "2018-09-24": "Web3 industry and funding",
  "2018-11-20": "Web3 industry and funding",
  "2019-04-01": "Web3 industry and funding",
  "2019-07-30": "Web3 industry and funding",
  "2019-11-07": "Web3 industry and funding",
  "2019-11-20": "Web3 industry and funding",
  "2019-12-11": "Web3 industry and funding",
  "2020-06-02": "Web3 industry and funding",
  "2020-06-30": "Web3 industry and funding",
  "2020-08-06": "Web3 industry and funding",
  "2020-08-25": "Web3 industry and funding",
  "2020-10-14": "Web3 industry and funding",
  "2020-11-04": "Web3 industry and funding",
  "2021-01-17": "Web3 industry and funding",
  "2021-03-18": "Web3 industry and funding",
  "2021-05-11": "Web3 industry and funding",
  "2021-06-01": "Web3 industry and funding",
  "2021-06-09": "Web3 industry and funding",
  "2021-07-20": "Web3 industry and funding",
  "2021-10-05": "Web3 industry and funding",
  "2021-10-28": "Web3 industry and funding",
  "2021-11-15": "Web3 industry and funding",
  "2021-11-19": "Web3 industry and funding",
  "2022-01-14": "Web3 industry and funding",
  "2022-03-01": null,
  "2022-04-28": "Web3 industry and funding",
  "2022-05-05": "Web3 industry and funding",
  "2022-05-25": "Web3 industry and funding",
  "2022-08-05": "Web3 industry and funding",
  "2022-09-03": null,
  "2022-09-28": null,
  "2022-10-13": "Web3 industry and funding",
  "2023-02-22": "Web3 industry and funding",
  "2023-09-16": "Web3 industry and funding",
  "2024-06-11": "Web3 industry and funding",
  "2024-06-13": "Web3 industry and funding",
  "2024-07-10": "Web3 industry and funding",
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

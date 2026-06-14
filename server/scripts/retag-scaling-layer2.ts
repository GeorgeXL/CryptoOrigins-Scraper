/**
 * Retag rows on Scaling and Layer 2 — keep Lightning, sidechains, and Bitcoin L2 milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-scaling-layer2.ts --dry-run
 *   npx tsx server/scripts/retag-scaling-layer2.ts --apply
 *   npx tsx server/scripts/retag-scaling-layer2.ts --apply --from 2013-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Scaling and Layer 2";

/** Editorial map for every row currently tagged Scaling and Layer 2 (111 rows at cleanup start). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2013-01-04": "Bitcoin adoption",
  "2013-08-01": "Scaling and Layer 2",
  "2014-10-08": "Scaling and Layer 2",
  "2014-10-22": "Scaling and Layer 2",
  "2014-11-18": "Scaling and Layer 2",
  "2015-01-14": "Scaling and Layer 2",
  "2015-02-12": null,
  "2015-05-31": "Scaling and Layer 2",
  "2015-06-08": "Scaling and Layer 2",
  "2015-06-13": "Scaling and Layer 2",
  "2015-06-16": "Scaling and Layer 2",
  "2015-06-23": "Scaling and Layer 2",
  "2015-07-17": "Scaling and Layer 2",
  "2015-07-23": "Scaling and Layer 2",
  "2015-09-12": "Scaling and Layer 2",
  "2015-10-12": "Scaling and Layer 2",
  "2015-12-02": "Scaling and Layer 2",
  "2015-12-06": "Scaling and Layer 2",
  "2015-12-07": "Scaling and Layer 2",
  "2016-01-18": "Scaling and Layer 2",
  "2016-02-02": "Scaling and Layer 2",
  "2016-02-03": "Scaling and Layer 2",
  "2016-02-21": "Scaling and Layer 2",
  "2016-02-25": "Scaling and Layer 2",
  "2016-02-29": "Scaling and Layer 2",
  "2016-05-07": "Scaling and Layer 2",
  "2016-05-08": "Scaling and Layer 2",
  "2016-05-15": "Scaling and Layer 2",
  "2016-05-23": "Scaling and Layer 2",
  "2016-09-15": "Protocol & upgrades",
  "2016-10-05": "Scaling and Layer 2",
  "2016-10-23": "Scaling and Layer 2",
  "2016-11-10": "Scaling and Layer 2",
  "2016-11-12": "Scaling and Layer 2",
  "2016-12-03": "Scaling and Layer 2",
  "2016-12-17": "Scaling and Layer 2",
  "2017-01-12": "Scaling and Layer 2",
  "2017-01-25": "Scaling and Layer 2",
  "2017-02-04": "Scaling and Layer 2",
  "2017-03-23": "Scaling and Layer 2",
  "2017-04-30": "Scaling and Layer 2",
  "2017-05-12": "Scaling and Layer 2",
  "2017-06-19": "Scaling and Layer 2",
  "2017-06-21": "Scaling and Layer 2",
  "2017-06-25": "Scaling and Layer 2",
  "2017-07-20": "Scaling and Layer 2",
  "2017-09-06": "Scaling and Layer 2",
  "2017-10-03": "Scaling and Layer 2",
  "2017-10-28": "Protocol & upgrades",
  "2017-12-28": "Scaling and Layer 2",
  "2017-12-29": "Scaling and Layer 2",
  "2018-01-03": "Scaling and Layer 2",
  "2018-01-20": "Scaling and Layer 2",
  "2018-02-25": "Scaling and Layer 2",
  "2018-03-15": "Scaling and Layer 2",
  "2018-03-21": "Scaling and Layer 2",
  "2018-06-04": "Scaling and Layer 2",
  "2018-06-15": "Scaling and Layer 2",
  "2018-07-09": "Scaling and Layer 2",
  "2018-08-07": "Scaling and Layer 2",
  "2018-08-20": "Scaling and Layer 2",
  "2018-10-11": "Scaling and Layer 2",
  "2019-01-06": "Scaling and Layer 2",
  "2019-01-15": "Scaling and Layer 2",
  "2019-01-19": "Scaling and Layer 2",
  "2019-01-22": "Scaling and Layer 2",
  "2019-02-15": "Scaling and Layer 2",
  "2019-02-20": "Scaling and Layer 2",
  "2019-03-02": "Scaling and Layer 2",
  "2019-04-30": "Scaling and Layer 2",
  "2019-06-14": "Scaling and Layer 2",
  "2019-07-03": "Scaling and Layer 2",
  "2019-09-13": "Scaling and Layer 2",
  "2019-09-22": "Scaling and Layer 2",
  "2019-10-15": "Scaling and Layer 2",
  "2020-01-11": "Scaling and Layer 2",
  "2020-01-19": "Tax policy",
  "2020-01-22": "Scaling and Layer 2",
  "2020-08-04": "Scaling and Layer 2",
  "2020-08-10": "Scaling and Layer 2",
  "2020-12-14": "Bitcoin adoption",
  "2021-07-12": "Scaling and Layer 2",
  "2021-07-13": "Scaling and Layer 2",
  "2021-09-25": "Scaling and Layer 2",
  "2021-09-29": "Scaling and Layer 2",
  "2021-10-13": "Scaling and Layer 2",
  "2022-01-18": "Scaling and Layer 2",
  "2022-03-31": "Cross-chain and bridges",
  "2022-05-20": "Scaling and Layer 2",
  "2022-06-21": "Scaling and Layer 2",
  "2022-06-29": "Scaling and Layer 2",
  "2022-10-03": "Scaling and Layer 2",
  "2022-11-23": "Scaling and Layer 2",
  "2022-12-14": "Scaling and Layer 2",
  "2023-03-02": "Scaling and Layer 2",
  "2023-03-04": "Scaling and Layer 2",
  "2023-03-22": "NFTs and gaming",
  "2023-03-26": "Scaling and Layer 2",
  "2023-03-28": "Scaling and Layer 2",
  "2023-04-01": "Scaling and Layer 2",
  "2023-05-17": "Scaling and Layer 2",
  "2023-05-25": "Protocol & upgrades",
  "2023-10-17": "Scaling and Layer 2",
  "2023-12-20": "Smart contracts & L1s",
  "2024-03-31": "Protocol & upgrades",
  "2024-05-15": "Scaling and Layer 2",
  "2024-06-07": "Scaling and Layer 2",
  "2024-06-11": "Smart contracts & L1s",
  "2024-07-26": "Scaling and Layer 2",
  "2024-07-23": "Smart contracts & L1s",
  "2024-08-15": "Scaling and Layer 2",
  "2024-08-28": "Scaling and Layer 2",
  "2024-09-16": "Scaling and Layer 2",
  "2024-10-31": "Scaling and Layer 2",
  "2024-11-19": "Scaling and Layer 2",
  "2024-12-16": "Scaling and Layer 2",
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

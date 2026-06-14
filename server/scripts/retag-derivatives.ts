/**
 * Retag rows on Derivatives — keep Bitcoin futures, options, perps, and regulated derivatives milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-derivatives.ts --dry-run
 *   npx tsx server/scripts/retag-derivatives.ts --apply
 *   npx tsx server/scripts/retag-derivatives.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Derivatives";

/** Editorial map for every row currently tagged Derivatives (68 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-05-25": null,
  "2009-07-27": null,
  "2009-10-06": null,
  "2009-10-13": null,
  "2010-08-16": null,
  "2011-05-04": null,
  "2012-09-30": "Derivatives",
  "2012-10-01": "Derivatives",
  "2014-09-12": "Derivatives",
  "2014-09-15": null,
  "2014-09-25": "Derivatives",
  "2014-11-03": "Derivatives",
  "2015-02-27": "Derivatives",
  "2015-09-19": "Derivatives",
  "2016-05-03": "Derivatives",
  "2017-03-25": "Derivatives",
  "2017-08-12": "Derivatives",
  "2017-09-28": "Derivatives",
  "2017-10-31": "Derivatives",
  "2017-11-01": null,
  "2017-11-18": "Derivatives",
  "2017-12-10": "Derivatives",
  "2017-12-16": "Derivatives",
  "2017-12-18": "Derivatives",
  "2018-07-22": "Derivatives",
  "2018-08-04": "Derivatives",
  "2018-09-16": null,
  "2018-10-23": "Derivatives",
  "2018-10-27": null,
  "2018-11-27": "Derivatives",
  "2018-12-22": "Derivatives",
  "2018-12-31": "Derivatives",
  "2019-01-14": "Derivatives",
  "2019-03-14": "Derivatives",
  "2019-05-15": "Derivatives",
  "2019-06-13": "Derivatives",
  "2019-07-17": "Derivatives",
  "2019-07-22": "Derivatives",
  "2019-08-16": "Derivatives",
  "2019-08-19": "Derivatives",
  "2019-09-30": null,
  "2019-10-04": "Derivatives",
  "2019-10-05": "Derivatives",
  "2019-11-09": "Derivatives",
  "2020-01-14": "Derivatives",
  "2020-02-07": "Derivatives",
  "2020-04-20": "Derivatives",
  "2020-06-24": "Derivatives",
  "2020-10-26": "Derivatives",
  "2021-02-07": "Derivatives",
  "2021-04-27": "Derivatives",
  "2021-04-30": "Derivatives",
  "2021-05-03": "Derivatives",
  "2021-10-16": "Derivatives",
  "2022-05-26": "Derivatives",
  "2023-02-24": "Derivatives",
  "2023-04-06": null,
  "2023-04-17": "Derivatives",
  "2023-04-21": "Derivatives",
  "2023-07-09": "ETFs and investment products",
  "2023-10-23": "Derivatives",
  "2023-10-27": "Derivatives",
  "2023-12-28": null,
  "2023-12-29": null,
  "2024-03-19": "Derivatives",
  "2024-04-25": "Derivatives",
  "2024-06-28": null,
  "2024-10-15": "Derivatives",
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

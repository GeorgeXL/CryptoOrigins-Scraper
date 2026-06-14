/**
 * Retag rows on Satoshi identity — keep claimed identities, investigations, and court cases.
 *
 * Usage:
 *   npx tsx server/scripts/retag-satoshi-identity.ts --dry-run
 *   npx tsx server/scripts/retag-satoshi-identity.ts --apply
 *   npx tsx server/scripts/retag-satoshi-identity.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Satoshi identity";

/** Editorial map for every row currently tagged Satoshi identity (51 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2010-01-25": "Early Bitcoin history",
  "2011-10-03": "Satoshi identity",
  "2011-10-11": "Satoshi identity",
  "2013-05-18": "Satoshi identity",
  "2013-07-14": null,
  "2014-03-06": "Satoshi identity",
  "2014-03-07": "Satoshi identity",
  "2014-03-08": "Satoshi identity",
  "2014-09-09": "Satoshi identity",
  "2015-05-17": "Satoshi identity",
  "2015-11-02": "Satoshi identity",
  "2015-12-08": "Satoshi identity",
  "2015-12-09": "Satoshi identity",
  "2015-12-14": "Legal cases",
  "2016-03-04": null,
  "2016-05-02": "Satoshi identity",
  "2016-05-05": "Satoshi identity",
  "2016-05-06": "Bitcoin price & cycles",
  "2017-08-27": "Satoshi identity",
  "2018-01-05": "Satoshi identity",
  "2018-04-18": "Legal cases",
  "2019-02-13": "Satoshi identity",
  "2019-04-14": "Exchanges",
  "2019-04-15": "Exchanges",
  "2019-05-18": "Bitcoin price & cycles",
  "2019-05-21": "Legal cases",
  "2019-08-27": "Bitcoin price & cycles",
  "2019-09-01": "Bitcoin price & cycles",
  "2019-09-02": "Legal cases",
  "2019-12-07": "Satoshi identity",
  "2020-01-13": "Legal cases",
  "2020-05-21": null,
  "2020-07-20": "Satoshi identity",
  "2020-09-04": "Legal cases",
  "2020-09-21": "Legal cases",
  "2020-10-11": null,
  "2021-02-27": null,
  "2021-12-30": "Satoshi identity",
  "2022-08-15": null,
  "2022-10-08": "Satoshi identity",
  "2023-07-19": "Legal cases",
  "2023-07-22": "Legal cases",
  "2024-02-05": "Satoshi identity",
  "2024-02-13": "Satoshi identity",
  "2024-02-16": "Satoshi identity",
  "2024-02-19": "Satoshi identity",
  "2024-02-23": "Satoshi identity",
  "2024-02-26": "Satoshi identity",
  "2024-03-14": "Satoshi identity",
  "2024-05-20": "Satoshi identity",
  "2024-09-20": null,
  "2024-09-22": null,
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

/**
 * Retag rows on Sanctions and enforcement — Sanctions, OFAC actions, and state enforcement against crypto actors.
 *
 * Usage:
 *   npx tsx server/scripts/retag-sanctions-enforcement.ts --dry-run
 *   npx tsx server/scripts/retag-sanctions-enforcement.ts --apply
 *   npx tsx server/scripts/retag-sanctions-enforcement.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Sanctions and enforcement";

/** Editorial map for every row currently tagged Sanctions and enforcement (29 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2010-05-16": null,
  "2011-01-04": null,
  "2011-02-26": null,
  "2011-02-27": null,
  "2012-04-23": null,
  "2012-05-07": null,
  "2012-07-19": "Bitcoin adoption",
  "2012-08-08": null,
  "2012-12-15": "Enforcement & crime",
  "2013-05-13": "Bitcoin regulation",
  "2013-08-13": "Enforcement & crime",
  "2015-04-02": "Sanctions and enforcement",
  "2017-07-26": "Enforcement & crime",
  "2018-01-21": "Sanctions and enforcement",
  "2018-09-05": "Sanctions and enforcement",
  "2019-10-08": "Sanctions and enforcement",
  "2020-02-13": "Enforcement & crime",
  "2020-09-08": "Sanctions and enforcement",
  "2021-04-19": "Sanctions and enforcement",
  "2021-09-21": "Sanctions and enforcement",
  "2022-03-12": "Sanctions and enforcement",
  "2022-03-24": "Sanctions and enforcement",
  "2022-04-05": "Sanctions and enforcement",
  "2022-05-06": "Sanctions and enforcement",
  "2022-08-08": "Sanctions and enforcement",
  "2022-09-27": "Enforcement & crime",
  "2023-01-26": "Enforcement & crime",
  "2023-04-18": "Enforcement & crime",
  "2023-08-23": "Sanctions and enforcement",
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

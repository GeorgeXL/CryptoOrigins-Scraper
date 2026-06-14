/**
 * Retag rows on Legal cases — Major court cases and rulings about crypto.
 *
 * Usage:
 *   npx tsx server/scripts/retag-legal-cases.ts --dry-run
 *   npx tsx server/scripts/retag-legal-cases.ts --apply
 *   npx tsx server/scripts/retag-legal-cases.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Legal cases";

/** Editorial map for every row currently tagged Legal cases (48 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-07-30": null,
  "2010-03-29": null,
  "2010-04-01": null,
  "2012-02-07": null,
  "2015-02-04": "Legal cases",
  "2015-08-07": "Legal cases",
  "2015-08-09": "Legal cases",
  "2015-08-18": "Legal cases",
  "2015-12-14": "Legal cases",
  "2016-02-09": "Legal cases",
  "2016-07-25": "Legal cases",
  "2016-09-19": "Legal cases",
  "2018-04-18": "Legal cases",
  "2018-06-21": "Legal cases",
  "2018-06-22": "Legal cases",
  "2018-08-17": null,
  "2018-10-06": null,
  "2018-10-26": "Legal cases",
  "2018-12-07": "Legal cases",
  "2019-03-16": "Legal cases",
  "2019-03-21": "Legal cases",
  "2019-05-21": "Satoshi identity",
  "2019-09-02": "Legal cases",
  "2019-11-23": null,
  "2020-01-13": "Legal cases",
  "2020-03-25": "Legal cases",
  "2020-09-04": "Legal cases",
  "2020-09-21": "Legal cases",
  "2021-11-16": "Legal cases",
  "2021-12-07": "Legal cases",
  "2022-10-21": "Legal cases",
  "2022-12-24": "Legal cases",
  "2023-01-28": null,
  "2023-02-08": "Legal cases",
  "2023-03-07": "Legal cases",
  "2023-05-12": null,
  "2023-06-08": "Legal cases",
  "2023-07-13": "Legal cases",
  "2023-07-19": "Satoshi identity",
  "2023-07-22": "Legal cases",
  "2023-08-29": "Legal cases",
  "2023-12-30": "Legal cases",
  "2024-03-30": "Legal cases",
  "2024-06-10": null,
  "2024-06-29": "Legal cases",
  "2024-08-12": null,
  "2024-09-21": null,
  "2024-09-27": null,
  "2024-11-21": "Legal cases",
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

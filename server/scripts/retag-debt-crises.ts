/**
 * Retag rows on Debt crises — editorial map from main-events-leaf-prompts rules.
 *
 * Usage:
 *   npx tsx server/scripts/retag-debt-crises.ts --dry-run
 *   npx tsx server/scripts/retag-debt-crises.ts --apply
 *   npx tsx server/scripts/retag-debt-crises.ts --apply --from 2010-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Debt crises";

/** Editorial map for every row currently tagged Debt crises (103 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-06": "Debt crises",
  "2009-05-21": "Debt crises",
  "2009-07-20": "Debt crises",
  "2009-08-25": "Debt crises",
  "2009-09-24": null,
  "2009-11-05": "Debt crises",
  "2009-11-25": "Debt crises",
  "2009-11-30": "Debt crises",
  "2009-12-08": "Debt crises",
  "2009-12-14": "Debt crises",
  "2010-01-18": "Banking stress",
  "2010-01-19": "Debt crises",
  "2010-01-20": "Debt crises",
  "2010-02-10": "Debt crises",
  "2010-02-26": "Debt crises",
  "2010-03-27": "Debt crises",
  "2010-04-07": "Debt crises",
  "2010-04-15": "Debt crises",
  "2010-04-21": "Debt crises",
  "2010-04-22": "Debt crises",
  "2010-04-23": "Debt crises",
  "2010-04-27": "Debt crises",
  "2010-05-02": "Debt crises",
  "2010-05-21": "Debt crises",
  "2010-06-14": "Debt crises",
  "2010-06-20": null,
  "2010-06-28": "Debt crises",
  "2010-08-19": "Banking stress",
  "2010-10-03": "Debt crises",
  "2010-11-10": null,
  "2010-11-16": "Debt crises",
  "2010-11-22": "Debt crises",
  "2010-11-24": "Debt crises",
  "2011-01-15": "Debt crises",
  "2011-01-16": "Debt crises",
  "2011-01-17": "Debt crises",
  "2011-02-16": "Debt crises",
  "2011-04-06": "Debt crises",
  "2011-04-07": "Debt crises",
  "2011-04-10": "Debt crises",
  "2011-04-18": "Debt crises",
  "2011-04-24": "Debt crises",
  "2011-05-12": "Debt crises",
  "2011-05-15": "Debt crises",
  "2011-07-15": "Debt crises",
  "2011-07-20": "Debt crises",
  "2011-07-25": "Debt crises",
  "2011-07-31": "Debt crises",
  "2011-08-02": "Monetary policy & rates",
  "2011-08-03": "Debt crises",
  "2011-08-06": "Debt crises",
  "2011-08-07": "Debt crises",
  "2011-08-09": null,
  "2011-08-15": "Debt crises",
  "2011-08-16": "Debt crises",
  "2011-08-22": "Debt crises",
  "2011-09-05": "Debt crises",
  "2011-09-24": "Debt crises",
  "2011-10-06": "Debt crises",
  "2011-10-10": "Debt crises",
  "2011-10-15": "Debt crises",
  "2011-10-20": "Debt crises",
  "2011-10-27": "Debt crises",
  "2011-11-09": "Debt crises",
  "2011-11-10": "Debt crises",
  "2011-11-14": "Debt crises",
  "2011-11-28": "Debt crises",
  "2011-12-09": "Debt crises",
  "2011-12-19": "Debt crises",
  "2011-12-28": "Debt crises",
  "2011-12-31": "Debt crises",
  "2012-01-14": "Debt crises",
  "2012-01-24": "Debt crises",
  "2012-01-30": "Debt crises",
  "2012-02-09": "Debt crises",
  "2012-02-22": "Debt crises",
  "2012-03-07": "Debt crises",
  "2012-03-13": "Debt crises",
  "2012-03-15": "Debt crises",
  "2012-05-15": "Debt crises",
  "2012-06-13": "Debt crises",
  "2012-06-14": "Debt crises",
  "2012-08-03": "Debt crises",
  "2012-08-09": null,
  "2012-08-19": null,
  "2012-10-06": "Debt crises",
  "2012-10-28": "Debt crises",
  "2012-11-11": "Debt crises",
  "2013-01-17": "Debt crises",
  "2013-02-04": "Legal cases",
  "2013-05-19": "Debt crises",
  "2013-10-17": "Debt crises",
  "2014-07-31": "Debt crises",
  "2015-08-03": "Debt crises",
  "2016-06-30": "Debt crises",
  "2016-07-01": "Debt crises",
  "2020-03-07": "Debt crises",
  "2020-11-13": "Debt crises",
  "2022-04-12": "Debt crises",
  "2022-12-19": "Debt crises",
  "2023-05-28": "Debt crises",
  "2024-01-19": "Debt crises",
  "2024-06-14": "Monetary policy & rates",
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

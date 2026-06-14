/**
 * Retag rows on Bailouts and stimulus — editorial map from main-events-leaf-prompts rules.
 *
 * Usage:
 *   npx tsx server/scripts/retag-bailouts-stimulus.ts --dry-run
 *   npx tsx server/scripts/retag-bailouts-stimulus.ts --apply
 *   npx tsx server/scripts/retag-bailouts-stimulus.ts --apply --from 2010-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Bailouts and stimulus";

/** Editorial map for every row on Bailouts and stimulus before cleanup (88 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-13": "Bailouts and stimulus",
  "2009-01-15": "Bailouts and stimulus",
  "2009-01-16": "Bailouts and stimulus",
  "2009-01-18": "Bailouts and stimulus",
  "2009-01-19": "Bailouts and stimulus",
  "2009-01-24": "Bailouts and stimulus",
  "2009-02-01": "Bailouts and stimulus",
  "2009-02-07": "Bailouts and stimulus",
  "2009-02-10": "Bailouts and stimulus",
  "2009-02-14": "Bailouts and stimulus",
  "2009-02-17": "Bailouts and stimulus",
  "2009-02-18": "Bailouts and stimulus",
  "2009-03-02": "Bailouts and stimulus",
  "2009-03-17": "Bailouts and stimulus",
  "2009-03-23": null,
  "2009-03-26": null,
  "2009-03-29": "Bailouts and stimulus",
  "2009-04-02": null,
  "2009-04-03": "Bailouts and stimulus",
  "2009-04-10": "Bailouts and stimulus",
  "2009-04-13": null,
  "2009-04-21": null,
  "2009-05-07": null,
  "2009-05-17": null,
  "2009-05-28": "Bailouts and stimulus",
  "2009-05-30": "Bailouts and stimulus",
  "2009-05-31": "Bailouts and stimulus",
  "2009-06-03": "Bailouts and stimulus",
  "2009-06-09": "Bailouts and stimulus",
  "2009-06-21": null,
  "2009-07-19": "Bailouts and stimulus",
  "2009-07-25": null,
  "2009-08-08": "Bailouts and stimulus",
  "2009-09-04": null,
  "2009-09-10": "Bailouts and stimulus",
  "2009-09-12": null,
  "2009-09-25": "Bailouts and stimulus",
  "2009-10-11": null,
  "2009-10-15": null,
  "2009-10-16": "Bailouts and stimulus",
  "2009-10-22": "Bailouts and stimulus",
  "2009-11-09": "Bailouts and stimulus",
  "2009-11-18": "Bailouts and stimulus",
  "2009-12-06": "Bailouts and stimulus",
  "2009-12-07": null,
  "2009-12-15": "Bailouts and stimulus",
  "2010-01-13": "Bailouts and stimulus",
  "2010-02-02": "Bailouts and stimulus",
  "2010-02-03": "Bailouts and stimulus",
  "2010-03-22": "Bailouts and stimulus",
  "2010-03-26": "Bailouts and stimulus",
  "2010-03-30": null,
  "2010-04-26": null,
  "2010-05-09": "Bailouts and stimulus",
  "2010-05-25": null,
  "2010-06-07": "Bailouts and stimulus",
  "2010-07-21": null,
  "2010-07-30": "Bailouts and stimulus",
  "2010-08-05": "Bailouts and stimulus",
  "2010-08-23": "Bailouts and stimulus",
  "2010-08-26": "Bailouts and stimulus",
  "2010-09-05": "Bailouts and stimulus",
  "2010-10-09": null,
  "2010-11-11": "Bailouts and stimulus",
  "2010-11-28": "Bailouts and stimulus",
  "2010-12-15": "Bailouts and stimulus",
  "2010-12-21": "Bailouts and stimulus",
  "2011-02-07": null,
  "2011-02-08": null,
  "2011-02-17": "Bailouts and stimulus",
  "2011-03-28": "Bailouts and stimulus",
  "2011-05-05": "Bailouts and stimulus",
  "2012-03-05": "Bailouts and stimulus",
  "2012-05-02": null,
  "2012-05-28": "Bailouts and stimulus",
  "2012-07-20": "Bailouts and stimulus",
  "2012-10-05": "Bailouts and stimulus",
  "2012-11-03": null,
  "2013-02-23": "Bailouts and stimulus",
  "2013-03-15": "Bailouts and stimulus",
  "2013-03-16": "Bailouts and stimulus",
  "2013-08-24": "Bailouts and stimulus",
  "2020-03-17": "Bailouts and stimulus",
  "2020-03-18": "Bailouts and stimulus",
  "2020-03-22": "Bailouts and stimulus",
  "2020-07-04": "Bailouts and stimulus",
  "2020-07-08": "Bailouts and stimulus",
  "2020-12-08": "Bailouts and stimulus",
  "2021-03-11": "Bailouts and stimulus",
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

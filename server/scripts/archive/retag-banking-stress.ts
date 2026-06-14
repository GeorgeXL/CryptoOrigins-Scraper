/**
 * Retag rows on Banking stress — editorial map from main-events-leaf-prompts rules.
 *
 * Usage:
 *   npx tsx server/scripts/retag-banking-stress.ts --dry-run
 *   npx tsx server/scripts/retag-banking-stress.ts --apply
 *   npx tsx server/scripts/retag-banking-stress.ts --apply --from 2010-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Banking stress";

/** Editorial map for every row currently tagged Banking stress (117 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-08": "Banking stress",
  "2009-02-02": "Banking stress",
  "2009-02-03": "Banking stress",
  "2009-02-08": "Banking stress",
  "2009-02-09": "Banking stress",
  "2009-02-20": "Banking stress",
  "2009-02-21": "Banking stress",
  "2009-02-25": "Banking stress",
  "2009-03-04": "Banking stress",
  "2009-03-07": "Banking stress",
  "2009-03-09": "Banking stress",
  "2009-03-10": "Global growth and recession",
  "2009-03-14": "Banking stress",
  "2009-04-06": "Banking stress",
  "2009-04-20": "Banking stress",
  "2009-04-22": "Banking stress",
  "2009-04-28": "Banking stress",
  "2009-04-30": "Global growth and recession",
  "2009-05-04": "Banking stress",
  "2009-05-11": "Banking stress",
  "2009-06-14": "Banking stress",
  "2009-06-22": "Banking stress",
  "2009-08-06": "Banking stress",
  "2009-08-10": null,
  "2009-08-22": "Banking stress",
  "2009-08-23": "Banking stress",
  "2009-08-27": "Banking stress",
  "2009-08-29": "Banking stress",
  "2009-09-14": "Banking stress",
  "2009-09-30": "Banking stress",
  "2009-10-19": "Banking stress",
  "2009-10-20": "Banking stress",
  "2009-10-23": "Banking stress",
  "2009-10-24": "Banking stress",
  "2009-10-30": "Banking stress",
  "2009-11-01": "Banking stress",
  "2009-11-12": "Banking stress",
  "2009-11-24": "Banking stress",
  "2009-12-02": "Banking stress",
  "2009-12-18": "Banking stress",
  "2009-12-29": "Banking stress",
  "2010-01-07": "Banking stress",
  "2010-01-15": "Global growth and recession",
  "2010-01-18": "Banking stress",
  "2010-01-22": "Banking stress",
  "2010-02-18": "Banking stress",
  "2010-03-04": "Banking stress",
  "2010-04-05": "Banking stress",
  "2010-04-12": "Banking stress",
  "2010-04-14": "Banking stress",
  "2010-04-30": "Securities regulation",
  "2010-05-05": null,
  "2010-05-14": "Global growth and recession",
  "2010-05-27": "Banking stress",
  "2010-08-19": "Banking stress",
  "2010-09-02": "Banking stress",
  "2010-09-06": "Banking stress",
  "2010-09-17": "Banking stress",
  "2010-10-29": "Banking stress",
  "2010-11-02": "Banking stress",
  "2010-11-05": "Banking stress",
  "2010-11-30": "Banking stress",
  "2010-12-14": null,
  "2010-12-18": null,
  "2010-12-27": "Banking stress",
  "2011-01-03": "Banking stress",
  "2011-01-18": "Banking stress",
  "2011-01-23": "Banking stress",
  "2011-02-25": "Banking stress",
  "2011-03-05": "Banking stress",
  "2011-04-08": "Banking stress",
  "2011-07-13": "Banking stress",
  "2011-07-21": "Banking stress",
  "2011-08-31": "Banking stress",
  "2011-09-09": "Banking stress",
  "2011-09-20": "Banking stress",
  "2011-10-22": "Banking stress",
  "2011-11-27": "Banking stress",
  "2011-12-04": "Banking stress",
  "2011-12-26": "Banking stress",
  "2012-03-17": "Banking stress",
  "2012-03-26": "Banking stress",
  "2012-04-08": null,
  "2012-04-19": null,
  "2012-05-13": "Banking stress",
  "2012-05-25": null,
  "2012-05-26": "Banking stress",
  "2012-06-27": "Banking stress",
  "2012-06-28": "Banking stress",
  "2012-07-03": "Banking stress",
  "2012-08-12": "Banking stress",
  "2012-10-03": "Securities regulation",
  "2012-10-13": "Banking stress",
  "2012-10-14": "Banking stress",
  "2012-10-16": "Banking stress",
  "2012-11-02": "Banking stress",
  "2012-11-16": "Securities regulation",
  "2012-11-23": "Banking stress",
  "2012-11-26": "Banking stress",
  "2012-11-27": "Banking stress",
  "2013-02-06": null,
  "2013-03-25": "Banking stress",
  "2013-03-30": "Banking stress",
  "2013-06-09": "Banking stress",
  "2013-07-20": "Debt crises",
  "2013-07-26": null,
  "2013-07-28": "Banking stress",
  "2015-06-28": "Banking stress",
  "2016-12-21": "Banking stress",
  "2017-01-31": "Banking stress",
  "2023-03-08": "Banking stress",
  "2023-03-10": "Banking stress",
  "2023-03-12": "Banking stress",
  "2023-03-19": "Banking stress",
  "2023-04-08": "Banking stress",
  "2023-05-01": "Banking stress",
  "2023-06-12": "Banking stress",
  "2024-12-15": "Bitcoin price & cycles",
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

/**
 * Retag rows on Banking & prudential (crypto) — banking rules for crypto custody,
 * capital treatment, and prudential guidance.
 *
 * Usage:
 *   npx tsx server/scripts/retag-banking-prudential.ts --dry-run
 *   npx tsx server/scripts/retag-banking-prudential.ts --apply
 *   npx tsx server/scripts/retag-banking-prudential.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Banking & prudential (crypto)";

/** Editorial map for every row currently tagged Banking & prudential (crypto) (70 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-03-04": null,
  "2009-06-17": "Banking stress",
  "2009-09-05": "Banking stress",
  "2009-09-14": "Banking stress",
  "2009-09-20": "Banking stress",
  "2009-09-27": "Banking stress",
  "2010-01-22": "Banking stress",
  "2010-01-31": "Banking stress",
  "2010-02-18": "Securities regulation",
  "2010-02-26": null,
  "2010-04-28": "Securities regulation",
  "2010-06-17": "Banking stress",
  "2010-06-25": "Securities regulation",
  "2010-06-29": "Tax policy",
  "2010-10-11": "Enforcement & crime",
  "2010-11-15": null,
  "2010-12-14": null,
  "2010-12-27": "Bailouts and stimulus",
  "2011-01-09": null,
  "2011-01-18": "Banking stress",
  "2011-01-22": "Banking stress",
  "2011-01-23": "Banking stress",
  "2011-01-27": "Banking stress",
  "2011-02-08": null,
  "2011-02-14": null,
  "2011-02-25": "Banking stress",
  "2011-03-28": null,
  "2011-04-08": null,
  "2011-05-05": "Banking stress",
  "2011-06-16": "Banking stress",
  "2011-07-01": null,
  "2011-08-31": "Banking stress",
  "2011-09-09": "Banking stress",
  "2011-11-05": null,
  "2011-12-18": "Banking stress",
  "2012-01-23": "Monetary policy & rates",
  "2012-01-27": "Securities regulation",
  "2012-03-26": null,
  "2012-04-05": "Enforcement & crime",
  "2012-06-07": "Banking stress",
  "2012-07-02": null,
  "2012-07-08": "Banking stress",
  "2012-07-17": "Enforcement & crime",
  "2012-08-12": "Banking stress",
  "2012-08-20": "Politics and elections",
  "2012-10-13": "Banking stress",
  "2012-10-23": null,
  "2012-11-02": "Banking stress",
  "2012-11-26": null,
  "2013-03-14": "Monetary policy & rates",
  "2013-04-25": LEAF,
  "2013-07-26": null,
  "2013-07-28": null,
  "2013-12-01": LEAF,
  "2014-07-04": LEAF,
  "2014-11-15": LEAF,
  "2014-12-01": LEAF,
  "2015-01-31": LEAF,
  "2015-04-18": LEAF,
  "2015-05-07": LEAF,
  "2017-04-09": LEAF,
  "2017-08-25": "Monetary policy & rates",
  "2018-02-10": LEAF,
  "2018-07-05": LEAF,
  "2021-05-19": LEAF,
  "2021-06-10": LEAF,
  "2021-07-07": LEAF,
  "2022-01-02": null,
  "2023-10-05": LEAF,
  "2024-01-17": null,
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

/**
 * Retag rows on Stablecoins — Stablecoin launches, peg breaks, and regulatory moments.
 *
 * Usage:
 *   npx tsx server/scripts/retag-stablecoins.ts --dry-run
 *   npx tsx server/scripts/retag-stablecoins.ts --apply
 *   npx tsx server/scripts/retag-stablecoins.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Stablecoins";

/** Editorial map for every row currently tagged Stablecoins (55 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-08-14": null,
  "2014-10-06": "Stablecoins",
  "2014-11-20": "Stablecoins",
  "2015-04-20": "Stablecoins",
  "2017-09-12": null,
  "2018-06-29": "Stablecoins",
  "2018-09-10": "Stablecoins",
  "2018-09-26": "Stablecoins",
  "2018-10-24": "Stablecoins",
  "2019-05-04": "Bitcoin price & cycles",
  "2019-06-18": "Stablecoins",
  "2019-09-05": "Stablecoins",
  "2019-10-11": "Stablecoins",
  "2019-11-10": "DeFi",
  "2019-11-18": "Stablecoins",
  "2020-03-01": "Stablecoins",
  "2020-04-26": "Stablecoins",
  "2020-05-15": "Stablecoins",
  "2020-08-28": "Stablecoins",
  "2020-09-27": "Exchanges",
  "2020-12-01": "Stablecoins",
  "2021-02-23": "Stablecoins",
  "2021-04-04": "Stablecoins",
  "2021-08-24": "Stablecoins",
  "2021-08-30": "Institutional Bitcoin & flows",
  "2022-01-01": "Stablecoins",
  "2022-05-07": "Stablecoins",
  "2022-05-09": "Stablecoins",
  "2022-05-10": null,
  "2022-05-12": "Stablecoins",
  "2022-05-15": "Exchanges",
  "2022-06-04": null,
  "2022-06-10": "Stablecoins",
  "2022-07-14": "Stablecoins",
  "2022-10-07": "Stablecoins",
  "2023-01-31": "Stablecoins",
  "2023-02-21": "Stablecoins",
  "2023-03-05": "Stablecoins",
  "2023-03-11": "Stablecoins",
  "2023-03-20": "Bitcoin adoption",
  "2023-07-07": "Stablecoins",
  "2023-07-16": "Stablecoins",
  "2023-08-08": "Stablecoins",
  "2023-08-22": "Stablecoins",
  "2023-08-24": "Stablecoins",
  "2023-08-31": "Stablecoins",
  "2023-10-30": "Stablecoins",
  "2023-11-15": "Stablecoins",
  "2023-12-09": "Stablecoins",
  "2024-04-22": "Stablecoins",
  "2024-06-17": "Stablecoins",
  "2024-06-30": "Stablecoins",
  "2024-08-27": "Stablecoins",
  "2024-09-18": "Stablecoins",
  "2024-12-04": "Stablecoins",
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

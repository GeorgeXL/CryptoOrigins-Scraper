/**
 * Retag rows on DeFi — DeFi protocol launches, hacks, and governance milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-defi.ts --dry-run
 *   npx tsx server/scripts/retag-defi.ts --apply
 *   npx tsx server/scripts/retag-defi.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "DeFi";

/** Editorial map for every row currently tagged DeFi (55 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2010-01-05": null,
  "2016-05-28": "Exchanges",
  "2018-07-11": "DeFi",
  "2018-09-24": "Web3 industry and funding",
  "2018-09-27": "DeFi",
  "2018-11-01": "DeFi",
  "2019-04-01": "Web3 industry and funding",
  "2020-01-01": "DeFi",
  "2020-01-07": "DeFi",
  "2020-03-31": "DeFi",
  "2020-05-17": "DeFi",
  "2020-05-18": "DeFi",
  "2020-06-15": "DeFi",
  "2020-06-21": "Securities regulation",
  "2020-06-23": "DeFi",
  "2020-07-01": "DeFi",
  "2020-07-17": "DeFi",
  "2020-08-13": "DeFi",
  "2020-09-02": "DeFi",
  "2020-09-05": "DeFi",
  "2020-09-07": "DeFi",
  "2020-09-16": "DeFi",
  "2020-10-06": "Wallets & self-custody",
  "2020-10-10": "DeFi",
  "2020-10-29": "DeFi",
  "2020-12-03": "DeFi",
  "2020-12-18": "DeFi",
  "2021-05-05": "DeFi",
  "2021-05-20": "DeFi",
  "2021-07-16": "Bitcoin adoption",
  "2021-08-10": "DeFi",
  "2021-08-29": "DeFi",
  "2021-09-08": "DeFi",
  "2021-10-27": "DeFi",
  "2022-01-17": "Bitcoin adoption",
  "2022-02-02": "Cross-chain and bridges",
  "2022-03-06": "DeFi",
  "2022-03-23": "Cross-chain and bridges",
  "2022-06-07": "Web3 industry and funding",
  "2022-08-09": "DeFi",
  "2022-08-24": "DeFi",
  "2022-08-26": "DeFi",
  "2022-09-20": "DeFi",
  "2022-10-06": "DeFi",
  "2022-10-24": "DeFi",
  "2023-01-22": "DeFi",
  "2023-03-13": "DeFi",
  "2023-04-09": "DeFi",
  "2023-04-16": "DeFi",
  "2023-05-22": "DeFi",
  "2023-07-30": "DeFi",
  "2024-02-25": null,
  "2024-08-13": "DeFi",
  "2024-11-15": "Bitcoin adoption",
  "2024-11-26": "DeFi",
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

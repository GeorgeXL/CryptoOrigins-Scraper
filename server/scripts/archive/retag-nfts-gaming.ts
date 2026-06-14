/**
 * Retag rows on NFTs and gaming — NFT marketplaces, collections, and crypto gaming milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-nfts-gaming.ts --dry-run
 *   npx tsx server/scripts/retag-nfts-gaming.ts --apply
 *   npx tsx server/scripts/retag-nfts-gaming.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "NFTs and gaming";

/** Editorial map for every row currently tagged NFTs and gaming (43 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2012-05-19": null,
  "2012-07-05": "Bitcoin adoption",
  "2013-01-10": "Bitcoin adoption",
  "2015-04-01": "Enforcement & crime",
  "2015-05-29": "Enforcement & crime",
  "2016-04-05": "Bitcoin adoption",
  "2016-05-10": "Bitcoin adoption",
  "2016-09-04": "Bitcoin adoption",
  "2017-06-01": "NFTs and gaming",
  "2017-06-23": "NFTs and gaming",
  "2017-12-01": "NFTs and gaming",
  "2018-01-01": "Web3 industry and funding",
  "2019-01-01": "NFTs and gaming",
  "2019-12-28": "NFTs and gaming",
  "2020-11-27": "NFTs and gaming",
  "2021-03-06": "Bitcoin price & cycles",
  "2021-04-21": "NFTs and gaming",
  "2021-07-01": "NFTs and gaming",
  "2021-09-17": "NFTs and gaming",
  "2021-11-29": "NFTs and gaming",
  "2021-12-25": "Tax policy",
  "2022-01-10": "NFTs and gaming",
  "2022-03-28": "NFTs and gaming",
  "2022-04-24": "NFTs and gaming",
  "2022-04-30": "NFTs and gaming",
  "2022-05-23": "NFTs and gaming",
  "2022-06-14": "NFTs and gaming",
  "2022-07-03": "Government adoption",
  "2022-09-11": "NFTs and gaming",
  "2022-10-14": "Securities regulation",
  "2022-10-27": "NFTs and gaming",
  "2022-11-30": null,
  "2023-02-08": "Legal cases",
  "2023-02-14": "NFTs and gaming",
  "2023-03-22": "NFTs and gaming",
  "2023-03-23": "NFTs and gaming",
  "2023-04-04": "NFTs and gaming",
  "2023-05-19": null,
  "2023-05-27": "NFTs and gaming",
  "2024-06-15": "NFTs and gaming",
  "2024-07-21": null,
  "2024-07-25": "NFTs and gaming",
  "2024-12-10": "NFTs and gaming",
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

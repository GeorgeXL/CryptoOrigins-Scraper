/**
 * Retag rows on Cross-chain and bridges — bridges, interoperability protocols, and cross-chain hacks.
 * Excludes Bitcoin L2 (→ Scaling and Layer 2).
 *
 * Usage:
 *   npx tsx server/scripts/retag-cross-chain-bridges.ts --dry-run
 *   npx tsx server/scripts/retag-cross-chain-bridges.ts --apply
 *   npx tsx server/scripts/retag-cross-chain-bridges.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Cross-chain and bridges";

/** Editorial map for every row currently tagged Cross-chain and bridges (54 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2010-05-01": null,
  "2010-07-03": null,
  "2010-11-29": null,
  "2012-10-10": null,
  "2013-01-08": null,
  "2013-12-24": "Exchanges",
  "2014-04-21": "Bitcoin adoption",
  "2014-07-04": "Banking & prudential (crypto)",
  "2015-05-16": "Government adoption",
  "2015-05-20": "Wallets & self-custody",
  "2015-06-22": "Bitcoin adoption",
  "2015-07-22": "Institutional Bitcoin & flows",
  "2015-08-08": "Bitcoin adoption",
  "2016-01-28": "Web3 industry and funding",
  "2016-03-29": "Institutional Bitcoin & flows",
  "2016-08-20": "Bitcoin adoption",
  "2016-09-09": "Bitcoin adoption",
  "2016-09-23": "Web3 industry and funding",
  "2016-11-30": "Institutional Bitcoin & flows",
  "2017-05-30": "Protocol & upgrades",
  "2017-06-20": "Bitcoin adoption",
  "2017-06-28": "Web3 industry and funding",
  "2017-08-23": "Enforcement & crime",
  "2018-03-04": "Bitcoin adoption",
  "2018-03-12": "Bitcoin adoption",
  "2018-05-18": null,
  "2019-01-28": "Cross-chain and bridges",
  "2019-02-17": "Bitcoin adoption",
  "2019-03-08": null,
  "2019-03-13": "Cross-chain and bridges",
  "2019-08-22": "Cross-chain and bridges",
  "2020-06-01": "Cross-chain and bridges",
  "2021-03-25": "CBDCs",
  "2021-04-01": "Cross-chain and bridges",
  "2022-01-08": "Cross-chain and bridges",
  "2022-01-27": "Cross-chain and bridges",
  "2022-03-16": "Cross-chain and bridges",
  "2022-03-29": "Cross-chain and bridges",
  "2022-03-31": "Smart contracts & L1s",
  "2022-04-04": "Cross-chain and bridges",
  "2022-06-23": "Cross-chain and bridges",
  "2022-06-28": "Cross-chain and bridges",
  "2022-08-01": "Cross-chain and bridges",
  "2022-11-17": "Cross-chain and bridges",
  "2022-11-19": "Exchanges",
  "2023-02-15": "Cross-chain and bridges",
  "2023-03-03": "Cross-chain and bridges",
  "2023-07-04": "Cross-chain and bridges",
  "2023-07-17": "Cross-chain and bridges",
  "2023-07-31": "Cross-chain and bridges",
  "2023-12-20": "Scaling and Layer 2",
  "2024-07-23": "Scaling and Layer 2",
  "2024-08-06": "Cross-chain and bridges",
  "2024-12-16": "Scaling and Layer 2",
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

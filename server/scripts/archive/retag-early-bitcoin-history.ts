/**
 * Retag rows on Early Bitcoin history — keep only origin-era milestones.
 *
 * Usage:
 *   npx tsx server/scripts/retag-early-bitcoin-history.ts --dry-run
 *   npx tsx server/scripts/retag-early-bitcoin-history.ts --apply
 *   npx tsx server/scripts/retag-early-bitcoin-history.ts --apply --from 2010-01-01 --to 2010-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Early Bitcoin history";

/** Editorial map for every row on Early Bitcoin history at cleanup time. null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2008-08-18": "Early Bitcoin history",
  "2008-10-31": "Early Bitcoin history",
  "2009-01-03": "Early Bitcoin history",
  "2009-01-09": "Early Bitcoin history",
  "2009-01-10": "Early Bitcoin history",
  "2009-01-12": "Early Bitcoin history",
  "2009-01-30": "Early Bitcoin history",
  "2009-02-11": "Early Bitcoin history",
  "2009-03-08": "Early Bitcoin history",
  "2009-04-18": "Early Bitcoin history",
  "2009-05-02": "Early Bitcoin history",
  "2009-05-08": "Early Bitcoin history",
  "2009-10-05": "Bitcoin price & cycles",
  "2009-10-09": "Early Bitcoin history",
  "2009-10-12": "Bitcoin price & cycles",
  "2009-11-22": "Early Bitcoin history",
  "2010-01-24": "Bitcoin adoption",
  "2010-01-25": "Early Bitcoin history",
  "2010-03-20": "Bitcoin adoption",
  "2010-05-17": null,
  "2010-05-18": "Early Bitcoin history",
  "2010-05-20": "Bitcoin adoption",
  "2010-05-22": "Early Bitcoin history",
  "2010-07-11": "Early Bitcoin history",
  "2010-10-04": "Early Bitcoin history",
  "2010-10-14": "Exchanges",
  "2010-11-01": "Early Bitcoin history",
  "2010-12-05": "Early Bitcoin history",
  "2010-12-12": "Early Bitcoin history",
  "2010-12-31": null,
  "2011-01-02": null,
  "2011-01-08": null,
  "2011-01-27": "Bitcoin adoption",
  "2011-04-16": "Bitcoin adoption",
  "2011-06-03": "Bitcoin price & cycles",
  "2011-07-19": "Protocol & upgrades",
  "2011-07-22": "Wallets & self-custody",
  "2011-09-28": null,
  "2011-10-28": null,
  "2012-01-16": "Bitcoin adoption",
  "2012-02-25": null,
  "2012-03-18": "Bitcoin mining",
  "2012-06-03": "Bitcoin mining",
  "2012-07-22": "Bitcoin adoption",
  "2012-09-24": "Bitcoin regulation",
  "2012-09-28": "Bitcoin adoption",
  "2012-10-07": "Bitcoin adoption",
  "2013-12-12": null,
  "2014-08-28": null,
  "2014-09-29": null,
  "2014-11-17": "Enforcement & crime",
  "2016-10-20": "Bitcoin adoption",
  "2017-05-03": "Bitcoin price & cycles",
  "2017-05-18": "Enforcement & crime",
  "2018-02-04": "Bitcoin price & cycles",
  "2018-02-08": null,
  "2018-04-04": "Bitcoin mining",
  "2019-07-15": "Protocol & upgrades",
  "2019-08-15": "Bitcoin price & cycles",
  "2021-01-12": null,
  "2021-04-18": "Bitcoin price & cycles",
  "2021-09-05": "Bitcoin price & cycles",
  "2021-12-13": "Bitcoin mining",
  "2022-01-03": "Bitcoin adoption",
  "2022-03-04": "Bitcoin price & cycles",
  "2022-06-06": "Bitcoin price & cycles",
  "2022-10-08": "Satoshi identity",
  "2022-12-17": null,
  "2024-04-13": "Bitcoin price & cycles",
  "2024-05-05": "Protocol & upgrades",
  "2024-08-19": "Bitcoin mining",
  "2024-12-24": "Bitcoin mining",
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

/**
 * Retag rows on Global growth and recession — keep recessions, recoveries, and growth shocks;
 * move crypto-led headlines and off-topic rows off.
 *
 * Usage:
 *   npx tsx server/scripts/retag-global-growth-recession.ts --dry-run
 *   npx tsx server/scripts/retag-global-growth-recession.ts --apply
 *   npx tsx server/scripts/retag-global-growth-recession.ts --apply --from 2009-01-01 --to 2012-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Global growth and recession";

/** Editorial map for every row currently tagged Global growth and recession (212 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2008-08-20": "Global growth and recession",
  "2009-01-26": null,
  "2009-02-12": null,
  "2009-03-06": null,
  "2009-03-10": "Banking stress",
  "2009-03-15": "Global growth and recession",
  "2009-03-28": "Global growth and recession",
  "2009-03-30": "Global growth and recession",
  "2009-03-31": "Global growth and recession",
  "2009-04-01": null,
  "2009-04-11": null,
  "2009-04-12": null,
  "2009-04-19": null,
  "2009-04-23": null,
  "2009-04-27": null,
  "2009-04-30": "Global growth and recession",
  "2009-05-03": "Global growth and recession",
  "2009-05-09": "Global growth and recession",
  "2009-05-19": null,
  "2009-05-24": "Global growth and recession",
  "2009-05-26": null,
  "2009-06-01": "Global growth and recession",
  "2009-06-07": null,
  "2009-06-13": null,
  "2009-06-19": "Global growth and recession",
  "2009-06-25": null,
  "2009-06-29": null,
  "2009-07-06": null,
  "2009-07-08": null,
  "2009-07-12": null,
  "2009-07-13": "Global growth and recession",
  "2009-07-23": "Global growth and recession",
  "2009-07-26": null,
  "2009-07-28": null,
  "2009-07-31": "Global growth and recession",
  "2009-08-07": null,
  "2009-08-17": null,
  "2009-08-21": "Global growth and recession",
  "2009-08-28": "Global growth and recession",
  "2009-09-03": null,
  "2009-09-07": null,
  "2009-09-08": null,
  "2009-09-29": "Global growth and recession",
  "2009-10-01": "Global growth and recession",
  "2009-10-21": null,
  "2009-11-02": "Global growth and recession",
  "2009-11-06": null,
  "2009-11-08": null,
  "2009-11-17": null,
  "2009-11-20": "Global growth and recession",
  "2009-12-01": null,
  "2009-12-20": null,
  "2009-12-22": "Global growth and recession",
  "2009-12-23": "Global growth and recession",
  "2010-01-01": null,
  "2010-01-04": "Global growth and recession",
  "2010-01-10": null,
  "2010-01-15": null,
  "2010-01-21": "Global growth and recession",
  "2010-01-29": "Global growth and recession",
  "2010-02-04": null,
  "2010-02-09": "Global growth and recession",
  "2010-02-14": null,
  "2010-02-25": "Global growth and recession",
  "2010-03-03": null,
  "2010-04-02": "Global growth and recession",
  "2010-04-10": null,
  "2010-04-17": null,
  "2010-05-04": null,
  "2010-05-08": null,
  "2010-05-14": "Banking stress",
  "2010-05-15": null,
  "2010-05-19": null,
  "2010-05-24": null,
  "2010-05-26": null,
  "2010-05-29": null,
  "2010-07-04": null,
  "2010-07-10": null,
  "2010-07-14": null,
  "2010-07-19": null,
  "2010-07-22": null,
  "2010-07-28": null,
  "2010-07-29": null,
  "2010-07-31": "Global growth and recession",
  "2010-08-25": null,
  "2010-08-30": null,
  "2010-09-03": null,
  "2010-09-04": null,
  "2010-09-13": "Global growth and recession",
  "2010-09-30": "Global growth and recession",
  "2010-10-02": "Global growth and recession",
  "2010-10-05": null,
  "2010-10-11": null,
  "2010-10-12": null,
  "2010-10-15": null,
  "2010-10-16": null,
  "2010-10-25": "Global growth and recession",
  "2010-11-21": null,
  "2010-12-10": null,
  "2010-12-29": "Global growth and recession",
  "2011-01-11": null,
  "2011-01-19": null,
  "2011-01-20": null,
  "2011-02-01": "Global growth and recession",
  "2011-02-04": null,
  "2011-02-21": "Global growth and recession",
  "2011-03-06": null,
  "2011-03-19": null,
  "2011-03-23": "Global growth and recession",
  "2011-04-17": null,
  "2011-04-19": null,
  "2011-04-20": null,
  "2011-05-24": "Global growth and recession",
  "2011-06-22": null,
  "2011-06-26": "Global growth and recession",
  "2011-07-28": null,
  "2011-08-08": "Global growth and recession",
  "2011-08-24": null,
  "2011-08-27": null,
  "2011-08-28": "Global growth and recession",
  "2011-09-04": "Global growth and recession",
  "2011-09-14": null,
  "2011-09-22": "Global growth and recession",
  "2011-10-16": "Global growth and recession",
  "2011-10-29": null,
  "2011-10-30": "Global growth and recession",
  "2011-11-11": "Bitcoin price & cycles",
  "2011-12-16": null,
  "2011-12-23": null,
  "2011-12-25": "Global growth and recession",
  "2012-01-03": "Global growth and recession",
  "2012-01-10": null,
  "2012-01-11": null,
  "2012-01-19": null,
  "2012-01-20": "Global growth and recession",
  "2012-01-26": null,
  "2012-02-03": null,
  "2012-02-06": "Global growth and recession",
  "2012-02-14": null,
  "2012-02-19": "Global growth and recession",
  "2012-02-26": "Global growth and recession",
  "2012-03-10": null,
  "2012-03-14": null,
  "2012-04-06": null,
  "2012-04-14": null,
  "2012-04-22": "Global growth and recession",
  "2012-04-29": "Global growth and recession",
  "2012-04-30": "Global growth and recession",
  "2012-05-03": "Global growth and recession",
  "2012-05-20": "Global growth and recession",
  "2012-05-22": "Global growth and recession",
  "2012-06-04": "Global growth and recession",
  "2012-06-11": "Global growth and recession",
  "2012-06-15": "Global growth and recession",
  "2012-06-16": null,
  "2012-06-22": "Global growth and recession",
  "2012-07-06": "Global growth and recession",
  "2012-07-10": "Global growth and recession",
  "2012-07-28": null,
  "2012-07-31": "Global growth and recession",
  "2012-08-11": null,
  "2012-08-14": "Global growth and recession",
  "2012-09-02": "Global growth and recession",
  "2012-09-08": "Global growth and recession",
  "2012-10-09": null,
  "2012-10-21": null,
  "2012-11-24": null,
  "2012-12-02": null,
  "2013-01-20": null,
  "2013-03-01": "Global growth and recession",
  "2013-06-05": "Global growth and recession",
  "2013-07-27": null,
  "2013-11-17": "Bitcoin price & cycles",
  "2014-01-03": "Bitcoin price & cycles",
  "2014-02-03": "Bitcoin price & cycles",
  "2014-04-13": null,
  "2014-12-15": "Global growth and recession",
  "2015-02-06": "Global growth and recession",
  "2015-02-24": "Global growth and recession",
  "2015-08-17": "Web3 industry and funding",
  "2015-09-26": "Web3 industry and funding",
  "2015-10-25": "Bitcoin adoption",
  "2015-12-03": "Bitcoin adoption",
  "2016-03-12": null,
  "2016-05-04": "Tax policy",
  "2016-05-24": null,
  "2016-08-01": "Bitcoin price & cycles",
  "2016-09-14": "Protocol & upgrades",
  "2016-12-10": null,
  "2016-12-11": "Web3 industry and funding",
  "2017-03-01": "Bitcoin price & cycles",
  "2018-06-09": "Smart contracts & L1s",
  "2019-07-16": null,
  "2019-08-14": null,
  "2020-03-11": "Global growth and recession",
  "2020-07-21": "Web3 industry and funding",
  "2021-05-16": null,
  "2022-01-09": "Global growth and recession",
  "2022-02-24": "Global growth and recession",
  "2022-04-09": null,
  "2022-07-29": "Bitcoin price & cycles",
  "2022-08-07": "Bitcoin price & cycles",
  "2023-01-19": null,
  "2023-02-12": null,
  "2023-04-02": null,
  "2023-07-08": "Web3 industry and funding",
  "2023-08-18": "Global growth and recession",
  "2023-09-03": "Bitcoin adoption",
  "2024-02-15": "ETFs and investment products",
  "2024-05-13": "Stablecoins",
  "2024-07-19": "Bitcoin price & cycles",
  "2024-12-09": "Government adoption",
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

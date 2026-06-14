/**
 * Retag rows on Global growth and recession — keep recessions, recoveries, and growth shocks;
 * move crypto-led headlines and off-topic rows off.
 *
 * Usage:
 *   npx tsx server/scripts/retag-global-growth.ts --dry-run
 *   npx tsx server/scripts/retag-global-growth.ts --apply
 *   npx tsx server/scripts/retag-global-growth.ts --apply --from 2009-01-01 --to 2012-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Global growth and recession";

/** Editorial map for every row currently tagged Global growth and recession (110 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-18": "Institutional Bitcoin & flows",
  "2009-01-20": null,
  "2009-01-25": "Securities regulation",
  "2009-02-10": null,
  "2009-02-16": "Government adoption",
  "2009-02-23": "Government adoption",
  "2009-02-27": null,
  "2009-03-10": null,
  "2009-03-15": "Global growth and recession",
  "2009-03-28": "Global growth and recession",
  "2009-03-31": "Global growth and recession",
  "2009-03-30": "Global growth and recession",
  "2009-04-16": null,
  "2009-05-09": "Global growth and recession",
  "2009-07-28": null,
  "2009-07-31": "Global growth and recession",
  "2009-08-29": "Derivatives",
  "2009-04-01": "Global growth and recession",
  "2009-04-10": "Global growth and recession",
  "2009-04-30": "Banking stress",
  "2009-05-03": "Global growth and recession",
  "2009-06-07": null,
  "2009-05-07": "Bailouts and stimulus",
  "2009-06-05": null,
  "2009-06-19": "Global growth and recession",
  "2009-06-25": null,
  "2009-07-08": "Web3 industry and funding",
  "2009-07-23": "Global growth and recession",
  "2009-07-29": null,
  "2009-08-17": null,
  "2009-08-21": "Global growth and recession",
  "2009-09-03": null,
  "2009-09-04": null,
  "2009-09-10": null,
  "2009-09-26": "Institutional Bitcoin & flows",
  "2009-10-09": null,
  "2009-11-15": "Bitcoin price & cycles",
  "2010-01-04": "Global growth and recession",
  "2010-01-21": "Global growth and recession",
  "2010-01-15": "Institutional Bitcoin & flows",
  "2010-01-29": "Global growth and recession",
  "2010-02-04": "Scaling and Layer 2",
  "2010-02-14": null,
  "2010-03-12": "Bitcoin price & cycles",
  "2010-03-31": null,
  "2010-04-02": "Global growth and recession",
  "2010-04-10": null,
  "2010-05-04": null,
  "2010-05-19": null,
  "2010-05-14": "Banking stress",
  "2010-05-26": null,
  "2010-06-13": "Monetary policy & rates",
  "2010-07-31": "Global growth and recession",
  "2010-09-13": "Global growth and recession",
  "2010-10-02": "Global growth and recession",
  "2010-10-11": "Banking stress",
  "2010-10-05": null,
  "2010-10-06": null,
  "2010-10-18": "ETFs and investment products",
  "2010-10-25": "Global growth and recession",
  "2010-11-08": null,
  "2010-11-16": "Debt crises",
  "2010-11-18": "Government adoption",
  "2010-12-29": "Global growth and recession",
  "2011-01-01": null,
  "2011-01-08": "Labor market",
  "2011-01-31": null,
  "2011-02-21": "Global growth and recession",
  "2011-03-15": "Bitcoin price & cycles",
  "2011-03-23": "Global growth and recession",
  "2011-03-29": "Protocol & upgrades",
  "2011-04-17": null,
  "2011-04-19": null,
  "2011-04-22": null,
  "2011-05-18": "Institutional Bitcoin & flows",
  "2011-05-26": "Institutional Bitcoin & flows",
  "2011-06-26": "Global growth and recession",
  "2011-08-08": "Global growth and recession",
  "2011-08-27": null,
  "2011-08-28": "Global growth and recession",
  "2011-09-04": "Global growth and recession",
  "2011-10-20": "Debt crises",
  "2011-10-24": "Institutional Bitcoin & flows",
  "2011-11-11": "Bitcoin price & cycles",
  "2011-11-27": null,
  "2011-12-19": null,
  "2011-12-25": "Global growth and recession",
  "2011-12-31": "Debt crises",
  "2012-01-01": "Labor market",
  "2012-01-03": "Global growth and recession",
  "2012-01-20": "Global growth and recession",
  "2012-01-07": null,
  "2012-01-11": null,
  "2012-02-06": "Global growth and recession",
  "2012-02-14": null,
  "2012-02-19": "Global growth and recession",
  "2012-02-26": "Global growth and recession",
  "2012-03-22": "Government adoption",
  "2012-04-13": null,
  "2012-04-22": "Global growth and recession",
  "2012-04-29": "Global growth and recession",
  "2012-04-30": "Global growth and recession",
  "2012-05-03": "Global growth and recession",
  "2012-05-05": "Institutional Bitcoin & flows",
  "2012-05-17": "Politics and elections",
  "2012-05-20": "Global growth and recession",
  "2012-05-22": "Global growth and recession",
  "2012-06-19": "Government adoption",
  "2012-07-21": "ETFs and investment products",
  "2012-07-28": null,
  "2012-07-31": "Global growth and recession",
  "2012-08-14": "Global growth and recession",
  "2012-09-08": "Global growth and recession",
  "2012-09-09": "Government adoption",
  "2012-10-21": null,
  "2013-01-19": "ETFs and investment products",
  "2013-05-12": null,
  "2013-05-28": null,
  "2014-01-03": "Bitcoin price & cycles",
  "2014-04-13": null,
  "2014-09-14": "Bitcoin price & cycles",
  "2014-12-15": "Global growth and recession",
  "2015-02-06": "Global growth and recession",
  "2015-02-24": "Global growth and recession",
  "2015-08-17": "Global growth and recession",
  "2015-10-25": "Global growth and recession",
  "2015-12-03": "Global growth and recession",
  "2016-05-04": "Global growth and recession",
  "2016-07-08": null,
  "2016-08-01": "Bitcoin price & cycles",
  "2016-12-10": "Bitcoin price & cycles",
  "2020-02-26": "Bitcoin price & cycles",
  "2020-03-29": "Bitcoin price & cycles",
  "2020-07-01": null,
  "2021-01-01": null,
  "2021-05-16": null,
  "2018-07-12": null,
  "2023-04-02": null,
  "2023-04-18": "Global growth and recession",
  "2023-07-08": "Global growth and recession",
  "2010-03-27": null,
  "2010-10-28": "Global growth and recession",
  "2010-12-30": "ETFs and investment products",
  "2011-02-07": null,
  "2011-04-14": "Government adoption",
  "2011-11-24": null,
  "2012-06-04": "Global growth and recession",
  "2012-08-19": "Government adoption",
  "2013-03-01": "Global growth and recession",
  "2019-07-06": "Government adoption",
  "2019-11-27": "Bitcoin adoption",
  "2024-01-16": "Institutional Bitcoin & flows",
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

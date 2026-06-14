/**
 * Retag rows on Government adoption — Nation-state adoption, legal tender, strategic reserves, and public-sector BTC use.
 *
 * Usage:
 *   npx tsx server/scripts/retag-government-adoption.ts --dry-run
 *   npx tsx server/scripts/retag-government-adoption.ts --apply
 *   npx tsx server/scripts/retag-government-adoption.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Government adoption";

/** Editorial map for every row currently tagged Government adoption (138 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-04": null,
  "2009-02-16": "Global growth and recession",
  "2009-04-05": null,
  "2009-04-25": null,
  "2009-06-16": null,
  "2009-06-28": "Bailouts and stimulus",
  "2009-07-04": null,
  "2009-08-31": null,
  "2009-10-18": null,
  "2009-10-28": null,
  "2009-11-04": null,
  "2009-11-14": null,
  "2009-12-27": null,
  "2010-01-02": null,
  "2010-03-14": null,
  "2010-03-16": null,
  "2010-03-18": null,
  "2010-04-19": null,
  "2010-06-12": null,
  "2010-06-27": null,
  "2010-11-18": "Global growth and recession",
  "2010-12-02": null,
  "2010-12-11": null,
  "2011-03-24": null,
  "2011-04-14": "Global growth and recession",
  "2011-05-21": "Bitcoin adoption",
  "2011-07-16": null,
  "2011-07-29": null,
  "2011-08-12": null,
  "2011-09-11": null,
  "2011-09-18": null,
  "2011-09-27": null,
  "2011-11-13": null,
  "2011-11-23": null,
  "2011-11-25": null,
  "2012-03-22": null,
  "2012-04-04": "CBDCs",
  "2012-04-09": null,
  "2012-05-30": null,
  "2012-06-18": null,
  "2012-06-19": null,
  "2012-09-09": null,
  "2012-11-01": null,
  "2012-11-18": null,
  "2012-12-01": null,
  "2013-01-28": null,
  "2013-06-07": "Bitcoin regulation",
  "2013-10-05": null,
  "2014-01-15": "Bitcoin adoption",
  "2014-02-06": "Bitcoin regulation",
  "2014-04-20": "Bitcoin regulation",
  "2014-04-28": "Enforcement & crime",
  "2014-06-05": null,
  "2014-07-25": "CBDCs",
  "2014-07-26": "CBDCs",
  "2014-11-14": "Government adoption",
  "2014-12-26": null,
  "2015-01-08": "Bitcoin regulation",
  "2015-01-19": "Web3 industry and funding",
  "2015-02-11": "Government adoption",
  "2015-03-09": "Government adoption",
  "2015-03-16": "Enforcement & crime",
  "2015-03-20": "Bitcoin regulation",
  "2015-04-09": null,
  "2015-04-15": "Web3 industry and funding",
  "2015-04-26": null,
  "2015-05-16": "Smart contracts & L1s",
  "2015-12-15": "Government adoption",
  "2016-02-27": "Enforcement & crime",
  "2016-04-22": "Smart contracts & L1s",
  "2016-05-12": "Government adoption",
  "2016-05-13": "Enforcement & crime",
  "2016-07-10": "Smart contracts & L1s",
  "2016-08-17": null,
  "2016-10-12": "Bitcoin regulation",
  "2016-12-06": "Bitcoin regulation",
  "2016-12-16": "Bitcoin regulation",
  "2017-03-31": null,
  "2017-04-01": "Government adoption",
  "2017-06-16": "Enforcement & crime",
  "2017-09-10": "Government adoption",
  "2017-10-05": "CBDCs",
  "2017-10-06": "CBDCs",
  "2018-01-11": "Government adoption",
  "2018-02-20": "Government adoption",
  "2018-02-23": "Government adoption",
  "2018-02-28": "Government adoption",
  "2018-03-20": "Government adoption",
  "2018-05-19": null,
  "2018-11-05": "Government adoption",
  "2018-12-02": "Government adoption",
  "2019-02-22": null,
  "2019-07-06": "Global growth and recession",
  "2019-12-21": "Government adoption",
  "2020-01-28": "Bitcoin regulation",
  "2020-09-06": "Government adoption",
  "2021-02-01": null,
  "2021-03-12": "Government adoption",
  "2021-06-05": "Government adoption",
  "2021-06-25": "Government adoption",
  "2021-06-26": "Bitcoin adoption",
  "2021-08-01": null,
  "2021-09-01": "Government adoption",
  "2021-09-06": "Government adoption",
  "2021-09-16": "Government adoption",
  "2021-10-30": "Government adoption",
  "2021-11-03": "Government adoption",
  "2021-11-06": "Government adoption",
  "2021-11-09": "Enforcement & crime",
  "2022-01-15": "Government adoption",
  "2022-01-30": "Government adoption",
  "2022-02-11": "Bitcoin mining",
  "2022-03-01": "Web3 industry and funding",
  "2022-03-03": "Government adoption",
  "2022-03-17": "Government adoption",
  "2022-04-27": "Government adoption",
  "2022-04-29": "Government adoption",
  "2022-05-22": "Government adoption",
  "2022-07-03": "Government adoption",
  "2022-07-31": null,
  "2022-09-03": "Web3 industry and funding",
  "2022-09-07": "Government adoption",
  "2022-09-23": "Government adoption",
  "2022-09-28": "Web3 industry and funding",
  "2022-11-07": null,
  "2022-11-28": "Government adoption",
  "2023-02-13": "Government adoption",
  "2023-04-20": "Bitcoin regulation",
  "2023-12-08": "Government adoption",
  "2024-07-30": "Government adoption",
  "2024-08-07": "Bitcoin regulation",
  "2024-10-30": "Institutional Bitcoin & flows",
  "2024-12-09": "Government adoption",
  "2024-12-11": "Bitcoin mining",
  "2024-12-20": "Government adoption",
  "2024-12-22": "Government adoption",
  "2024-12-23": null,
  "2024-12-28": "Government adoption",
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

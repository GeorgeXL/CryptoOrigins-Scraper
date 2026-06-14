/**
 * Retag rows on Politics and elections — editorial map from main-events-leaf-prompts rules.
 *
 * Usage:
 *   npx tsx server/scripts/retag-politics-elections.ts --dry-run
 *   npx tsx server/scripts/retag-politics-elections.ts --apply
 *   npx tsx server/scripts/retag-politics-elections.ts --apply --from 2010-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Politics and elections";

/** Editorial map for every row currently tagged Politics and elections (158 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-17": "Politics and elections",
  "2009-01-22": "Politics and elections",
  "2009-02-05": "Politics and elections",
  "2009-02-23": "Politics and elections",
  "2009-03-21": "Politics and elections",
  "2009-04-07": "Politics and elections",
  "2009-04-09": "Politics and elections",
  "2009-05-14": "Politics and elections",
  "2009-06-10": "Politics and elections",
  "2009-06-20": "Politics and elections",
  "2009-07-06": "Politics and elections",
  "2009-07-07": "Politics and elections",
  "2009-07-10": "Politics and elections",
  "2009-07-17": "Politics and elections",
  "2009-08-02": "Politics and elections",
  "2009-09-13": "Politics and elections",
  "2009-09-17": "Politics and elections",
  "2009-10-02": "Politics and elections",
  "2009-10-03": "Politics and elections",
  "2009-11-03": "Politics and elections",
  "2009-11-07": "Politics and elections",
  "2009-11-26": "Politics and elections",
  "2009-11-29": "Politics and elections",
  "2009-12-08": "Politics and elections",
  "2009-12-19": "Politics and elections",
  "2010-02-06": "Politics and elections",
  "2010-02-07": "Politics and elections",
  "2010-02-16": "Politics and elections",
  "2010-02-17": "Politics and elections",
  "2010-02-19": "Politics and elections",
  "2010-02-20": "Politics and elections",
  "2010-02-27": "Politics and elections",
  "2010-03-07": "Politics and elections",
  "2010-03-13": "Politics and elections",
  "2010-03-14": "Politics and elections",
  "2010-03-15": "Politics and elections",
  "2010-03-21": "Politics and elections",
  "2010-03-28": "Labor market",
  "2010-04-03": "Politics and elections",
  "2010-04-06": "Politics and elections",
  "2010-04-08": "Politics and elections",
  "2010-04-11": "Politics and elections",
  "2010-04-25": "Politics and elections",
  "2010-04-29": "Politics and elections",
  "2010-05-23": "Politics and elections",
  "2010-06-24": "Politics and elections",
  "2010-07-05": "Politics and elections",
  "2010-07-07": "Politics and elections",
  "2010-08-01": "Politics and elections",
  "2010-08-02": "Politics and elections",
  "2010-08-12": "Politics and elections",
  "2010-09-11": "Politics and elections",
  "2010-09-12": "Politics and elections",
  "2010-09-23": "Politics and elections",
  "2010-10-27": "Politics and elections",
  "2010-11-07": "Politics and elections",
  "2010-11-14": "Politics and elections",
  "2010-11-17": "Politics and elections",
  "2010-12-04": "Politics and elections",
  "2011-01-13": "Politics and elections",
  "2011-02-05": "Politics and elections",
  "2011-02-19": "Politics and elections",
  "2011-03-01": "Politics and elections",
  "2011-03-02": "Politics and elections",
  "2011-03-08": "Politics and elections",
  "2011-03-11": "Politics and elections",
  "2011-03-12": "Politics and elections",
  "2011-03-13": "Politics and elections",
  "2011-03-20": "Politics and elections",
  "2011-03-26": "Politics and elections",
  "2011-04-02": "Politics and elections",
  "2011-04-25": "Politics and elections",
  "2011-05-03": "Politics and elections",
  "2011-05-07": "Politics and elections",
  "2011-05-08": "Politics and elections",
  "2011-05-17": "Politics and elections",
  "2011-07-23": "Politics and elections",
  "2011-08-23": "Politics and elections",
  "2011-10-16": "Politics and elections",
  "2011-11-13": "Politics and elections",
  "2011-11-19": "Politics and elections",
  "2011-12-17": "Politics and elections",
  "2012-01-08": "Politics and elections",
  "2012-02-23": "Politics and elections",
  "2012-04-28": "Politics and elections",
  "2012-05-17": "Politics and elections",
  "2012-06-18": "Politics and elections",
  "2012-06-21": "Politics and elections",
  "2012-06-29": "Politics and elections",
  "2012-06-30": "Politics and elections",
  "2012-08-05": "Politics and elections",
  "2012-08-20": "Politics and elections",
  "2012-10-11": "Politics and elections",
  "2012-10-25": "Politics and elections",
  "2012-11-04": "Politics and elections",
  "2012-11-09": "Politics and elections",
  "2012-11-14": "Politics and elections",
  "2012-11-25": "Politics and elections",
  "2012-12-02": "Politics and elections",
  "2012-12-08": "Politics and elections",
  "2012-12-21": "Politics and elections",
  "2012-12-28": "Politics and elections",
  "2012-12-30": "Politics and elections",
  "2013-01-01": "Politics and elections",
  "2013-01-11": "Politics and elections",
  "2013-01-16": "Politics and elections",
  "2013-01-25": null,
  "2013-01-28": "Government adoption",
  "2013-02-01": "Politics and elections",
  "2013-02-02": "ETFs and investment products",
  "2013-02-24": "Politics and elections",
  "2013-07-20": "Banking stress",
  "2013-09-22": "Enforcement & crime",
  "2013-09-30": "Politics and elections",
  "2013-10-05": "Politics and elections",
  "2013-10-27": "Politics and elections",
  "2013-11-12": "Bitcoin price & cycles",
  "2014-05-03": "Politics and elections",
  "2014-08-24": null,
  "2015-11-25": "Politics and elections",
  "2016-01-01": "Politics and elections",
  "2016-01-10": "Politics and elections",
  "2016-06-26": "Politics and elections",
  "2016-07-20": null,
  "2016-07-31": "Politics and elections",
  "2016-08-13": null,
  "2016-10-15": "Politics and elections",
  "2016-11-20": "Politics and elections",
  "2017-02-19": "Politics and elections",
  "2019-01-01": "Politics and elections",
  "2019-04-01": "Politics and elections",
  "2019-04-27": "Politics and elections",
  "2019-07-28": null,
  "2019-08-25": "Politics and elections",
  "2019-12-19": "Politics and elections",
  "2020-01-01": "Politics and elections",
  "2020-01-18": "Politics and elections",
  "2020-02-01": "Politics and elections",
  "2020-04-18": "Politics and elections",
  "2021-02-02": "Politics and elections",
  "2021-02-03": "Politics and elections",
  "2021-08-01": "Politics and elections",
  "2021-12-19": "Politics and elections",
  "2022-02-17": "Politics and elections",
  "2022-04-03": "Politics and elections",
  "2022-04-08": null,
  "2022-12-25": "Politics and elections",
  "2023-01-01": "Politics and elections",
  "2024-01-07": "Politics and elections",
  "2024-01-08": "Politics and elections",
  "2024-01-09": "Politics and elections",
  "2024-07-15": "Politics and elections",
  "2024-07-27": "Politics and elections",
  "2024-10-06": "Politics and elections",
  "2024-10-13": "Politics and elections",
  "2024-10-24": "Politics and elections",
  "2024-11-23": "Politics and elections",
  "2024-12-23": "Politics and elections",
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

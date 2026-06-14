/**
 * Retag rows on Enforcement & crime — Major prosecutions, seizures, mixer bans, and landmark fraud/Ponzi cases.
 *
 * Usage:
 *   npx tsx server/scripts/retag-enforcement-crime.ts --dry-run
 *   npx tsx server/scripts/retag-enforcement-crime.ts --apply
 *   npx tsx server/scripts/retag-enforcement-crime.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Enforcement & crime";

/** Editorial map for every row currently tagged Enforcement & crime. null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-03-12": "Enforcement & crime",
  "2009-08-01": null,
  "2009-09-02": null,
  "2009-09-21": null,
  "2009-10-29": "Securities regulation",
  "2010-03-07": null,
  "2010-08-07": null,
  "2010-08-31": null,
  "2010-09-09": null,
  "2010-12-06": null,
  "2010-12-22": null,
  "2010-12-26": null,
  "2011-05-09": "Wallets & self-custody",
  "2011-01-24": null,
  "2011-06-05": "Enforcement & crime",
  "2011-06-06": "Enforcement & crime",
  "2011-06-09": "Enforcement & crime",
  "2011-06-10": "Enforcement & crime",
  "2011-06-11": null,
  "2011-12-20": "Enforcement & crime",
  "2012-02-11": null,
  "2012-02-17": "Enforcement & crime",
  "2012-02-18": null,
  "2012-02-24": "Exchanges",
  "2012-03-01": "Exchanges",
  "2012-03-20": "Enforcement & crime",
  "2012-04-02": null,
  "2012-04-05": null,
  "2012-04-16": "Enforcement & crime",
  "2012-05-10": null,
  "2012-07-04": null,
  "2012-07-05": null,
  "2012-07-17": null,
  "2012-07-27": "Enforcement & crime",
  "2012-08-07": null,
  "2012-08-10": "Enforcement & crime",
  "2012-08-17": "Enforcement & crime",
  "2012-08-27": "Enforcement & crime",
  "2012-08-30": "Enforcement & crime",
  "2012-09-06": null,
  "2012-09-18": "Enforcement & crime",
  "2012-10-25": null,
  "2012-12-15": null,
  "2013-01-30": "Enforcement & crime",
  "2013-05-25": "Enforcement & crime",
  "2013-05-28": "Enforcement & crime",
  "2013-07-23": "Enforcement & crime",
  "2013-07-25": null,
  "2013-08-13": null,
  "2013-09-21": null,
  "2013-09-22": null,
  "2013-10-02": "Enforcement & crime",
  "2013-10-07": "Wallets & self-custody",
  "2013-10-08": "Wallets & self-custody",
  "2013-10-09": "Enforcement & crime",
  "2013-10-11": "Enforcement & crime",
  "2013-10-25": "Enforcement & crime",
  "2013-11-08": "Wallets & self-custody",
  "2013-11-09": "Wallets & self-custody",
  "2014-01-07": null,
  "2014-01-18": "Enforcement & crime",
  "2014-01-27": "Enforcement & crime",
  "2014-04-14": "Enforcement & crime",
  "2014-04-28": "Enforcement & crime",
  "2014-05-23": null,
  "2014-06-01": "Enforcement & crime",
  "2014-06-13": "Enforcement & crime",
  "2014-06-27": "Enforcement & crime",
  "2014-09-06": "Enforcement & crime",
  "2014-10-12": "Enforcement & crime",
  "2014-10-16": "Enforcement & crime",
  "2014-10-24": "Legal cases",
  "2014-11-06": "Enforcement & crime",
  "2014-11-17": "Enforcement & crime",
  "2014-12-07": "Enforcement & crime",
  "2014-12-20": "Enforcement & crime",
  "2015-01-04": null,
  "2015-02-09": "Enforcement & crime",
  "2015-02-18": "Enforcement & crime",
  "2015-03-04": "Enforcement & crime",
  "2015-03-06": "Enforcement & crime",
  "2015-03-16": "Enforcement & crime",
  "2015-03-28": null,
  "2015-03-30": "Enforcement & crime",
  "2015-04-01": "Enforcement & crime",
  "2015-06-09": "Enforcement & crime",
  "2015-08-24": "Enforcement & crime",
  "2015-09-13": null,
  "2015-09-16": "Enforcement & crime",
  "2015-11-01": "Enforcement & crime",
  "2015-11-11": null,
  "2015-11-15": null,
  "2015-05-29": "Enforcement & crime",
  "2016-01-12": "Enforcement & crime",
  "2016-01-20": "Enforcement & crime",
  "2016-02-27": "Government adoption",
  "2016-04-22": "Government adoption",
  "2016-05-13": "Enforcement & crime",
  "2016-05-21": null,
  "2016-05-31": "Enforcement & crime",
  "2016-07-10": "Government adoption",
  "2016-07-22": "Enforcement & crime",
  "2016-08-09": "Enforcement & crime",
  "2016-08-16": "Enforcement & crime",
  "2016-10-26": null,
  "2017-01-15": null,
  "2017-02-27": null,
  "2017-03-15": "Enforcement & crime",
  "2017-05-18": null,
  "2017-06-16": "Enforcement & crime",
  "2017-07-26": "Enforcement & crime",
  "2017-08-03": null,
  "2017-08-23": null,
  "2017-10-25": "Enforcement & crime",
  "2017-12-30": "Enforcement & crime",
  "2018-02-07": null,
  "2018-05-11": "Enforcement & crime",
  "2018-06-17": null,
  "2018-07-14": "Enforcement & crime",
  "2019-03-17": "Enforcement & crime",
  "2019-10-17": "Enforcement & crime",
  "2019-11-21": "Enforcement & crime",
  "2019-11-30": "Sanctions and enforcement",
  "2020-02-13": "Enforcement & crime",
  "2020-06-06": null,
  "2020-07-15": null,
  "2020-07-18": null,
  "2020-08-07": "Smart contracts & L1s",
  "2020-08-29": "Enforcement & crime",
  "2021-09-03": "Enforcement & crime",
  "2021-11-09": "Enforcement & crime",
  "2022-02-08": "Enforcement & crime",
  "2022-02-25": "Enforcement & crime",
  "2022-08-10": "Enforcement & crime",
  "2022-09-27": "Enforcement & crime",
  "2022-12-12": "Enforcement & crime",
  "2023-01-04": null,
  "2023-01-26": "Enforcement & crime",
  "2023-02-02": "Institutional Bitcoin & flows",
  "2023-02-26": "Enforcement & crime",
  "2023-04-07": "Enforcement & crime",
  "2023-04-15": "Enforcement & crime",
  "2023-04-18": "Enforcement & crime",
  "2023-09-12": "Enforcement & crime",
  "2024-01-08": "Enforcement & crime",
  "2024-01-14": null,
  "2024-01-25": "Enforcement & crime",
  "2024-02-01": "Enforcement & crime",
  "2024-03-28": "Enforcement & crime",
  "2024-04-24": "Enforcement & crime",
  "2024-05-14": "Enforcement & crime",
  "2024-09-05": "Enforcement & crime",
  "2024-10-05": null,
  "2024-12-03": "Enforcement & crime",
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

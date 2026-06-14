/**
 * Retag rows on Protocol & upgrades — keep Core releases, BIPs, forks, governance.
 *
 * Usage:
 *   npx tsx server/scripts/retag-protocol-upgrades.ts --dry-run
 *   npx tsx server/scripts/retag-protocol-upgrades.ts --apply
 *   npx tsx server/scripts/retag-protocol-upgrades.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Protocol & upgrades";

/** Editorial map for every row currently tagged Protocol & upgrades. null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-01-11": "Protocol & upgrades",
  "2009-02-04": "Protocol & upgrades",
  "2009-07-03": "Protocol & upgrades",
  "2009-10-25": "Protocol & upgrades",
  "2009-12-16": "Protocol & upgrades",
  "2010-02-23": "Protocol & upgrades",
  "2010-03-01": "Smart contracts & L1s",
  "2010-06-21": "Protocol & upgrades",
  "2010-06-22": "Protocol & upgrades",
  "2010-07-06": "Protocol & upgrades",
  "2010-07-07": "Protocol & upgrades",
  "2010-07-09": "Protocol & upgrades",
  "2010-07-15": "Protocol & upgrades",
  "2010-07-20": null,
  "2010-07-23": "Protocol & upgrades",
  "2010-07-24": "Protocol & upgrades",
  "2010-07-27": "Protocol & upgrades",
  "2010-08-13": "Protocol & upgrades",
  "2010-08-15": "Protocol & upgrades",
  "2010-08-22": "Protocol & upgrades",
  "2010-08-27": "Protocol & upgrades",
  "2010-08-28": "Protocol & upgrades",
  "2010-09-10": "Protocol & upgrades",
  "2010-09-19": "Protocol & upgrades",
  "2010-09-29": "Protocol & upgrades",
  "2010-11-25": "Protocol & upgrades",
  "2010-12-08": "Protocol & upgrades",
  "2010-12-23": null,
  "2011-01-12": "Protocol & upgrades",
  "2011-01-21": "Protocol & upgrades",
  "2011-03-07": "Protocol & upgrades",
  "2011-03-29": null,
  "2011-05-22": "Protocol & upgrades",
  "2011-05-29": "Protocol & upgrades",
  "2011-06-14": "Protocol & upgrades",
  "2011-06-30": "Protocol & upgrades",
  "2011-07-02": "Protocol & upgrades",
  "2011-07-08": null,
  "2011-07-19": "Protocol & upgrades",
  "2011-07-24": "Protocol & upgrades",
  "2011-07-27": "Protocol & upgrades",
  "2011-09-01": null,
  "2011-09-03": null,
  "2011-09-12": null,
  "2011-09-23": "Protocol & upgrades",
  "2011-10-02": "Protocol & upgrades",
  "2011-10-05": "Protocol & upgrades",
  "2011-10-12": "Protocol & upgrades",
  "2011-11-15": "Protocol & upgrades",
  "2011-11-29": null,
  "2011-12-02": "Protocol & upgrades",
  "2012-01-13": "Protocol & upgrades",
  "2012-01-28": "Protocol & upgrades",
  "2012-02-01": "Protocol & upgrades",
  "2012-02-10": "Protocol & upgrades",
  "2012-02-20": "Protocol & upgrades",
  "2012-03-16": "Protocol & upgrades",
  "2012-03-30": "Protocol & upgrades",
  "2012-03-31": null,
  "2012-04-01": "Protocol & upgrades",
  "2012-04-12": "Protocol & upgrades",
  "2012-05-04": "Protocol & upgrades",
  "2012-05-24": "Protocol & upgrades",
  "2012-06-09": "Protocol & upgrades",
  "2012-06-17": "Protocol & upgrades",
  "2012-06-20": "Protocol & upgrades",
  "2012-06-25": "Protocol & upgrades",
  "2012-08-01": "Protocol & upgrades",
  "2012-08-24": "Protocol & upgrades",
  "2012-09-17": "Protocol & upgrades",
  "2012-09-22": "Protocol & upgrades",
  "2012-09-23": "Protocol & upgrades",
  "2012-10-02": "Protocol & upgrades",
  "2012-10-08": "Protocol & upgrades",
  "2012-10-12": null,
  "2012-10-19": "Protocol & upgrades",
  "2012-10-20": "Protocol & upgrades",
  "2012-10-24": "Protocol & upgrades",
  "2012-11-29": "Protocol & upgrades",
  "2012-12-14": "Protocol & upgrades",
  "2012-12-17": "Protocol & upgrades",
  "2012-12-22": "Protocol & upgrades",
  "2012-12-23": "Protocol & upgrades",
  "2013-01-27": "Protocol & upgrades",
  "2013-02-09": "Protocol & upgrades",
  "2013-02-11": "Protocol & upgrades",
  "2013-02-19": "Protocol & upgrades",
  "2013-03-11": "Protocol & upgrades",
  "2013-03-17": "Protocol & upgrades",
  "2013-03-19": "Protocol & upgrades",
  "2013-03-24": "Protocol & upgrades",
  "2013-05-03": "Protocol & upgrades",
  "2013-05-11": "Protocol & upgrades",
  "2013-06-10": "Protocol & upgrades",
  "2013-06-11": "Protocol & upgrades",
  "2013-06-25": "Protocol & upgrades",
  "2013-08-18": "Protocol & upgrades",
  "2013-09-03": "Protocol & upgrades",
  "2013-09-11": "Protocol & upgrades",
  "2013-09-27": "Protocol & upgrades",
  "2013-10-06": "Protocol & upgrades",
  "2013-11-05": "Protocol & upgrades",
  "2013-12-09": "Protocol & upgrades",
  "2014-03-19": "Protocol & upgrades",
  "2014-04-08": "Protocol & upgrades",
  "2014-04-11": "Protocol & upgrades",
  "2014-04-12": "Protocol & upgrades",
  "2014-04-19": "Protocol & upgrades",
  "2014-06-08": "Protocol & upgrades",
  "2014-06-16": "Protocol & upgrades",
  "2014-07-07": "Protocol & upgrades",
  "2014-07-14": "Protocol & upgrades",
  "2014-08-08": "Smart contracts & L1s",
  "2014-08-29": "Protocol & upgrades",
  "2014-09-27": "Protocol & upgrades",
  "2014-10-05": "Protocol & upgrades",
  "2014-10-10": "Protocol & upgrades",
  "2014-11-19": "Protocol & upgrades",
  "2014-11-29": null,
  "2014-11-30": "Protocol & upgrades",
  "2014-12-13": "Protocol & upgrades",
  "2014-12-28": "Protocol & upgrades",
  "2015-01-10": "Protocol & upgrades",
  "2015-03-02": "Protocol & upgrades",
  "2015-03-27": "Exchanges",
  "2015-04-07": "Exchanges",
  "2015-04-23": "Protocol & upgrades",
  "2015-04-27": "Protocol & upgrades",
  "2015-05-06": "Protocol & upgrades",
  "2015-05-08": "Protocol & upgrades",
  "2015-05-14": "Protocol & upgrades",
  "2015-05-30": "Protocol & upgrades",
  "2015-06-20": "Protocol & upgrades",
  "2015-06-21": "Protocol & upgrades",
  "2015-06-27": "Protocol & upgrades",
  "2015-07-05": "Protocol & upgrades",
  "2015-07-06": "Protocol & upgrades",
  "2015-07-09": "Protocol & upgrades",
  "2015-07-10": "Protocol & upgrades",
  "2015-07-25": "Protocol & upgrades",
  "2015-08-15": "Protocol & upgrades",
  "2015-08-20": "Protocol & upgrades",
  "2015-08-23": "Protocol & upgrades",
  "2015-08-27": "Protocol & upgrades",
  "2015-08-29": "Protocol & upgrades",
  "2015-09-01": "Protocol & upgrades",
  "2015-09-09": "Protocol & upgrades",
  "2015-09-10": "Protocol & upgrades",
  "2015-09-21": "Bitcoin mining",
  "2015-09-27": "Protocol & upgrades",
  "2015-10-02": null,
  "2015-10-04": "Protocol & upgrades",
  "2015-10-08": "Protocol & upgrades",
  "2015-10-14": "Protocol & upgrades",
  "2015-10-15": "Protocol & upgrades",
  "2015-11-07": "Protocol & upgrades",
  "2015-11-12": "Protocol & upgrades",
  "2015-11-13": "Protocol & upgrades",
  "2015-11-18": "Protocol & upgrades",
  "2015-11-20": "Bitcoin mining",
  "2015-11-21": "Protocol & upgrades",
  "2015-11-28": "Bitcoin mining",
  "2015-12-05": "Protocol & upgrades",
  "2015-12-21": "Protocol & upgrades",
  "2015-12-23": "Protocol & upgrades",
  "2015-12-25": "Protocol & upgrades",
  "2015-12-30": null,
  "2015-12-31": "Protocol & upgrades",
  "2016-01-07": "Protocol & upgrades",
  "2016-01-14": "Protocol & upgrades",
  "2016-01-16": "Protocol & upgrades",
  "2016-01-17": "Protocol & upgrades",
  "2016-01-21": "Protocol & upgrades",
  "2016-01-24": null,
  "2016-02-05": "Protocol & upgrades",
  "2016-02-06": "Protocol & upgrades",
  "2016-02-10": "Protocol & upgrades",
  "2016-02-11": "Protocol & upgrades",
  "2016-02-12": "Protocol & upgrades",
  "2016-02-16": "Bitcoin mining",
  "2016-02-17": "Protocol & upgrades",
  "2016-02-22": null,
  "2016-02-23": "Protocol & upgrades",
  "2016-03-02": "Protocol & upgrades",
  "2016-03-05": "Protocol & upgrades",
  "2016-03-06": "Protocol & upgrades",
  "2016-03-15": "Protocol & upgrades",
  "2016-03-20": "Protocol & upgrades",
  "2016-03-26": null,
  "2016-03-27": "Protocol & upgrades",
  "2016-04-14": "Protocol & upgrades",
  "2016-04-15": "Protocol & upgrades",
  "2016-05-20": "Protocol & upgrades",
  "2016-05-25": "Protocol & upgrades",
  "2016-07-12": null,
  "2016-07-18": "Protocol & upgrades",
  "2016-08-14": "Protocol & upgrades",
  "2016-08-23": "Protocol & upgrades",
  "2016-08-27": "Protocol & upgrades",
  "2016-09-06": "Protocol & upgrades",
  "2016-09-15": "Protocol & upgrades",
  "2016-10-16": "Wallets & self-custody",
  "2016-10-17": "Protocol & upgrades",
  "2016-10-27": "Protocol & upgrades",
  "2016-10-30": "Protocol & upgrades",
  "2016-11-02": "Protocol & upgrades",
  "2016-11-18": "Protocol & upgrades",
  "2016-11-19": "Protocol & upgrades",
  "2016-12-05": "Protocol & upgrades",
  "2016-12-08": "Protocol & upgrades",
  "2016-12-15": "Protocol & upgrades",
  "2017-01-03": "Protocol & upgrades",
  "2017-01-08": "Protocol & upgrades",
  "2017-02-03": "Protocol & upgrades",
  "2017-02-09": "Protocol & upgrades",
  "2017-02-20": null,
  "2017-02-23": "Protocol & upgrades",
  "2017-02-25": "Protocol & upgrades",
  "2017-03-04": "Protocol & upgrades",
  "2017-03-08": "Protocol & upgrades",
  "2017-03-09": "Protocol & upgrades",
  "2017-03-12": "Protocol & upgrades",
  "2017-03-13": "Protocol & upgrades",
  "2017-03-14": "Protocol & upgrades",
  "2017-03-16": "Protocol & upgrades",
  "2017-03-21": "Exchanges",
  "2017-03-26": "Protocol & upgrades",
  "2017-03-27": "Protocol & upgrades",
  "2017-03-28": "Protocol & upgrades",
  "2017-03-30": "Protocol & upgrades",
  "2017-04-15": "Protocol & upgrades",
  "2017-04-21": "Smart contracts & L1s",
  "2017-04-22": "Protocol & upgrades",
  "2017-04-23": "Protocol & upgrades",
  "2017-04-25": "Protocol & upgrades",
  "2017-05-08": "Protocol & upgrades",
  "2017-05-21": "Protocol & upgrades",
  "2017-05-23": "Protocol & upgrades",
  "2017-06-08": "Protocol & upgrades",
  "2017-06-15": "Protocol & upgrades",
  "2017-06-17": "Protocol & upgrades",
  "2017-06-30": "Protocol & upgrades",
  "2017-07-11": "Protocol & upgrades",
  "2017-07-18": "Protocol & upgrades",
  "2017-07-19": "Exchanges",
  "2017-07-21": "Protocol & upgrades",
  "2017-07-22": "Protocol & upgrades",
  "2017-07-23": "Protocol & upgrades",
  "2017-07-24": "Protocol & upgrades",
  "2017-07-30": "Bitcoin price & cycles",
  "2017-08-01": "Protocol & upgrades",
  "2017-08-05": "Bitcoin price & cycles",
  "2017-08-09": "Protocol & upgrades",
  "2017-08-16": "Protocol & upgrades",
  "2017-08-17": "Protocol & upgrades",
  "2017-08-19": "Bitcoin price & cycles",
  "2017-08-21": "Protocol & upgrades",
  "2017-08-24": "Protocol & upgrades",
  "2017-08-29": "Protocol & upgrades",
  "2017-08-31": "Protocol & upgrades",
  "2017-09-03": "Protocol & upgrades",
  "2017-09-20": "Protocol & upgrades",
  "2017-09-22": "Protocol & upgrades",
  "2017-10-08": "Protocol & upgrades",
  "2017-10-11": "Protocol & upgrades",
  "2017-10-12": "Protocol & upgrades",
  "2017-10-14": "Bitcoin price & cycles",
  "2017-10-19": "Protocol & upgrades",
  "2017-10-23": "Protocol & upgrades",
  "2017-10-27": "Protocol & upgrades",
  "2017-10-28": "Protocol & upgrades",
  "2017-11-04": "Protocol & upgrades",
  "2017-11-08": "Protocol & upgrades",
  "2017-11-11": "Protocol & upgrades",
  "2017-11-12": "Protocol & upgrades",
  "2017-11-13": "Protocol & upgrades",
  "2017-11-14": "Protocol & upgrades",
  "2017-11-20": "Protocol & upgrades",
  "2017-11-24": "Protocol & upgrades",
  "2018-01-18": "Protocol & upgrades",
  "2018-01-23": "Protocol & upgrades",
  "2018-01-28": "Bitcoin adoption",
  "2018-02-09": "Protocol & upgrades",
  "2018-02-26": "Protocol & upgrades",
  "2018-03-02": "Protocol & upgrades",
  "2018-03-03": "Protocol & upgrades",
  "2018-04-11": "Protocol & upgrades",
  "2018-04-15": "Protocol & upgrades",
  "2018-04-21": "Bitcoin mining",
  "2018-04-23": "Protocol & upgrades",
  "2018-05-04": "Protocol & upgrades",
  "2018-05-15": "Protocol & upgrades",
  "2018-05-22": "Protocol & upgrades",
  "2018-05-25": "Wallets & self-custody",
  "2018-06-07": "Protocol & upgrades",
  "2018-06-25": "Protocol & upgrades",
  "2018-07-03": "Protocol & upgrades",
  "2018-07-06": "Protocol & upgrades",
  "2018-07-16": "Protocol & upgrades",
  "2018-07-29": "Protocol & upgrades",
  "2018-08-21": "Protocol & upgrades",
  "2018-08-22": "Protocol & upgrades",
  "2018-09-06": "Protocol & upgrades",
  "2018-09-18": "Protocol & upgrades",
  "2018-09-21": "Smart contracts & L1s",
  "2018-09-22": "Protocol & upgrades",
  "2018-09-25": "Protocol & upgrades",
  "2018-09-28": "Protocol & upgrades",
  "2018-10-03": "Protocol & upgrades",
  "2018-10-04": "Protocol & upgrades",
  "2018-10-07": "Protocol & upgrades",
  "2018-11-04": "Protocol & upgrades",
  "2018-11-11": "Protocol & upgrades",
  "2018-11-12": "Protocol & upgrades",
  "2018-11-15": "Protocol & upgrades",
  "2018-11-23": "Bitcoin price & cycles",
  "2018-12-13": "Protocol & upgrades",
  "2018-12-14": "Protocol & upgrades",
  "2018-12-17": "Protocol & upgrades",
  "2018-12-25": "Protocol & upgrades",
  "2019-01-13": "Protocol & upgrades",
  "2019-01-27": "Protocol & upgrades",
  "2019-02-16": "Protocol & upgrades",
  "2019-03-12": "Protocol & upgrades",
  "2019-04-19": "Smart contracts & L1s",
  "2019-05-02": "Protocol & upgrades",
  "2019-05-06": "Protocol & upgrades",
  "2019-06-17": "Protocol & upgrades",
  "2019-07-15": "Protocol & upgrades",
  "2019-07-18": "Protocol & upgrades",
  "2019-08-20": "Protocol & upgrades",
  "2019-08-29": "Protocol & upgrades",
  "2019-09-04": "Protocol & upgrades",
  "2019-11-17": "Protocol & upgrades",
  "2019-11-25": "Protocol & upgrades",
  "2019-12-03": "Protocol & upgrades",
  "2019-12-17": "Exchanges",
  "2020-01-16": "Protocol & upgrades",
  "2020-01-23": "Protocol & upgrades",
  "2020-01-27": "Protocol & upgrades",
  "2020-01-29": "Protocol & upgrades",
  "2020-02-24": "Protocol & upgrades",
  "2020-03-09": "Protocol & upgrades",
  "2020-03-20": "Protocol & upgrades",
  "2020-03-21": "Protocol & upgrades",
  "2020-04-01": "Protocol & upgrades",
  "2020-05-16": "Bitcoin mining",
  "2020-05-19": "Bitcoin mining",
  "2020-06-03": "Protocol & upgrades",
  "2020-06-11": "Protocol & upgrades",
  "2020-08-01": "Protocol & upgrades",
  "2020-08-03": "Protocol & upgrades",
  "2020-08-24": "Protocol & upgrades",
  "2020-09-23": "Protocol & upgrades",
  "2020-10-30": "Protocol & upgrades",
  "2020-11-14": "Protocol & upgrades",
  "2020-11-15": "Protocol & upgrades",
  "2021-01-11": "Bitcoin price & cycles",
  "2021-01-13": "Protocol & upgrades",
  "2021-01-14": "Protocol & upgrades",
  "2021-01-21": "Protocol & upgrades",
  "2021-01-23": "Protocol & upgrades",
  "2021-02-05": "Protocol & upgrades",
  "2021-02-10": "Protocol & upgrades",
  "2021-02-24": "Protocol & upgrades",
  "2021-02-28": "Protocol & upgrades",
  "2021-03-09": "Protocol & upgrades",
  "2021-04-08": "Bitcoin mining",
  "2021-05-07": "Protocol & upgrades",
  "2021-05-17": "Protocol & upgrades",
  "2021-05-31": "Protocol & upgrades",
  "2021-06-12": "Protocol & upgrades",
  "2021-06-13": "Protocol & upgrades",
  "2021-06-17": "Protocol & upgrades",
  "2021-06-30": "Protocol & upgrades",
  "2021-07-15": "Protocol & upgrades",
  "2021-08-04": "Protocol & upgrades",
  "2021-08-16": "Protocol & upgrades",
  "2021-09-13": "Protocol & upgrades",
  "2021-09-27": "Bitcoin price & cycles",
  "2021-10-23": null,
  "2021-11-07": "Protocol & upgrades",
  "2021-11-14": "Protocol & upgrades",
  "2021-11-27": "Protocol & upgrades",
  "2021-12-11": "Protocol & upgrades",
  "2021-12-22": "Protocol & upgrades",
  "2022-02-16": "Protocol & upgrades",
  "2022-04-22": "Protocol & upgrades",
  "2022-04-25": "Protocol & upgrades",
  "2022-05-04": null,
  "2022-05-20": "Scaling and Layer 2",
  "2022-08-17": "Protocol & upgrades",
  "2022-10-05": "Protocol & upgrades",
  "2022-11-27": "Protocol & upgrades",
  "2022-12-07": "Protocol & upgrades",
  "2023-01-18": "Protocol & upgrades",
  "2023-01-21": "Protocol & upgrades",
  "2023-02-23": "Protocol & upgrades",
  "2023-03-16": "Protocol & upgrades",
  "2023-05-08": "Protocol & upgrades",
  "2023-05-15": "Protocol & upgrades",
  "2023-05-25": "Protocol & upgrades",
  "2023-10-22": "Protocol & upgrades",
  "2023-11-03": "Protocol & upgrades",
  "2023-11-17": "Protocol & upgrades",
  "2023-12-06": "Protocol & upgrades",
  "2023-12-18": "Protocol & upgrades",
  "2024-03-27": "Protocol & upgrades",
  "2024-03-31": null,
  "2024-04-12": "Smart contracts & L1s",
  "2024-04-16": "Protocol & upgrades",
  "2024-04-21": "Protocol & upgrades",
  "2024-04-27": "Protocol & upgrades",
  "2024-05-05": "Protocol & upgrades",
  "2024-05-19": "Protocol & upgrades",
  "2024-07-17": "Protocol & upgrades",
  "2024-09-06": "Protocol & upgrades",
  "2024-10-02": "Protocol & upgrades",
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

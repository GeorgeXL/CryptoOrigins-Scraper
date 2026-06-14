/**
 * Retag rows on Wallets & self-custody — keep user wallet products, hardware wallets, CoinJoin, self-custody tools.
 *
 * Usage:
 *   npx tsx server/scripts/retag-wallets-self-custody.ts --dry-run
 *   npx tsx server/scripts/retag-wallets-self-custody.ts --apply
 *   npx tsx server/scripts/retag-wallets-self-custody.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "Wallets & self-custody";

/** Editorial map for every row currently tagged Wallets & self-custody (144 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-06-11": "Wallets & self-custody",
  "2009-12-28": null,
  "2010-03-05": "Smart contracts & L1s",
  "2010-08-21": null,
  "2010-09-01": null,
  "2010-12-07": "Wallets & self-custody",
  "2011-01-05": null,
  "2011-02-13": null,
  "2011-05-09": "Enforcement & crime",
  "2011-05-30": null,
  "2011-06-13": null,
  "2011-06-15": null,
  "2011-06-17": null,
  "2011-07-06": "Wallets & self-custody",
  "2011-07-11": "Exchanges",
  "2011-07-22": "Wallets & self-custody",
  "2011-07-30": null,
  "2011-11-05": "Wallets & self-custody",
  "2011-11-21": "Wallets & self-custody",
  "2011-12-02": "Protocol & upgrades",
  "2012-01-31": null,
  "2012-02-12": "Exchanges",
  "2012-03-04": "Wallets & self-custody",
  "2012-03-21": null,
  "2012-06-08": "Wallets & self-custody",
  "2012-08-18": "Wallets & self-custody",
  "2012-08-23": null,
  "2012-11-17": null,
  "2012-12-03": "Bitcoin adoption",
  "2012-12-18": "Exchanges",
  "2013-02-20": null,
  "2013-05-06": "Wallets & self-custody",
  "2013-06-14": "Wallets & self-custody",
  "2013-07-17": "Wallets & self-custody",
  "2013-08-14": "Wallets & self-custody",
  "2013-08-20": "Wallets & self-custody",
  "2013-08-30": "Wallets & self-custody",
  "2013-09-25": "Wallets & self-custody",
  "2013-10-07": "Enforcement & crime",
  "2013-10-08": "Enforcement & crime",
  "2013-10-19": "Wallets & self-custody",
  "2013-11-08": "Enforcement & crime",
  "2013-11-09": "Enforcement & crime",
  "2013-11-23": null,
  "2013-12-25": null,
  "2014-03-18": null,
  "2014-07-08": null,
  "2014-07-14": "Protocol & upgrades",
  "2014-07-28": "Wallets & self-custody",
  "2014-07-29": "Wallets & self-custody",
  "2014-08-15": null,
  "2014-09-13": "Wallets & self-custody",
  "2014-10-01": "Wallets & self-custody",
  "2014-10-21": null,
  "2014-11-30": "Protocol & upgrades",
  "2014-12-14": "Wallets & self-custody",
  "2014-12-29": "Wallets & self-custody",
  "2015-01-12": "Institutional Bitcoin & flows",
  "2015-02-14": "Bitcoin regulation",
  "2015-02-23": "Wallets & self-custody",
  "2015-03-25": "Wallets & self-custody",
  "2015-05-22": "Exchanges",
  "2015-06-01": "Wallets & self-custody",
  "2015-06-03": "Exchanges",
  "2015-06-07": "Wallets & self-custody",
  "2015-07-11": null,
  "2015-08-13": "Wallets & self-custody",
  "2015-09-04": null,
  "2015-11-10": "Exchanges",
  "2015-11-14": "Wallets & self-custody",
  "2015-12-19": "Wallets & self-custody",
  "2016-01-04": "Wallets & self-custody",
  "2016-01-10": "Wallets & self-custody",
  "2016-02-08": null,
  "2016-02-28": "Wallets & self-custody",
  "2016-07-19": null,
  "2016-08-18": "Wallets & self-custody",
  "2016-08-25": null,
  "2016-10-10": null,
  "2016-10-14": null,
  "2016-10-16": "Protocol & upgrades",
  "2016-10-17": "Protocol & upgrades",
  "2016-10-24": "Wallets & self-custody",
  "2016-10-25": "Wallets & self-custody",
  "2016-12-24": "Bitcoin adoption",
  "2017-01-26": "Institutional Bitcoin & flows",
  "2017-02-02": "Wallets & self-custody",
  "2017-05-13": null,
  "2017-05-29": null,
  "2017-06-22": "Institutional Bitcoin & flows",
  "2017-07-07": null,
  "2017-07-27": "Wallets & self-custody",
  "2017-08-22": "Wallets & self-custody",
  "2017-09-16": null,
  "2017-09-22": "Protocol & upgrades",
  "2017-12-08": "Wallets & self-custody",
  "2018-01-18": "Protocol & upgrades",
  "2018-01-31": null,
  "2018-02-12": "Wallets & self-custody",
  "2018-03-10": "Wallets & self-custody",
  "2018-06-28": null,
  "2018-09-08": "Smart contracts & L1s",
  "2018-09-15": "Institutional Bitcoin & flows",
  "2018-10-10": "Wallets & self-custody",
  "2018-10-31": "Wallets & self-custody",
  "2018-11-20": "Smart contracts & L1s",
  "2018-12-27": "Wallets & self-custody",
  "2019-01-05": "Wallets & self-custody",
  "2019-02-06": "Wallets & self-custody",
  "2019-02-26": "Institutional Bitcoin & flows",
  "2019-03-20": "Wallets & self-custody",
  "2019-03-25": "Smart contracts & L1s",
  "2019-04-26": null,
  "2019-05-11": "Wallets & self-custody",
  "2019-06-30": null,
  "2019-07-31": "Institutional Bitcoin & flows",
  "2019-08-13": "Wallets & self-custody",
  "2019-09-15": "Wallets & self-custody",
  "2019-10-19": "Wallets & self-custody",
  "2019-10-20": "Wallets & self-custody",
  "2019-10-21": "Wallets & self-custody",
  "2019-12-01": "Wallets & self-custody",
  "2019-12-31": null,
  "2020-05-14": null,
  "2020-06-11": "Protocol & upgrades",
  "2020-07-09": null,
  "2020-07-10": "Wallets & self-custody",
  "2020-09-03": "Smart contracts & L1s",
  "2020-10-19": "Exchanges",
  "2021-02-11": "Institutional Bitcoin & flows",
  "2022-02-16": "Protocol & upgrades",
  "2022-03-07": null,
  "2022-05-18": "Wallets & self-custody",
  "2022-07-12": null,
  "2023-01-02": null,
  "2023-02-02": "Enforcement & crime",
  "2023-04-28": "Wallets & self-custody",
  "2023-10-12": "Wallets & self-custody",
  "2023-10-24": "Wallets & self-custody",
  "2023-11-25": "Wallets & self-custody",
  "2023-12-14": "Wallets & self-custody",
  "2024-01-08": "Enforcement & crime",
  "2024-04-24": "Enforcement & crime",
  "2024-11-30": "Wallets & self-custody",
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

/**
 * Retag rows on ETFs and investment products — keep GBTC, spot/futures ETF approvals, trusts, and listed BTC investment products.
 *
 * Usage:
 *   npx tsx server/scripts/retag-etfs-investment-products.ts --dry-run
 *   npx tsx server/scripts/retag-etfs-investment-products.ts --apply
 *   npx tsx server/scripts/retag-etfs-investment-products.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "ETFs and investment products";

/** Editorial map for every row currently tagged ETFs and investment products (163 rows). null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-02-19": null,
  "2009-06-24": "Bitcoin regulation",
  "2009-08-13": null,
  "2009-11-27": null,
  "2009-12-10": null,
  "2010-01-26": null,
  "2010-02-13": null,
  "2010-03-02": null,
  "2010-03-09": null,
  "2010-05-31": null,
  "2010-08-04": null,
  "2010-08-09": null,
  "2010-09-15": null,
  "2010-09-22": null,
  "2010-10-18": null,
  "2010-12-30": null,
  "2011-02-12": null,
  "2011-05-13": null,
  "2011-06-27": null,
  "2011-11-02": null,
  "2011-11-03": null,
  "2011-11-12": null,
  "2011-12-15": "Bitcoin adoption",
  "2012-01-18": null,
  "2012-02-08": "Debt crises",
  "2012-02-29": null,
  "2012-04-25": null,
  "2012-07-21": null,
  "2012-10-11": null,
  "2013-02-14": null,
  "2013-07-01": "ETFs and investment products",
  "2013-07-02": "ETFs and investment products",
  "2013-07-03": "ETFs and investment products",
  "2013-10-20": null,
  "2013-10-23": "Exchanges",
  "2014-02-02": "Bitcoin price & cycles",
  "2014-05-08": "ETFs and investment products",
  "2014-09-11": "Bitcoin adoption",
  "2014-11-09": "ETFs and investment products",
  "2015-01-30": "Bitcoin regulation",
  "2015-03-07": "ETFs and investment products",
  "2015-04-03": "Bitcoin adoption",
  "2015-05-07": null,
  "2015-05-13": "Bitcoin mining",
  "2015-05-18": "ETFs and investment products",
  "2015-05-19": null,
  "2015-10-30": "ETFs and investment products",
  "2016-06-29": "ETFs and investment products",
  "2016-07-04": "ETFs and investment products",
  "2016-07-13": "ETFs and investment products",
  "2016-09-13": "ETFs and investment products",
  "2016-10-13": "ETFs and investment products",
  "2017-02-24": "ETFs and investment products",
  "2017-03-06": "ETFs and investment products",
  "2017-03-10": "ETFs and investment products",
  "2017-03-11": "ETFs and investment products",
  "2017-06-07": null,
  "2017-06-18": "ETFs and investment products",
  "2017-07-06": "ETFs and investment products",
  "2017-09-07": "Bitcoin adoption",
  "2017-09-25": "Bitcoin price & cycles",
  "2017-12-20": "ETFs and investment products",
  "2018-05-10": "ETFs and investment products",
  "2018-07-24": "ETFs and investment products",
  "2018-07-27": "ETFs and investment products",
  "2018-07-28": "ETFs and investment products",
  "2018-08-09": "ETFs and investment products",
  "2018-08-23": "ETFs and investment products",
  "2018-10-05": "ETFs and investment products",
  "2018-11-30": "ETFs and investment products",
  "2018-12-28": null,
  "2019-01-10": "ETFs and investment products",
  "2019-01-23": "ETFs and investment products",
  "2019-03-03": null,
  "2019-08-12": "ETFs and investment products",
  "2019-09-19": null,
  "2019-10-10": "ETFs and investment products",
  "2019-11-13": "ETFs and investment products",
  "2019-11-19": "ETFs and investment products",
  "2020-01-24": null,
  "2020-06-27": null,
  "2020-07-31": null,
  "2020-08-22": "ETFs and investment products",
  "2020-09-22": "ETFs and investment products",
  "2020-09-30": "ETFs and investment products",
  "2020-11-19": "ETFs and investment products",
  "2020-12-23": "Bitcoin price & cycles",
  "2020-12-30": "ETFs and investment products",
  "2021-01-18": "ETFs and investment products",
  "2021-01-30": "ETFs and investment products",
  "2021-02-18": "ETFs and investment products",
  "2021-03-20": "ETFs and investment products",
  "2021-03-26": "ETFs and investment products",
  "2021-08-15": "ETFs and investment products",
  "2021-09-09": "ETFs and investment products",
  "2021-09-30": "ETFs and investment products",
  "2021-10-15": "ETFs and investment products",
  "2021-10-18": "ETFs and investment products",
  "2021-11-22": "ETFs and investment products",
  "2022-06-16": null,
  "2022-07-21": "Bitcoin price & cycles",
  "2022-08-14": "Bitcoin adoption",
  "2022-10-15": "ETFs and investment products",
  "2022-11-09": "ETFs and investment products",
  "2022-11-20": null,
  "2023-03-01": "Bitcoin adoption",
  "2023-06-20": "ETFs and investment products",
  "2023-06-22": "ETFs and investment products",
  "2023-06-23": "ETFs and investment products",
  "2023-06-25": "ETFs and investment products",
  "2023-06-27": "ETFs and investment products",
  "2023-06-28": "ETFs and investment products",
  "2023-07-03": "ETFs and investment products",
  "2023-07-09": "ETFs and investment products",
  "2023-07-15": "ETFs and investment products",
  "2023-07-21": null,
  "2023-07-25": "ETFs and investment products",
  "2023-07-27": "ETFs and investment products",
  "2023-08-12": "ETFs and investment products",
  "2023-08-15": "ETFs and investment products",
  "2023-09-02": "ETFs and investment products",
  "2023-09-04": "ETFs and investment products",
  "2023-09-05": "ETFs and investment products",
  "2023-09-06": "ETFs and investment products",
  "2023-09-28": "ETFs and investment products",
  "2023-10-13": "ETFs and investment products",
  "2023-10-14": "ETFs and investment products",
  "2023-10-21": "ETFs and investment products",
  "2023-10-25": "ETFs and investment products",
  "2023-11-10": "ETFs and investment products",
  "2023-11-11": "ETFs and investment products",
  "2023-11-14": "ETFs and investment products",
  "2023-11-27": "ETFs and investment products",
  "2023-11-29": "ETFs and investment products",
  "2023-12-01": "ETFs and investment products",
  "2023-12-12": "ETFs and investment products",
  "2023-12-22": "ETFs and investment products",
  "2024-01-05": "ETFs and investment products",
  "2024-01-10": "ETFs and investment products",
  "2024-02-04": "ETFs and investment products",
  "2024-02-11": "ETFs and investment products",
  "2024-02-15": "ETFs and investment products",
  "2024-02-21": "ETFs and investment products",
  "2024-02-27": "ETFs and investment products",
  "2024-03-11": "ETFs and investment products",
  "2024-03-16": "ETFs and investment products",
  "2024-03-18": "ETFs and investment products",
  "2024-03-22": "ETFs and investment products",
  "2024-04-05": "ETFs and investment products",
  "2024-04-07": "Institutional Bitcoin & flows",
  "2024-04-09": "ETFs and investment products",
  "2024-04-28": "ETFs and investment products",
  "2024-05-02": "ETFs and investment products",
  "2024-05-04": "ETFs and investment products",
  "2024-05-12": "ETFs and investment products",
  "2024-05-29": "ETFs and investment products",
  "2024-06-05": "ETFs and investment products",
  "2024-06-16": "ETFs and investment products",
  "2024-08-20": "ETFs and investment products",
  "2024-08-31": "ETFs and investment products",
  "2024-09-10": "ETFs and investment products",
  "2024-10-17": "ETFs and investment products",
  "2024-10-18": "ETFs and investment products",
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

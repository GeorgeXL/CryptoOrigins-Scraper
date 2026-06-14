/**
 * Retag all rows currently on Halving events — keep only the four BTC halving dates.
 *
 * Usage:
 *   npx tsx server/scripts/retag-halving-events.ts --dry-run
 *   npx tsx server/scripts/retag-halving-events.ts --apply
 *   npx tsx server/scripts/retag-halving-events.ts --apply --offset 0 --limit 13
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

/** Only these four dates stay on Halving events. */
const KEEP_ON_HALVING = new Set(["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"]);

/** Editorial map for every row currently tagged Halving events. null = clear topic. */
const TARGET_BY_DATE: Record<string, string | null> = {
  "2009-04-24": "Politics and elections",
  "2012-11-28": "Halving events",
  "2015-08-25": "Smart contracts & L1s",
  "2016-03-12": null,
  "2016-04-04": "Bitcoin mining",
  "2016-04-16": "Bitcoin price & cycles",
  "2016-05-27": "Bitcoin mining",
  "2016-07-06": "Bitcoin mining",
  "2016-05-18": "Bitcoin price & cycles",
  "2016-07-09": "Halving events",
  "2019-02-05": "Bitcoin price & cycles",
  "2019-08-04": "Smart contracts & L1s",
  "2019-08-05": "Smart contracts & L1s",
  "2019-06-25": "Bitcoin mining",
  "2019-10-18": "Bitcoin mining",
  "2019-10-29": "Bitcoin price & cycles",
  "2019-12-16": "Bitcoin price & cycles",
  "2019-12-30": "Bitcoin mining",
  "2020-01-09": "Bitcoin price & cycles",
  "2020-01-25": "Bitcoin mining",
  "2020-01-28": "Bitcoin price & cycles",
  "2020-02-05": "Bitcoin mining",
  "2020-02-08": "Bitcoin price & cycles",
  "2020-02-27": "Bitcoin mining",
  "2020-03-07": "Bitcoin price & cycles",
  "2020-03-03": "Bitcoin adoption",
  "2020-03-11": "Bitcoin mining",
  "2020-03-18": "Bitcoin price & cycles",
  "2020-04-07": "Smart contracts & L1s",
  "2020-04-08": "Bitcoin price & cycles",
  "2020-04-10": "Smart contracts & L1s",
  "2020-04-11": "Bitcoin mining",
  "2020-04-22": "Bitcoin price & cycles",
  "2020-04-27": "Bitcoin price & cycles",
  "2020-04-29": "Bitcoin mining",
  "2020-05-01": "Bitcoin price & cycles",
  "2020-05-02": "Bitcoin price & cycles",
  "2020-05-04": "Bitcoin price & cycles",
  "2020-05-05": "Bitcoin mining",
  "2020-05-07": "Bitcoin adoption",
  "2020-05-08": "Bitcoin price & cycles",
  "2020-05-09": "Bitcoin mining",
  "2020-05-10": "Bitcoin mining",
  "2020-05-11": "Halving events",
  "2020-05-13": "Bitcoin mining",
  "2020-05-14": "Institutional Bitcoin & flows",
  "2020-05-16": "Bitcoin mining",
  "2020-05-19": "Bitcoin mining",
  "2020-05-20": "Bitcoin mining",
  "2020-05-24": "Bitcoin adoption",
  "2020-05-25": "Bitcoin mining",
  "2020-05-28": "Institutional Bitcoin & flows",
  "2020-11-06": "Bitcoin mining",
  "2022-04-01": "Bitcoin mining",
  "2023-05-16": "Bitcoin mining",
  "2023-07-24": "Bitcoin mining",
  "2023-08-27": "Bitcoin price & cycles",
  "2023-09-08": "Bitcoin price & cycles",
  "2023-11-10": "ETFs and investment products",
  "2023-12-07": null,
  "2024-01-03": "Bitcoin price & cycles",
  "2024-02-04": "Bitcoin mining",
  "2024-02-11": "ETFs and investment products",
  "2024-02-14": null,
  "2024-02-21": "Web3 industry and funding",
  "2024-02-22": "Bitcoin price & cycles",
  "2024-03-01": "Bitcoin mining",
  "2024-03-02": "Bitcoin price & cycles",
  "2024-03-10": "Bitcoin price & cycles",
  "2024-03-12": "Smart contracts & L1s",
  "2024-03-17": "Bitcoin mining",
  "2024-03-23": "Bitcoin mining",
  "2024-03-24": "Bitcoin mining",
  "2024-03-25": "Bitcoin mining",
  "2024-03-31": "Scaling and Layer 2",
  "2024-03-22": "ETFs and investment products",
  "2024-04-03": "Bitcoin price & cycles",
  "2024-04-04": "Smart contracts & L1s",
  "2024-04-05": "ETFs and investment products",
  "2024-04-08": null,
  "2024-04-10": "Bitcoin mining",
  "2024-04-11": "Bitcoin mining",
  "2024-04-14": "Bitcoin mining",
  "2024-04-12": "Smart contracts & L1s",
  "2024-04-20": "Halving events",
  "2024-05-10": "Bitcoin mining",
  "2024-07-02": "Bitcoin price & cycles",
  "2024-07-03": "Bitcoin price & cycles",
  "2024-07-06": "Bitcoin price & cycles",
  "2024-07-29": "Bitcoin mining",
  "2024-08-19": "Bitcoin mining",
};

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = true;
  let offset = 0;
  let limit: number | null = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--apply") dryRun = false;
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--offset" && args[i + 1]) offset = Number.parseInt(args[++i]!, 10) || 0;
    else if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i]!, 10) || null;
  }

  return { dryRun, offset, limit };
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
  const { dryRun, offset, limit } = parseArgs();
  const rows = await storage.getAnalysesForStorylineLeaf("Halving events");
  const slice = limit != null ? rows.slice(offset, offset + limit) : rows.slice(offset);

  const stats = { keep: 0, moved: 0, cleared: 0, skipped: 0, missingMap: 0 };

  console.log(
    JSON.stringify({
      mode: dryRun ? "dry-run" : "apply",
      totalOnLeaf: rows.length,
      batchOffset: offset,
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

    if (target === "Halving events") {
      stats.keep += 1;
      console.log(JSON.stringify({ date: row.date, action: "KEEP", target }));
      continue;
    }

    if (target === null) {
      stats.cleared += 1;
      console.log(JSON.stringify({ date: row.date, action: dryRun ? "WOULD_CLEAR" : "CLEAR", summary: row.summary?.slice(0, 80) }));
      await applyTarget(row.date, null, dryRun);
      continue;
    }

    stats.moved += 1;
    console.log(
      JSON.stringify({
        date: row.date,
        action: dryRun ? "WOULD_MOVE" : "MOVE",
        from: "Halving events",
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

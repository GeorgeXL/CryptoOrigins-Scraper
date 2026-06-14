/**
 * Emit list-*.ts and retag-*.ts — ensures TARGET_BY_DATE covers every row on each leaf.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import "dotenv/config";

import { storage } from "../storage";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dirname, "../..");

const LEAVES: Array<{ leaf: string; slug: string; fileSlug: string }> = [
  { leaf: "Inflation", slug: "inflation", fileSlug: "Inflation" },
  { leaf: "Monetary policy & rates", slug: "monetary-policy-rates", fileSlug: "Monetary-policy---rates" },
  { leaf: "Banking stress", slug: "banking-stress", fileSlug: "Banking-stress" },
  { leaf: "Debt crises", slug: "debt-crises", fileSlug: "Debt-crises" },
  { leaf: "Labor market", slug: "labor-market", fileSlug: "Labor-market" },
  { leaf: "Housing", slug: "housing", fileSlug: "Housing" },
  { leaf: "Bailouts and stimulus", slug: "bailouts-stimulus", fileSlug: "Bailouts-and-stimulus" },
  { leaf: "Global growth and recession", slug: "global-growth-recession", fileSlug: "Global-growth-and-recession" },
  { leaf: "Politics and elections", slug: "politics-elections", fileSlug: "Politics-and-elections" },
];

/** Date-specific editorial overrides (wins over generated map). */
const OVERRIDES: Record<string, Record<string, string | null>> = {
  Inflation: {
    "2022-09-13": "Bitcoin price & cycles",
  },
  "Monetary policy & rates": {
    "2013-07-16": "Bitcoin adoption",
    "2020-09-29": "Bitcoin adoption",
    "2020-12-08": "Institutional Bitcoin & flows",
    "2014-04-07": null,
    "2015-11-17": null,
    "2016-02-15": "CBDCs",
    "2010-07-22": null,
    "2011-09-17": null,
    "2012-10-21": null,
  },
  "Banking stress": {
    "2016-10-08": "Bitcoin price & cycles",
    "2023-03-12": "Exchanges",
    "2012-11-27": "Bailouts and stimulus",
    "2010-12-18": null,
    "2011-03-30": null,
    "2013-02-06": "Enforcement & crime",
  },
  "Debt crises": {
    "2009-03-30": "Global growth and recession",
    "2010-03-28": "Politics and elections",
    "2012-06-06": null,
  },
  "Labor market": {
    "2010-05-29": "Enforcement & crime",
    "2010-09-26": null,
    "2011-05-31": "Bitcoin price & cycles",
    "2014-04-30": null,
    "2021-10-14": "Bitcoin adoption",
    "2010-08-03": "Politics and elections",
    "2012-10-27": null,
  },
  Housing: {
    "2012-06-03": "Bitcoin price & cycles",
    "2012-08-04": null,
    "2012-08-28": null,
    "2012-10-04": null,
    "2012-11-03": null,
    "2010-04-16": "Banking stress",
    "2010-04-24": "Banking stress",
    "2010-04-30": "Banking stress",
    "2010-09-02": "Banking stress",
    "2011-02-12": "Debt crises",
  },
  "Bailouts and stimulus": {
    "2020-04-05": null,
    "2010-11-20": null,
    "2010-11-22": "Debt crises",
    "2011-03-14": "Global growth and recession",
    "2012-08-19": "Debt crises",
  },
  "Global growth and recession": {
    "2011-03-15": "Bitcoin price & cycles",
    "2015-10-25": "Bitcoin adoption",
    "2015-12-03": "Bitcoin adoption",
    "2014-01-03": "Bitcoin price & cycles",
    "2016-08-01": "Government adoption",
    "2020-03-29": "Bitcoin price & cycles",
    "2023-04-02": null,
    "2009-02-27": "Politics and elections",
    "2009-04-10": "Bailouts and stimulus",
    "2009-05-07": "Bailouts and stimulus",
    "2009-06-25": null,
    "2009-07-08": null,
    "2009-09-03": null,
    "2009-09-04": null,
    "2009-09-10": "Bailouts and stimulus",
    "2009-10-09": "Politics and elections",
    "2009-11-15": null,
    "2010-02-04": null,
    "2010-03-12": null,
    "2010-05-04": null,
    "2010-10-06": "Politics and elections",
    "2010-10-18": "Politics and elections",
    "2010-11-08": "Politics and elections",
    "2011-04-17": null,
    "2011-04-22": null,
    "2011-05-26": null,
    "2012-02-14": null,
    "2012-03-22": null,
    "2012-05-05": null,
    "2012-07-21": null,
    "2012-07-28": null,
    "2012-09-09": null,
    "2013-01-19": null,
  },
  "Politics and elections": {
    "2009-04-07": "Politics and elections",
    "2009-04-09": "Politics and elections",
    "2009-04-16": "Politics and elections",
    "2009-06-20": "Politics and elections",
    "2009-07-06": "Politics and elections",
    "2009-07-07": "Politics and elections",
    "2009-09-13": "Politics and elections",
    "2009-11-07": "Politics and elections",
    "2009-11-26": "Politics and elections",
    "2010-02-06": "Politics and elections",
    "2010-02-07": "Politics and elections",
    "2010-03-07": "Politics and elections",
    "2010-03-14": "Politics and elections",
    "2010-03-15": "Politics and elections",
    "2010-04-03": "Politics and elections",
    "2010-04-06": "Politics and elections",
    "2010-04-08": "Politics and elections",
    "2010-04-11": "Politics and elections",
    "2010-05-23": "Politics and elections",
    "2011-01-13": "Politics and elections",
    "2011-02-05": "Politics and elections",
    "2011-02-20": "Politics and elections",
    "2011-03-08": "Politics and elections",
    "2011-03-11": "Politics and elections",
    "2011-03-12": "Politics and elections",
    "2011-03-20": "Politics and elections",
    "2011-07-23": "Politics and elections",
    "2011-10-16": "Politics and elections",
    "2011-11-13": "Politics and elections",
    "2012-06-21": "Politics and elections",
    "2012-10-25": "Politics and elections",
    "2012-11-04": "Politics and elections",
    "2012-11-09": "Politics and elections",
    "2012-12-02": "Politics and elections",
    "2012-12-08": "Politics and elections",
    "2013-01-01": "Politics and elections",
    "2013-02-24": "Politics and elections",
    "2013-10-05": "Politics and elections",
    "2014-05-03": "Politics and elections",
    "2014-05-22": "Bitcoin regulation",
    "2014-09-26": "Politics and elections",
    "2015-05-11": "Politics and elections",
    "2015-07-29": "Politics and elections",
    "2015-11-25": "Politics and elections",
    "2016-06-26": "Politics and elections",
    "2016-09-26": "Bitcoin regulation",
    "2016-10-15": "Politics and elections",
    "2016-11-20": "Politics and elections",
    "2016-12-14": null,
    "2017-02-19": "Politics and elections",
    "2019-01-01": "Politics and elections",
    "2019-04-01": "Politics and elections",
    "2019-04-27": "Politics and elections",
    "2019-07-12": "Politics and elections",
    "2019-12-19": "Politics and elections",
    "2020-01-01": "Politics and elections",
    "2020-01-18": "Politics and elections",
    "2020-02-01": "Politics and elections",
    "2020-04-18": "Politics and elections",
    "2021-02-02": "Politics and elections",
    "2021-08-01": "Politics and elections",
    "2021-12-19": "Politics and elections",
    "2022-02-17": "Politics and elections",
    "2022-04-03": "Politics and elections",
    "2022-12-25": "Politics and elections",
    "2023-01-01": "Politics and elections",
    "2023-07-26": "Politics and elections",
    "2024-01-08": "Politics and elections",
    "2024-01-09": "Politics and elections",
    "2024-07-15": "Politics and elections",
    "2024-07-27": "Politics and elections",
    "2024-09-07": "Securities regulation",
    "2024-10-06": "Politics and elections",
    "2024-10-13": "Politics and elections",
    "2024-10-24": "Politics and elections",
    "2024-11-23": "Politics and elections",
    "2024-12-23": "Politics and elections",
  },
};

function parseMapFile(path: string): Record<string, string | null> {
  const raw = readFileSync(path, "utf8");
  const map: Record<string, string | null> = {};
  for (const match of raw.matchAll(/"(\d{4}-\d{2}-\d{2})":\s*(null|"([^"]+)"),/g)) {
    map[match[1]!] = match[2] === "null" ? null : match[3]!;
  }
  return map;
}

function retagScript(leaf: string, slug: string, count: number, mapBlock: string) {
  return `/**
 * Retag rows on ${leaf} — editorial map from main-events-leaf-prompts rules.
 *
 * Usage:
 *   npx tsx server/scripts/retag-${slug}.ts --dry-run
 *   npx tsx server/scripts/retag-${slug}.ts --apply
 *   npx tsx server/scripts/retag-${slug}.ts --apply --from 2010-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "${leaf}";

/** Editorial map for every row currently tagged ${leaf} (${count} rows). null = clear topic. */
${mapBlock}

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
`;
}

function listScript(leaf: string) {
  return `import "dotenv/config";
import { storage } from "../storage";

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf("${leaf}");
  for (const r of rows) {
    console.log(JSON.stringify({ date: r.date, summary: r.summary }));
  }
  console.error("total", rows.length);
}

main().catch(console.error);
`;
}

async function main() {
  for (const { leaf, slug, fileSlug } of LEAVES) {
    const mapPath = join(ROOT, "tmp/macro-maps", `${fileSlug}.map.ts`);
    const map = parseMapFile(mapPath);
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);

    for (const row of rows) {
      if (!(row.date in map)) {
        console.error(`WARN ${leaf}: missing generated map for ${row.date}, defaulting KEEP`);
        map[row.date] = leaf;
      }
    }

    const overrides = OVERRIDES[leaf] ?? {};
    for (const [date, target] of Object.entries(overrides)) {
      if (date in map || rows.some((r) => r.date === date)) {
        map[date] = target;
      }
    }

    // Drop stale dates no longer on leaf
    const liveDates = new Set(rows.map((r) => r.date));
    for (const date of Object.keys(map)) {
      if (!liveDates.has(date)) delete map[date];
    }

    const lines = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, target]) => {
        const val = target === null ? "null" : `"${target}"`;
        return `  "${date}": ${val},`;
      });

    const mapBlock = `const TARGET_BY_DATE: Record<string, string | null> = {\n${lines.join("\n")}\n};`;

    writeFileSync(join(ROOT, "server/scripts", `list-${slug}-rows.ts`), listScript(leaf));
    writeFileSync(
      join(ROOT, "server/scripts", `retag-${slug}.ts`),
      retagScript(leaf, slug, rows.length, mapBlock),
    );
    console.log(`Wrote ${leaf}: ${rows.length} rows, ${Object.keys(map).length} map entries`);
  }
}

main().catch(console.error);

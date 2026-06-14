/** Build retag script from _gen-* map output. */
import { readFileSync, writeFileSync } from "node:fs";

const configs: Array<{
  leaf: string;
  slug: string;
  desc: string;
  mapFile: string;
  statsFile: string;
}> = [
  {
    leaf: "Bitcoin price & cycles",
    slug: "bitcoin-price-cycles",
    desc: "BTC price milestones, market cycles, crashes, ATHs, and trading-structure firsts tied to price.",
    mapFile: "/tmp/gen-bitcoin-price-cycles-map.txt",
    statsFile: "/tmp/gen-bitcoin-price-cycles-stats.txt",
  },
  {
    leaf: "Exchanges",
    slug: "exchanges",
    desc: "exchange founding, launch, licensing, hacks, insolvency, withdrawal halts, and shutdowns.",
    mapFile: "/tmp/gen-exchanges-map.txt",
    statsFile: "/tmp/gen-exchanges-stats.txt",
  },
  {
    leaf: "Institutional Bitcoin & flows",
    slug: "institutional-bitcoin-flows",
    desc: "custody launches, bank/tradfi BTC products, corporate treasury buys, and institutional flow landmarks.",
    mapFile: "/tmp/gen-institutional-bitcoin-flows-map.txt",
    statsFile: "/tmp/gen-institutional-bitcoin-flows-stats.txt",
  },
  {
    leaf: "Derivatives",
    slug: "derivatives",
    desc: "Bitcoin futures, options, perps, and regulated derivatives milestones.",
    mapFile: "/tmp/gen-derivatives-map.txt",
    statsFile: "/tmp/gen-derivatives-stats.txt",
  },
  {
    leaf: "ETFs and investment products",
    slug: "etfs-investment-products",
    desc: "GBTC, spot/futures ETF approvals, trusts, and listed BTC investment products.",
    mapFile: "/tmp/gen-etfs-investment-products-map.txt",
    statsFile: "/tmp/gen-etfs-investment-products-stats.txt",
  },
];

function countMapEntries(mapBody: string): number {
  return (mapBody.match(/^\s+"\d{4}-\d{2}-\d{2}":/gm) ?? []).length;
}

for (const cfg of configs) {
  const mapRaw = readFileSync(cfg.mapFile, "utf8");
  const match = mapRaw.match(/const TARGET_BY_DATE[\s\S]*/);
  if (!match) {
    throw new Error(`No TARGET_BY_DATE block in ${cfg.mapFile}`);
  }
  const mapBody = match[0].trim();
  const total = countMapEntries(mapBody);

  const script = `/**
 * Retag rows on ${cfg.leaf} — keep ${cfg.desc}
 *
 * Usage:
 *   npx tsx server/scripts/retag-${cfg.slug}.ts --dry-run
 *   npx tsx server/scripts/retag-${cfg.slug}.ts --apply
 *   npx tsx server/scripts/retag-${cfg.slug}.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "${cfg.leaf}";

/** Editorial map for every row currently tagged ${cfg.leaf} (${total} rows). null = clear topic. */
${mapBody}

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

  const outPath = `server/scripts/retag-${cfg.slug}.ts`;
  writeFileSync(outPath, script);
  console.log(`Wrote ${outPath} (${total} map entries)`);
}

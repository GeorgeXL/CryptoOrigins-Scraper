/**
 * Writes list-*-rows.ts and retag-*-web3*.ts from editorial map generator (live DB).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateForLeaf } from "./_gen-web3-editorial-maps";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)));

const LEAF_CONFIG: Array<{ leaf: string; listFile: string; retagFile: string; desc: string }> = [
  {
    leaf: "Smart contracts & L1s",
    listFile: "list-smart-contracts-l1s-rows.ts",
    retagFile: "retag-smart-contracts-l1s.ts",
    desc: "Ethereum and other L1 launches, upgrades, merges, and major altcoin ecosystem milestones.",
  },
  {
    leaf: "Stablecoins",
    listFile: "list-stablecoins-rows.ts",
    retagFile: "retag-stablecoins.ts",
    desc: "Stablecoin launches, peg breaks, and regulatory moments.",
  },
  {
    leaf: "DeFi",
    listFile: "list-defi-rows.ts",
    retagFile: "retag-defi.ts",
    desc: "DeFi protocol launches, hacks, and governance milestones.",
  },
  {
    leaf: "NFTs and gaming",
    listFile: "list-nfts-gaming-rows.ts",
    retagFile: "retag-nfts-gaming.ts",
    desc: "NFT marketplaces, collections, and crypto gaming milestones.",
  },
  {
    leaf: "Cross-chain and bridges",
    listFile: "list-cross-chain-bridges-rows.ts",
    retagFile: "retag-cross-chain-bridges.ts",
    desc: "Bridges, interoperability protocols, and cross-chain hacks.",
  },
  {
    leaf: "Web3 industry and funding",
    listFile: "list-web3-industry-funding-rows.ts",
    retagFile: "retag-web3-industry-funding.ts",
    desc: "Major VC rounds and industry-scale web3 company milestones.",
  },
];

function formatMap(map: Record<string, string | null>): string {
  const lines = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, target]) => {
      const val = target === null ? "null" : `"${target}"`;
      return `  "${date}": ${val},`;
    });
  return `const TARGET_BY_DATE: Record<string, string | null> = {\n${lines.join("\n")}\n};`;
}

function listScript(leaf: string): string {
  return `import "dotenv/config";
import { storage } from "../storage";

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf(${JSON.stringify(leaf)});
  for (const r of rows) {
    console.log(JSON.stringify({ date: r.date, summary: r.summary }));
  }
  console.error("total", rows.length);
}

main().catch(console.error);
`;
}

function retagScript(leaf: string, desc: string, mapBlock: string, total: number, retagFile: string): string {
  return `/**
 * Retag rows on ${leaf} — ${desc}
 *
 * Usage:
 *   npx tsx server/scripts/${retagFile} --dry-run
 *   npx tsx server/scripts/${retagFile} --apply
 *   npx tsx server/scripts/${retagFile} --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = ${JSON.stringify(leaf)};

/** Editorial map for every row currently tagged ${leaf} (${total} rows). null = clear topic. */
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

async function main() {
  for (const cfg of LEAF_CONFIG) {
    const { total, stats, byTarget, map } = await generateForLeaf(cfg.leaf as Parameters<typeof generateForLeaf>[0]);
    const mapBlock = formatMap(map);

    writeFileSync(join(ROOT, cfg.listFile), listScript(cfg.leaf));
    writeFileSync(join(ROOT, cfg.retagFile), retagScript(cfg.leaf, cfg.desc, mapBlock, total, cfg.retagFile));
    console.log(JSON.stringify({ wrote: cfg.retagFile, total, stats, byTarget }));
  }
}

main().catch(console.error);

/**
 * Generate retag + list scripts for all Crypto policy & regulation leaves.
 * Run: npx tsx server/scripts/_bootstrap-policy-retags.ts
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LEAVES: Array<{ leaf: string; slug: string; description: string }> = [
  {
    leaf: "Bitcoin regulation",
    slug: "bitcoin-regulation",
    description: "Laws, bans, and regulator actions specifically targeting Bitcoin.",
  },
  {
    leaf: "Securities regulation",
    slug: "securities-regulation",
    description: "SEC/CFTC and securities rules affecting crypto markets and products.",
  },
  {
    leaf: "Tax policy",
    slug: "tax-policy",
    description: "Tax law and guidance affecting crypto.",
  },
  {
    leaf: "Banking & prudential (crypto)",
    slug: "banking-prudential-crypto",
    description: "Banking rules for crypto custody, capital treatment, and prudential guidance.",
  },
  {
    leaf: "Sanctions and enforcement",
    slug: "sanctions-enforcement",
    description: "Sanctions, OFAC actions, and state enforcement against crypto actors.",
  },
  {
    leaf: "Legal cases",
    slug: "legal-cases",
    description: "Major court cases and rulings about crypto.",
  },
  {
    leaf: "Government adoption",
    slug: "government-adoption",
    description: "Nation-state adoption, legal tender, strategic reserves, and public-sector BTC use.",
  },
  {
    leaf: "CBDCs",
    slug: "cbdcs",
    description: "Central bank digital currency launches, pilots, and major CBDC policy shifts.",
  },
  {
    leaf: "Enforcement & crime",
    slug: "enforcement-crime",
    description: "Major prosecutions, seizures, mixer bans, and landmark fraud/Ponzi cases.",
  },
];

const RETAG_TEMPLATE = (leaf: string, slug: string, description: string, rowCount: number, mapBlock: string) => `/**
 * Retag rows on ${leaf} — ${description}
 *
 * Usage:
 *   npx tsx server/scripts/retag-${slug}.ts --dry-run
 *   npx tsx server/scripts/retag-${slug}.ts --apply
 *   npx tsx server/scripts/retag-${slug}.ts --apply --from 2012-01-01 --to 2016-12-31
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { storage } from "../storage";
import { syncStorylineAssignmentsForDate } from "../services/editorial-pipeline/storyline-taxonomy";

const LEAF = "${leaf}";

/** Editorial map for every row currently tagged ${leaf} (${rowCount} rows). null = clear topic. */
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

const LIST_TEMPLATE = (leaf: string, slug: string) => `import "dotenv/config";
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

const scriptsDir = path.join(process.cwd(), "server/scripts");

for (const { leaf, slug, description } of LEAVES) {
  console.error(`Generating map for ${leaf}...`);
  const out = execSync(`npx tsx server/scripts/_gen-policy-leaf-map.ts "${leaf}"`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });

  const mapMatch = out.match(/const TARGET_BY_DATE[\s\S]+?\n};/);
  if (!mapMatch) {
    console.error(`Failed to extract map for ${leaf}`);
    process.exit(1);
  }

  const mapBlock = mapMatch[0];
  const rowCount = (mapBlock.match(/"\d{4}-\d{2}-\d{2}"/g) ?? []).length;

  fs.writeFileSync(
    path.join(scriptsDir, `retag-${slug}.ts`),
    RETAG_TEMPLATE(leaf, slug, description, rowCount, mapBlock),
  );
  fs.writeFileSync(path.join(scriptsDir, `list-${slug}-rows.ts`), LIST_TEMPLATE(leaf, slug));
  console.error(`  → ${rowCount} rows → retag-${slug}.ts, list-${slug}-rows.ts`);
}

console.error("Done.");

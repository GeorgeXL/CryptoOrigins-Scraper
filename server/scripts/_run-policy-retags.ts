/**
 * Run dry-run or apply all policy leaf retags in date-range batches.
 * Usage:
 *   npx tsx server/scripts/_run-policy-retags.ts --dry-run
 *   npx tsx server/scripts/_run-policy-retags.ts --apply
 */
import { execSync } from "node:child_process";

const SLUGS = [
  "bitcoin-regulation",
  "securities-regulation",
  "tax-policy",
  "banking-prudential-crypto",
  "sanctions-enforcement",
  "legal-cases",
  "government-adoption",
  "cbdcs",
  "enforcement-crime",
];

const RANGES = [
  { from: "2009-01-01", to: "2012-12-31" },
  { from: "2013-01-01", to: "2016-12-31" },
  { from: "2017-01-01", to: "2020-12-31" },
  { from: "2021-01-01", to: "2024-12-31" },
  { from: "2025-01-01", to: "2026-12-31" },
];

const mode = process.argv.includes("--apply") ? "--apply" : "--dry-run";

type LeafResult = {
  slug: string;
  startCount: number;
  finalCount: number;
  stats: { keep: number; moved: number; cleared: number; skipped: number; missingMap: number };
  exampleMove?: { date: string; from: string; to: string; summary: string };
};

function parseStats(output: string) {
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.includes('"stats"')) {
      try {
        const parsed = JSON.parse(line);
        return parsed.stats as LeafResult["stats"];
      } catch {
        /* continue */
      }
    }
  }
  return { keep: 0, moved: 0, cleared: 0, skipped: 0, missingMap: 0 };
}

function parseExampleMove(output: string): LeafResult["exampleMove"] | undefined {
  for (const line of output.split("\n")) {
    if (!line.includes("WOULD_MOVE") && !line.includes('"MOVE"')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.to && parsed.from) {
        return {
          date: parsed.date,
          from: parsed.from,
          to: parsed.to,
          summary: parsed.summary ?? "",
        };
      }
    } catch {
      /* continue */
    }
  }
  return undefined;
}

function getStartCount(slug: string): number {
  const out = execSync(`npx tsx server/scripts/list-${slug}-rows.ts 2>&1`, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const match = out.match(/total (\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

const results: LeafResult[] = [];

for (const slug of SLUGS) {
  console.error(`\n=== ${slug} ===`);
  const startCount = getStartCount(slug);
  const agg: LeafResult["stats"] = { keep: 0, moved: 0, cleared: 0, skipped: 0, missingMap: 0 };
  let exampleMove: LeafResult["exampleMove"];

  for (const range of RANGES) {
    const cmd = `npx tsx server/scripts/retag-${slug}.ts ${mode} --from ${range.from} --to ${range.to}`;
    console.error(`  ${range.from} → ${range.to}`);
    const out = execSync(cmd, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const stats = parseStats(out);
    agg.keep += stats.keep;
    agg.moved += stats.moved;
    agg.cleared += stats.cleared;
    agg.skipped += stats.skipped;
    agg.missingMap += stats.missingMap;
    if (!exampleMove) exampleMove = parseExampleMove(out);
  }

  const finalCount = mode === "--apply" ? getStartCount(slug) : startCount - agg.moved - agg.cleared;
  results.push({ slug, startCount, finalCount, stats: agg, exampleMove });
}

console.log(JSON.stringify({ mode, results }, null, 2));

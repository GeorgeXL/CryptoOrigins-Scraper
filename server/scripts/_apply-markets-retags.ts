/**
 * Atomic per-leaf regen → build → verify → apply Markets retags in date batches.
 * Run: npx tsx server/scripts/_apply-markets-retags.ts
 */
import { execSync } from "node:child_process";

const ROOT = process.cwd();

const LEAVES: Array<{ slug: string }> = [
  { slug: "derivatives" },
  { slug: "etfs-investment-products" },
  { slug: "institutional-bitcoin-flows" },
  { slug: "exchanges" },
  { slug: "bitcoin-price-cycles" },
];

const BATCHES: Array<{ from: string; to: string }> = [
  { from: "2009-01-01", to: "2014-12-31" },
  { from: "2015-01-01", to: "2019-12-31" },
  { from: "2020-01-01", to: "2022-12-31" },
  { from: "2023-01-01", to: "2026-12-31" },
];

function run(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
}

function regenAndBuild(slug: string) {
  run(`npx tsx server/scripts/_gen-${slug}-map.ts 2>/dev/null > /tmp/gen-${slug}-map.txt`);
  run(`npx tsx server/scripts/_build-retag-from-map.ts`);
}

function dryRun(slug: string) {
  return execSync(`npx tsx server/scripts/retag-${slug}.ts --dry-run 2>/dev/null`, {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function parseDryRun(out: string) {
  const lines = out.split("\n").filter((l) => l.trim().startsWith("{"));
  const header = JSON.parse(lines[0]!);
  const stats = JSON.parse(lines[lines.length - 1]!).stats;
  const missing = lines.filter((l) => l.includes('"action":"SKIP"'));
  const exampleMove = lines.find((l) => l.includes('"WOULD_MOVE"'));
  return { header, stats, missing, exampleMove };
}

function countOnLeaf(slug: string): number {
  return parseDryRun(dryRun(slug)).header.totalOnLeaf as number;
}

const results: Array<Record<string, unknown>> = [];

for (const { slug } of LEAVES) {
  console.log(`\n========== ${slug} ==========`);
  regenAndBuild(slug);

  let verify = parseDryRun(dryRun(slug));
  if (verify.missing.length > 0) {
    console.warn(`Retry regen (${verify.missing.length} missing)`);
    regenAndBuild(slug);
    verify = parseDryRun(dryRun(slug));
  }

  if (verify.missing.length > 0) {
    console.error(`FAIL ${slug}: still missing entries`);
    verify.missing.forEach((m) => console.error(m));
    process.exit(1);
  }

  const start = verify.header.totalOnLeaf as number;
  console.log(
    `Dry-run: keep=${verify.stats.keep} moved=${verify.stats.moved} cleared=${verify.stats.cleared}`,
  );

  for (const batch of BATCHES) {
    execSync(
      `npx tsx server/scripts/retag-${slug}.ts --apply --from ${batch.from} --to ${batch.to} 2>/dev/null`,
      { cwd: ROOT, stdio: "inherit" },
    );
  }

  const end = countOnLeaf(slug);
  console.log(`${slug}: ${start} → ${end}`);

  results.push({
    slug,
    start,
    end,
    stats: verify.stats,
    exampleMove: verify.exampleMove ? JSON.parse(verify.exampleMove) : null,
    listScript: `server/scripts/list-${slug}-rows.ts`,
    retagScript: `server/scripts/retag-${slug}.ts`,
  });
}

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));

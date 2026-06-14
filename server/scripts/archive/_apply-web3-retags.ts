/**
 * Apply all Web3 retags in date-range batches (same pattern as Bitcoin retags).
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

const SCRIPTS = [
  "retag-smart-contracts-l1s",
  "retag-stablecoins",
  "retag-defi",
  "retag-nfts-gaming",
  "retag-cross-chain-bridges",
  "retag-web3-industry-funding",
];

const BATCHES: Array<{ from: string; to: string }> = [
  { from: "2009-01-01", to: "2015-12-31" },
  { from: "2016-01-01", to: "2019-12-31" },
  { from: "2020-01-01", to: "2022-12-31" },
  { from: "2023-01-01", to: "2026-12-31" },
];

function run(script: string, args: string) {
  const cmd = `npx tsx server/scripts/${script}.ts ${args}`;
  const out = execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const statsLine = out.trim().split("\n").filter((l) => l.startsWith('{"stats"')).pop();
  return statsLine ? JSON.parse(statsLine) : null;
}

async function main() {
  const mode = process.argv.includes("--apply") ? "--apply" : "--dry-run";
  console.log(JSON.stringify({ mode, batches: BATCHES.length, scripts: SCRIPTS.length }));

  for (const script of SCRIPTS) {
    console.log(`\n=== ${script} ===`);
    for (const batch of BATCHES) {
      const stats = run(script, `${mode} --from ${batch.from} --to ${batch.to}`);
      console.log(JSON.stringify({ script, ...batch, stats }));
    }
  }
}

main().catch(console.error);

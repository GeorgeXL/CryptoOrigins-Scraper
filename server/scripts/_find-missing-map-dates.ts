import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { storage } from "../storage";

const SCRIPTS: Array<{ leaf: string; file: string }> = [
  { leaf: "Smart contracts & L1s", file: "retag-smart-contracts-l1s.ts" },
  { leaf: "Stablecoins", file: "retag-stablecoins.ts" },
  { leaf: "DeFi", file: "retag-defi.ts" },
  { leaf: "NFTs and gaming", file: "retag-nfts-gaming.ts" },
  { leaf: "Cross-chain and bridges", file: "retag-cross-chain-bridges.ts" },
  { leaf: "Web3 industry and funding", file: "retag-web3-industry-funding.ts" },
];

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)));

function mapDatesFromFile(file: string): Set<string> {
  const text = readFileSync(join(ROOT, file), "utf8");
  const dates = new Set<string>();
  for (const m of text.matchAll(/"(\d{4}-\d{2}-\d{2})":/g)) dates.add(m[1]!);
  return dates;
}

async function main() {
  for (const { leaf, file } of SCRIPTS) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    const mapped = mapDatesFromFile(file);
    const missing = rows.filter((r) => !mapped.has(r.date));
    console.log(`\n${leaf}: db=${rows.length} map=${mapped.size} missing=${missing.length}`);
    for (const r of missing) {
      console.log(`  ${r.date}: ${r.summary?.slice(0, 100)}`);
    }
  }
}

main().catch(console.error);

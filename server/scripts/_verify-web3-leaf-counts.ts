import "dotenv/config";
import { storage } from "../storage";

const LEAVES = [
  "Smart contracts & L1s",
  "Stablecoins",
  "DeFi",
  "NFTs and gaming",
  "Cross-chain and bridges",
  "Web3 industry and funding",
];

async function main() {
  const counts: Record<string, number> = {};
  for (const leaf of LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    counts[leaf] = rows.length;
  }
  console.log(JSON.stringify(counts));
}

main().catch(console.error);

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
  for (const leaf of LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    console.log(`=== ${leaf} (${rows.length}) ===`);
    for (const r of rows) {
      console.log(JSON.stringify({ date: r.date, summary: r.summary }));
    }
  }
}

main().catch(console.error);

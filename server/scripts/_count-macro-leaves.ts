import "dotenv/config";
import { storage } from "../storage";

const LEAVES = [
  "Inflation",
  "Monetary policy & rates",
  "Banking stress",
  "Debt crises",
  "Labor market",
  "Housing",
  "Bailouts and stimulus",
  "Global growth and recession",
  "Politics and elections",
];

async function main() {
  for (const leaf of LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    console.log(`${leaf}: ${rows.length}`);
  }
}

main().catch(console.error);

import "dotenv/config";
import { storage } from "../storage";

const LEAVES = [
  "Bitcoin regulation",
  "Securities regulation",
  "Tax policy",
  "Banking & prudential (crypto)",
  "Sanctions and enforcement",
  "Legal cases",
  "Government adoption",
  "CBDCs",
  "Enforcement & crime",
];

async function main() {
  for (const leaf of LEAVES) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    console.log(`${leaf}\t${rows.length}`);
  }
}

main().catch(console.error);

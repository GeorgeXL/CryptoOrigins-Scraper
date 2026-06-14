import "dotenv/config";
import { storage } from "../storage";

const CHECK = ["2015-09-28", "2016-05-22", "2016-07-15", "2017-06-24", "2022-02-14", "2024-04-26"];

async function main() {
  for (const leaf of [
    "Smart contracts & L1s",
    "NFTs and gaming",
    "Cross-chain and bridges",
    "Web3 industry and funding",
    "Stablecoins",
  ]) {
    const rows = await storage.getAnalysesForStorylineLeaf(leaf);
    console.log(`\n${leaf}: ${rows.length}`);
    for (const d of CHECK) {
      const r = rows.find((x) => x.date === d);
      if (r) console.log(`  ${d}: ${r.summary}`);
    }
  }
}

main().catch(console.error);

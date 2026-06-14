import "dotenv/config";
import { storage } from "../storage";

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf("Web3 industry and funding");
  for (const r of rows) {
    console.log(JSON.stringify({ date: r.date, summary: r.summary }));
  }
  console.error("total", rows.length);
}

main().catch(console.error);

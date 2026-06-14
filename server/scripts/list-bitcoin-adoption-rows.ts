import "dotenv/config";
import { storage } from "../storage";

async function main() {
  const rows = await storage.getAnalysesForStorylineLeaf("Bitcoin adoption");
  for (const r of rows) {
    console.log(JSON.stringify({ date: r.date, summary: r.summary }));
  }
  console.error("total", rows.length);
}

main().catch(console.error);

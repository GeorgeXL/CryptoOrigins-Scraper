import "dotenv/config";

import { isGenericPublisherLandingUrl } from "../../shared/article-url-quality";
import { storage } from "../storage";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await storage.getAllAnalyses();

  const hits = rows
    .filter((r) => !r.isLocked)
    .filter((r) => r.topArticleId?.trim())
    .filter((r) => isGenericPublisherLandingUrl(r.topArticleId))
    .map((r) => ({ date: r.date, url: r.topArticleId!.trim() }))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`${apply ? "APPLY" : "DRY RUN"} · ${hits.length} generic homepage URL(s)\n`);
  for (const hit of hits) {
    console.log(`${hit.date}\t${hit.url}`);
  }

  if (!apply) {
    console.log("\nPass --apply to clear these URLs from the database.");
    return;
  }

  for (const hit of hits) {
    await storage.updateAnalysis(hit.date, {
      topArticleId: null,
      isManualOverride: false,
      winningTier: null,
      tierUsed: null,
      tieredArticles: null,
      analyzedArticles: null,
      reasoning: null,
    });
    console.log(`cleared ${hit.date}`);
  }

  console.log(`\nDone: cleared ${hits.length} row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

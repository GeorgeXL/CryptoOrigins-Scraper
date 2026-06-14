import "dotenv/config";
import { formatTopicLeafWithGroup } from "../../shared/topic-hierarchy";
import { storage } from "../storage";
import { runStorylineFitBatch } from "../services/homepage-checks/storyline-fit";

async function main() {
  const leaf = "Halving events";
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const first10 = rows.slice(0, 10);

  console.log(`Total on ${leaf}: ${rows.length}`);
  if (first10.length === 0) return;

  const report = await runStorylineFitBatch(
    leaf,
    first10.map((r) => ({
      date: r.date,
      summary: r.summary ?? "",
      tags: r.tagsVersion2 ?? [],
      topic_categories: r.topicCategories,
    })),
  );

  for (const row of first10) {
    const fit = report.results[row.date];
    console.log(
      JSON.stringify({
        date: row.date,
        summary: row.summary,
        fit: fit?.status,
        reason: fit?.reason,
        suggested: fit?.suggestedLeaves?.map(formatTopicLeafWithGroup),
        source: fit?.source,
      }),
    );
  }

  console.log(
    JSON.stringify({
      ok: report.ok,
      mismatch: report.mismatch,
      uncertain: report.uncertain,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

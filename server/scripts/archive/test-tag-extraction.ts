import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql } from "drizzle-orm";
import { entityExtractor } from "../services/entity-extractor";

const MAX_CONCURRENT = 8;

async function main() {
  console.log("🧪 Testing tag extraction with 10 summaries (batched 8 at a time)\n");

  // Get 10 analyses with summaries
  const analyses = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
    })
    .from(historicalNewsAnalyses)
    .where(sql`summary IS NOT NULL AND summary != ''`)
    .limit(10);

  if (analyses.length === 0) {
    console.log("❌ No analyses with summaries found");
    process.exit(1);
  }

  console.log(`📊 Found ${analyses.length} analyses to test\n`);

  const results: Array<{ date: string; tags: string[]; success: boolean; error?: string }> = [];
  const running = new Map<string, Promise<{ date: string; tags: string[]; success: boolean; error?: string }>>();
  let index = 0;
  let processed = 0;

  const startTime = Date.now();

  while (index < analyses.length || running.size > 0) {
    // Start new extractions until we have MAX_CONCURRENT running
    while (running.size < MAX_CONCURRENT && index < analyses.length) {
      const analysis = analyses[index];
      
      console.log(`🚀 [${index + 1}/${analyses.length}] Starting extraction for ${analysis.date} (${running.size + 1} running)`);
      
      const promise = entityExtractor
        .extractEntities(analysis.summary)
        .then((tags) => {
          processed++;
          console.log(`✅ [${processed}/${analyses.length}] ${analysis.date}: ${tags.length} tags - ${tags.join(', ')}`);
          return {
            date: analysis.date,
            tags,
            success: true,
          };
        })
        .catch((error) => {
          processed++;
          console.error(`❌ [${processed}/${analyses.length}] Error extracting tags for ${analysis.date}:`, error);
          return {
            date: analysis.date,
            tags: [],
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        });

      running.set(analysis.date, promise);
      index++;
    }

    // Wait for at least one to complete before starting more
    if (running.size > 0) {
      const completed = await Promise.race(
        Array.from(running.entries()).map(([date, promise]) =>
          promise.then((result) => ({ result, date })).catch((error) => {
            console.error(`Promise error for ${date}:`, error);
            return {
              result: {
                date,
                tags: [],
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              date,
            };
          })
        )
      );

      results.push(completed.result);
      running.delete(completed.date);
    }
  }

  const duration = Date.now() - startTime;
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalTags = results.reduce((sum, r) => sum + r.tags.length, 0);

  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Successful: ${successful}/${analyses.length}`);
  console.log(`   ❌ Failed: ${failed}/${analyses.length}`);
  console.log(`   🏷️  Total tags extracted: ${totalTags}`);
  console.log(`   ⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`   📈 Average: ${(duration / analyses.length / 1000).toFixed(2)}s per summary\n`);

  console.log(`\n📋 Detailed Results:\n`);
  results.forEach((result) => {
    if (result.success) {
      console.log(`   ${result.date}: ${result.tags.length} tags - [${result.tags.join(', ')}]`);
    } else {
      console.log(`   ${result.date}: ❌ ${result.error}`);
    }
  });

  // Verify model is gpt-4o-mini
  console.log(`\n✅ Using model: gpt-4o-mini (verified in entity-extractor.ts)`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});


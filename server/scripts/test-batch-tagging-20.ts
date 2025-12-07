import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { entityExtractor } from "../services/entity-extractor";

async function main() {
  console.log("🧪 Testing Batch Tagging on 20 Untagged Events\n");
  console.log("=".repeat(80));

  // Get 20 analyses that have empty or null tags_version2
  const analyses = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
    })
    .from(historicalNewsAnalyses)
    .where(
      sql`summary IS NOT NULL 
        AND summary != '' 
        AND (tags_version2 IS NULL 
          OR array_length(tags_version2, 1) IS NULL 
          OR array_length(tags_version2, 1) = 0)`
    )
    .orderBy(sql`RANDOM()`)
    .limit(20);

  if (analyses.length === 0) {
    console.log("❌ No analyses with empty tags_version2 arrays found");
    console.log("   This might mean all summaries have been tagged successfully!");
    process.exit(0);
  }

  console.log(`📊 Found ${analyses.length} untagged analyses to process\n`);

  const results: Array<{
    date: string;
    summary: string;
    extractedTags: string[];
    success: boolean;
    error?: string;
    updated: boolean;
  }> = [];

  // Process each analysis (similar to batch tagging endpoint)
  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i];
    console.log(`\n[${i + 1}/${analyses.length}] Processing ${analysis.date}...`);
    console.log(`Summary: "${analysis.summary.substring(0, 100)}${analysis.summary.length > 100 ? '...' : ''}"`);

    try {
      // Extract tag names from summary (same as batch tagging)
      const extractedTags = await entityExtractor.extractEntities(analysis.summary);
      
      // Update analysis with tags_version2 (same as batch tagging)
      await db
        .update(historicalNewsAnalyses)
        .set({ tagsVersion2: extractedTags })
        .where(eq(historicalNewsAnalyses.date, analysis.date));
      
      results.push({
        date: analysis.date,
        summary: analysis.summary,
        extractedTags,
        success: true,
        updated: true,
      });
      
      if (extractedTags.length > 0) {
        console.log(`✅ Tagged ${analysis.date} with ${extractedTags.length} tags: ${extractedTags.slice(0, 5).join(', ')}${extractedTags.length > 5 ? '...' : ''}`);
      } else {
        console.log(`📭 No tags extracted for ${analysis.date} (empty array)`);
      }
    } catch (error) {
      results.push({
        date: analysis.date,
        summary: analysis.summary,
        extractedTags: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        updated: false,
      });
      console.error(`❌ Error tagging ${analysis.date}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Small delay to avoid rate limits (same as batch tagging)
    if (i < analyses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("\n📊 BATCH TAGGING TEST SUMMARY:\n");
  
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const withTags = results.filter((r) => r.extractedTags.length > 0).length;
  const stillEmpty = results.filter((r) => r.extractedTags.length === 0 && r.success).length;
  const totalTags = results.reduce((sum, r) => sum + r.extractedTags.length, 0);
  const updated = results.filter((r) => r.updated).length;

  console.log(`   ✅ Successful extractions: ${successful}/${analyses.length}`);
  console.log(`   ❌ Failed extractions: ${failed}/${analyses.length}`);
  console.log(`   💾 Database updates: ${updated}/${analyses.length}`);
  console.log(`   🏷️  Summaries with tags extracted: ${withTags}/${analyses.length} (${((withTags/analyses.length)*100).toFixed(1)}%)`);
  console.log(`   📭 Summaries still empty (but successful): ${stillEmpty}/${analyses.length} (${((stillEmpty/analyses.length)*100).toFixed(1)}%)`);
  console.log(`   🏷️  Total tags extracted: ${totalTags}`);
  if (successful > 0) {
    console.log(`   📈 Average tags per summary: ${(totalTags / successful).toFixed(2)}`);
  }

  console.log("\n📋 DETAILED RESULTS:\n");
  results.forEach((result, idx) => {
    console.log(`\n${idx + 1}. ${result.date}`);
    console.log(`   Summary: "${result.summary.substring(0, 120)}${result.summary.length > 120 ? '...' : ''}"`);
    if (result.success) {
      if (result.extractedTags.length > 0) {
        console.log(`   ✅ Extracted ${result.extractedTags.length} tags: ${JSON.stringify(result.extractedTags)}`);
        console.log(`   💾 Database updated: ${result.updated ? 'Yes' : 'No'}`);
      } else {
        console.log(`   📭 No tags extracted (might be genuinely empty)`);
        console.log(`   💾 Database updated: ${result.updated ? 'Yes' : 'No'}`);
      }
    } else {
      console.log(`   ❌ Error: ${result.error}`);
      console.log(`   💾 Database updated: ${result.updated ? 'Yes' : 'No'}`);
    }
  });

  // Verify database updates
  console.log("\n" + "=".repeat(80));
  console.log("\n🔍 VERIFYING DATABASE UPDATES:\n");
  
  const dates = results.map(r => r.date);
  const verificationResults = await db
    .select({
      date: historicalNewsAnalyses.date,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
    })
    .from(historicalNewsAnalyses)
    .where(
      sql`date = ANY(${sql.raw(`ARRAY[${dates.map(d => `'${d}'`).join(', ')}]`)}::date[])`
    );

  console.log(`📊 Verified ${verificationResults.length}/${results.length} entries in database`);
  
  verificationResults.forEach((verified) => {
    const result = results.find(r => r.date === verified.date);
    if (result) {
      const tagsMatch = JSON.stringify(verified.tagsVersion2) === JSON.stringify(result.extractedTags);
      if (tagsMatch) {
        console.log(`   ✅ ${verified.date}: Tags match (${verified.tagsVersion2?.length || 0} tags)`);
      } else {
        console.log(`   ⚠️  ${verified.date}: Tags mismatch!`);
        console.log(`      Expected: ${JSON.stringify(result.extractedTags)}`);
        console.log(`      Got: ${JSON.stringify(verified.tagsVersion2)}`);
      }
    }
  });

  console.log("\n" + "=".repeat(80));
  console.log("\n✅ Batch Tagging Test Complete!\n");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});


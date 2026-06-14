import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql } from "drizzle-orm";
import { entityExtractor } from "../services/entity-extractor";

async function main() {
  console.log("🧪 Testing entity extraction on 30 summaries with empty tags\n");

  // Get 30 analyses that have empty tags_version2 (null or empty array)
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
    .limit(30);

  if (analyses.length === 0) {
    console.log("❌ No analyses with empty tags found");
    process.exit(1);
  }

  console.log(`📊 Found ${analyses.length} analyses with empty tags to test\n`);
  console.log("=" .repeat(80));

  const results: Array<{
    date: string;
    summary: string;
    originalTags: string[] | null;
    extractedTags: string[];
    success: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i];
    console.log(`\n[${i + 1}/${analyses.length}] Testing ${analysis.date}`);
    console.log(`Summary: "${analysis.summary.substring(0, 150)}${analysis.summary.length > 150 ? '...' : ''}"`);
    console.log(`Current tags: ${analysis.tagsVersion2 ? JSON.stringify(analysis.tagsVersion2) : 'null'}`);

    try {
      const extractedTags = await entityExtractor.extractEntities(analysis.summary);
      results.push({
        date: analysis.date,
        summary: analysis.summary,
        originalTags: analysis.tagsVersion2 || null,
        extractedTags,
        success: true,
      });
      console.log(`✅ Extracted ${extractedTags.length} tags: ${extractedTags.length > 0 ? JSON.stringify(extractedTags) : '[]'}`);
    } catch (error) {
      results.push({
        date: analysis.date,
        summary: analysis.summary,
        originalTags: analysis.tagsVersion2 || null,
        extractedTags: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      console.error(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Small delay to avoid rate limits
    if (i < analyses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("\n📊 SUMMARY:\n");
  
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const withTags = results.filter((r) => r.extractedTags.length > 0).length;
  const stillEmpty = results.filter((r) => r.extractedTags.length === 0 && r.success).length;
  const totalTags = results.reduce((sum, r) => sum + r.extractedTags.length, 0);

  console.log(`   ✅ Successful extractions: ${successful}/${analyses.length}`);
  console.log(`   ❌ Failed extractions: ${failed}/${analyses.length}`);
  console.log(`   🏷️  Summaries with tags extracted: ${withTags}/${analyses.length}`);
  console.log(`   📭 Summaries still empty (but successful): ${stillEmpty}/${analyses.length}`);
  console.log(`   🏷️  Total tags extracted: ${totalTags}`);
  console.log(`   📈 Average tags per summary: ${(totalTags / successful).toFixed(2)}`);

  console.log("\n📋 DETAILED RESULTS:\n");
  results.forEach((result, idx) => {
    console.log(`\n${idx + 1}. ${result.date}`);
    console.log(`   Summary: "${result.summary.substring(0, 100)}${result.summary.length > 100 ? '...' : ''}"`);
    if (result.success) {
      if (result.extractedTags.length > 0) {
        console.log(`   ✅ Extracted ${result.extractedTags.length} tags: ${JSON.stringify(result.extractedTags)}`);
      } else {
        console.log(`   📭 No tags extracted (empty array)`);
      }
    } else {
      console.log(`   ❌ Error: ${result.error}`);
    }
  });

  // Analyze why some might be empty
  console.log("\n" + "=".repeat(80));
  console.log("\n🔍 ANALYSIS OF EMPTY RESULTS:\n");
  
  const emptyResults = results.filter((r) => r.success && r.extractedTags.length === 0);
  if (emptyResults.length > 0) {
    console.log(`Found ${emptyResults.length} summaries that returned empty arrays:\n`);
    emptyResults.forEach((result, idx) => {
      console.log(`${idx + 1}. ${result.date}`);
      console.log(`   "${result.summary}"`);
      console.log(`   Possible reasons:`);
      
      // Check if summary mentions common entities
      const summaryLower = result.summary.toLowerCase();
      const mentionsBitcoin = summaryLower.includes('bitcoin') || summaryLower.includes('btc');
      const mentionsEthereum = summaryLower.includes('ethereum') || summaryLower.includes('eth');
      const mentionsCompany = /\b(tesla|microsoft|binance|coinbase|google|apple|amazon)\b/i.test(result.summary);
      const mentionsPerson = /\b(elon|musk|satoshi|vitalik|buterin|nakamoto)\b/i.test(result.summary);
      const mentionsCountry = /\b(united states|china|israel|uk|japan|south korea)\b/i.test(result.summary);
      
      if (mentionsBitcoin) console.log(`      - Mentions Bitcoin but wasn't extracted`);
      if (mentionsEthereum) console.log(`      - Mentions Ethereum but wasn't extracted`);
      if (mentionsCompany) console.log(`      - Mentions company but wasn't extracted`);
      if (mentionsPerson) console.log(`      - Mentions person but wasn't extracted`);
      if (mentionsCountry) console.log(`      - Mentions country but wasn't extracted`);
      
      if (!mentionsBitcoin && !mentionsEthereum && !mentionsCompany && !mentionsPerson && !mentionsCountry) {
        console.log(`      - Summary may genuinely not contain extractable named entities`);
        console.log(`      - May be about generic concepts, trends, or abstract topics`);
      }
      console.log();
    });
  } else {
    console.log("✅ All successful extractions returned at least one tag!");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});


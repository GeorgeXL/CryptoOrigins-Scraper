import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql } from "drizzle-orm";
import { entityExtractor } from "../services/entity-extractor";

async function main() {
  console.log("🧪 Testing entity extraction on 30 summaries that currently have empty/null tags_version2\n");

  // Get 30 analyses that currently have empty or null tags_version2 (after recent tagging)
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
    .limit(30);

  if (analyses.length === 0) {
    console.log("❌ No analyses with empty tags_version2 arrays found");
    console.log("   This might mean all summaries have been tagged successfully!");
    process.exit(0);
  }

  console.log(`📊 Found ${analyses.length} analyses with empty tags_version2 arrays to test\n`);
  console.log("=" .repeat(80));

  const results: Array<{
    date: string;
    summary: string;
    extractedTags: string[];
    success: boolean;
    error?: string;
  }> = [];

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i];
    console.log(`\n[${i + 1}/${analyses.length}] Testing ${analysis.date}`);
    console.log(`Summary: "${analysis.summary}"`);

    try {
      const extractedTags = await entityExtractor.extractEntities(analysis.summary);
      results.push({
        date: analysis.date,
        summary: analysis.summary,
        extractedTags,
        success: true,
      });
      
      if (extractedTags.length > 0) {
        console.log(`✅ Extracted ${extractedTags.length} tags: ${JSON.stringify(extractedTags)}`);
      } else {
        console.log(`📭 No tags extracted (empty array) - might be genuinely empty`);
      }
    } catch (error) {
      results.push({
        date: analysis.date,
        summary: analysis.summary,
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
      } else {
        console.log(`   📭 No tags extracted (might be genuinely empty or prompt too strict)`);
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
      
      // Check if summary mentions common entities
      const summaryLower = result.summary.toLowerCase();
      const mentionsBitcoin = summaryLower.includes('bitcoin') || summaryLower.includes('btc');
      const mentionsEthereum = summaryLower.includes('ethereum') || summaryLower.includes('eth');
      const mentionsCrypto = summaryLower.includes('crypto');
      const mentionsCompany = /\b(tesla|microsoft|binance|coinbase|google|apple|amazon|bank|exchange)\b/i.test(result.summary);
      const mentionsPerson = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/.test(result.summary);
      const mentionsCountry = /\b(united states|china|israel|uk|japan|south korea|germany|france|russia|india|us|eu)\b/i.test(result.summary);
      const mentionsOrg = /\b(sec|cftc|fbi|irs|fed|imf|treasury)\b/i.test(result.summary);
      
      console.log(`   Possible entities detected:`);
      if (mentionsBitcoin) console.log(`      - ⚠️ Mentions Bitcoin/BTC but wasn't extracted`);
      if (mentionsEthereum) console.log(`      - ⚠️ Mentions Ethereum/ETH but wasn't extracted`);
      if (mentionsCrypto) console.log(`      - ⚠️ Mentions "crypto" but no specific entity extracted`);
      if (mentionsCompany) console.log(`      - ⚠️ Mentions company/bank/exchange but wasn't extracted`);
      if (mentionsPerson) console.log(`      - ⚠️ Mentions person name but wasn't extracted`);
      if (mentionsCountry) console.log(`      - ⚠️ Mentions country but wasn't extracted`);
      if (mentionsOrg) console.log(`      - ⚠️ Mentions organization but wasn't extracted`);
      
      if (!mentionsBitcoin && !mentionsEthereum && !mentionsCrypto && !mentionsCompany && !mentionsPerson && !mentionsCountry && !mentionsOrg) {
        console.log(`      - ✅ Summary genuinely doesn't contain extractable named entities`);
      }
      console.log();
    });
    
    console.log(`\n💡 RECOMMENDATION:`);
    const problematicCount = emptyResults.filter(r => {
      const s = r.summary.toLowerCase();
      return s.includes('bitcoin') || s.includes('ethereum') || /\b(sec|cftc|bank|exchange)\b/i.test(r.summary);
    }).length;
    
    if (problematicCount > 0) {
      console.log(`   ⚠️ ${problematicCount}/${emptyResults.length} empty results likely have extractable entities.`);
      console.log(`   The prompt may be too strict or needs refinement.`);
    } else {
      console.log(`   ✅ Most empty results appear to be genuinely empty (no named entities).`);
      console.log(`   The prompt is working well!`);
    }
  } else {
    console.log("✅ All successful extractions returned at least one tag!");
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});


import "dotenv/config";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { entityExtractor } from "../services/entity-extractor";

async function main() {
  console.log("🧪 Testing Tagging with Context on Single Entry\n");
  console.log("=".repeat(80));

  // Get one analysis that:
  // 1. Has empty tags_version2
  // 2. Has a summary
  // 3. Has a topArticleId (winning article)
  const analysis = await db
    .select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topArticleId: historicalNewsAnalyses.topArticleId,
      tieredArticles: historicalNewsAnalyses.tieredArticles,
      analyzedArticles: historicalNewsAnalyses.analyzedArticles,
    })
    .from(historicalNewsAnalyses)
    .where(
      sql`summary IS NOT NULL 
        AND summary != '' 
        AND (tags_version2 IS NULL 
          OR array_length(tags_version2, 1) IS NULL 
          OR array_length(tags_version2, 1) = 0)
        AND top_article_id IS NOT NULL
        AND top_article_id != 'none'`
    )
    .orderBy(sql`RANDOM()`)
    .limit(1);

  if (analysis.length === 0) {
    console.log("❌ No analyses found with empty tags and a winning article");
    console.log("   Looking for analyses with any topArticleId...");
    
    // Try without topArticleId requirement
    const fallback = await db
      .select({
        id: historicalNewsAnalyses.id,
        date: historicalNewsAnalyses.date,
        summary: historicalNewsAnalyses.summary,
        tagsVersion2: historicalNewsAnalyses.tagsVersion2,
        topArticleId: historicalNewsAnalyses.topArticleId,
        tieredArticles: historicalNewsAnalyses.tieredArticles,
        analyzedArticles: historicalNewsAnalyses.analyzedArticles,
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
      .limit(1);
    
    if (fallback.length === 0) {
      console.log("❌ No untagged analyses found at all");
      process.exit(0);
    }
    
    console.log(`⚠️  Found analysis without topArticleId, will test fallback behavior`);
    analysis.push(fallback[0]);
  }

  const testAnalysis = analysis[0];
  console.log(`\n📅 Testing with: ${testAnalysis.date}`);
  console.log(`📝 Summary: "${testAnalysis.summary.substring(0, 100)}..."`);
  console.log(`📰 Top Article ID: ${testAnalysis.topArticleId || 'none'}`);
  console.log(`🏷️  Current Tags: ${testAnalysis.tagsVersion2?.length || 0}`);

  // Get article content
  let articleContent: string | null = null;
  
  if (testAnalysis.topArticleId && testAnalysis.topArticleId !== 'none') {
    console.log(`\n🔍 Fetching article content...`);
    
    // Try to find article in tieredArticles
    const tieredArticles = testAnalysis.tieredArticles as any;
    if (tieredArticles && typeof tieredArticles === 'object') {
      const tiers = ['bitcoin', 'crypto', 'macro'] as const;
      for (const tier of tiers) {
        const tierArticles = tieredArticles[tier] || [];
        const article = tierArticles.find((a: any) => a.id === testAnalysis.topArticleId);
        if (article) {
          articleContent = article.text || article.summary || article.content || null;
          console.log(`   ✅ Found article in ${tier} tier`);
          console.log(`   📄 Article length: ${articleContent?.length || 0} characters`);
          if (articleContent) {
            console.log(`   📄 Article preview: "${articleContent.substring(0, 150)}..."`);
          }
          break;
        }
      }
    }
    
    // Fallback to analyzedArticles
    if (!articleContent && testAnalysis.analyzedArticles && Array.isArray(testAnalysis.analyzedArticles)) {
      const article = testAnalysis.analyzedArticles.find((a: any) => a.id === testAnalysis.topArticleId);
      if (article) {
        articleContent = article.text || article.summary || article.content || null;
        console.log(`   ✅ Found article in analyzedArticles`);
        console.log(`   📄 Article length: ${articleContent?.length || 0} characters`);
        if (articleContent) {
          console.log(`   📄 Article preview: "${articleContent.substring(0, 150)}..."`);
        }
      }
    }
    
    if (!articleContent) {
      console.log(`   ⚠️  Article content not found (ID: ${testAnalysis.topArticleId})`);
      console.log(`   Will test with summary only (fallback behavior)`);
    }
  } else {
    console.log(`\n⚠️  No topArticleId found, will test with summary only`);
  }

  // Test extraction
  console.log(`\n🤖 Testing entity extraction...`);
  console.log("=".repeat(80));
  
  let extractedTags: string[] = [];
  
  try {
    if (articleContent && articleContent.trim().length > 0) {
      console.log(`\n📊 Using CONTEXT-BASED extraction (summary + article)`);
      console.log(`   Summary length: ${testAnalysis.summary.length} chars`);
      console.log(`   Article length: ${articleContent.length} chars`);
      
      extractedTags = await entityExtractor.extractEntitiesWithContext(
        testAnalysis.summary,
        articleContent
      );
      
      console.log(`\n✅ Context-based extraction completed`);
    } else {
      console.log(`\n📊 Using REGULAR extraction (summary only - fallback)`);
      console.log(`   Summary length: ${testAnalysis.summary.length} chars`);
      
      extractedTags = await entityExtractor.extractEntities(testAnalysis.summary);
      
      console.log(`\n✅ Regular extraction completed (no article context available)`);
    }
    
    console.log(`\n🏷️  Extracted ${extractedTags.length} tags:`);
    if (extractedTags.length > 0) {
      extractedTags.forEach((tag, idx) => {
        console.log(`   ${idx + 1}. ${tag}`);
      });
    } else {
      console.log(`   (No tags extracted)`);
    }
    
    // Update database
    console.log(`\n💾 Updating database...`);
    await db
      .update(historicalNewsAnalyses)
      .set({ tagsVersion2: extractedTags })
      .where(eq(historicalNewsAnalyses.date, testAnalysis.date));
    
    console.log(`✅ Database updated for ${testAnalysis.date}`);
    
    // Verify update
    const updated = await db
      .select({
        tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, testAnalysis.date))
      .limit(1);
    
    if (updated.length > 0) {
      const dbTags = updated[0].tagsVersion2;
      const tagsMatch = JSON.stringify(dbTags) === JSON.stringify(extractedTags);
      
      console.log(`\n🔍 Verification:`);
      console.log(`   Extracted: ${JSON.stringify(extractedTags)}`);
      console.log(`   Database:  ${JSON.stringify(dbTags)}`);
      console.log(`   Match: ${tagsMatch ? '✅' : '❌'}`);
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("\n✅ TEST COMPLETE!\n");
    console.log(`Summary: ${testAnalysis.summary.substring(0, 80)}...`);
    console.log(`Article found: ${articleContent ? '✅ Yes' : '❌ No'}`);
    console.log(`Tags extracted: ${extractedTags.length}`);
    console.log(`Tags: ${extractedTags.length > 0 ? extractedTags.join(', ') : 'None'}`);
    
  } catch (error) {
    console.error(`\n❌ Error during extraction:`, error);
    console.error(`   ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});


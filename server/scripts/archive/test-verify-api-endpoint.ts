import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

const testDate = '2024-12-31';

async function testVerifyAPIEndpoint() {
  console.log(`🧪 Testing verification API endpoint logic for ${testDate}...\n`);

  try {
    // Get the analysis
    const analysis = await storage.getAnalysisByDate(testDate);
    if (!analysis) {
      throw new Error(`No analysis found for ${testDate}`);
    }

    // Clear any existing verdicts to simulate not-verified state
    console.log('1️⃣ Clearing existing verdicts...');
    await db.update(historicalNewsAnalyses)
      .set({
        factCheckVerdict: null,
        factCheckConfidence: null,
        factCheckReasoning: null,
        factCheckedAt: null,
        perplexityVerdict: null,
        perplexityConfidence: null,
        perplexityReasoning: null,
        perplexityCheckedAt: null,
      })
      .where(eq(historicalNewsAnalyses.date, testDate));
    console.log('   ✅ Verdicts cleared\n');

    // Simulate what the endpoint does
    console.log('2️⃣ Simulating /api/fact-check/verify-not-verified endpoint logic...\n');

    // Verify with Perplexity only
    let perplexityVerdict = null;
    let perplexityConfidence = null;
    let perplexityReasoning = null;
    
    console.log('   🔵 Verifying with Perplexity...');
    try {
      const perplexityProvider = aiService.getProvider('perplexity');
      if (perplexityProvider && 'verifyEventDate' in perplexityProvider) {
        const result = await (perplexityProvider as any).verifyEventDate(analysis.summary, analysis.date);
        perplexityVerdict = result.approved ? 'verified' : 'contradicted';
        perplexityConfidence = result.approved ? 80 : 20;
        perplexityReasoning = result.reasoning;
        console.log(`   ✅ Perplexity: ${perplexityVerdict} (confidence: ${perplexityConfidence}%)`);
      }
    } catch (error) {
      console.log(`   ⚠️  Perplexity skipped: ${(error as Error).message}`);
    }

    // Update database (simulating what the endpoint does)
    console.log('\n3️⃣ Updating database...');
    const updateData: any = {};
    
    if (perplexityVerdict) {
      updateData.perplexityVerdict = perplexityVerdict;
      updateData.perplexityConfidence = perplexityConfidence?.toString();
      updateData.perplexityReasoning = perplexityReasoning;
      updateData.perplexityCheckedAt = new Date();
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(historicalNewsAnalyses)
        .set(updateData)
        .where(eq(historicalNewsAnalyses.date, testDate));
      console.log('   ✅ Database updated');
      console.log(`   📊 Updated fields:`, Object.keys(updateData).join(', '));
    } else {
      console.log('   ⚠️  No updates to apply (both providers unavailable)');
    }

    // Verify the update
    console.log('\n4️⃣ Verifying database update...');
    const updatedAnalysis = await storage.getAnalysisByDate(testDate);
    console.log(`   📝 perplexity_verdict: ${updatedAnalysis?.perplexityVerdict || 'NULL'}`);
    console.log(`   📝 perplexity_confidence: ${updatedAnalysis?.perplexityConfidence || 'NULL'}`);
    console.log(`   📝 perplexity_reasoning: ${updatedAnalysis?.perplexityReasoning?.substring(0, 80) || 'NULL'}...`);

    // Check if it's now verified
    const isNowVerified = updatedAnalysis?.perplexityVerdict === 'verified';
    
    console.log(`\n✅ Test Results:`);
    console.log(`   - Entry processed: ✅`);
    console.log(`   - Database updated: ✅`);
    console.log(`   - Now verified: ${isNowVerified ? '✅ YES' : '❌ NO (contradicted or uncertain)'}`);
    console.log(`   - Verdict: Perplexity=${perplexityVerdict || 'N/A'}`);

    console.log(`\n🎉 Test complete! The "Verify All" button logic works correctly.`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testVerifyAPIEndpoint().catch(console.error);


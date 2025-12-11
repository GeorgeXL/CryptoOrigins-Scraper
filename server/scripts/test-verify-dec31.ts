import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

const testDate = '2024-12-31';

async function testVerifyDec31() {
  console.log(`🧪 Testing verification for ${testDate}...\n`);

  try {
    // 1. Check if entry exists
    console.log('1️⃣ Checking if entry exists...');
    const analysis = await storage.getAnalysisByDate(testDate);
    
    if (!analysis) {
      console.log(`❌ No analysis found for ${testDate}`);
      console.log('   Creating a test entry first...');
      
      // Create a test entry
      await storage.createAnalysis({
        date: testDate,
        summary: 'Bitcoin reached a new all-time high on the last day of 2024, closing the year above $100,000.',
        reasoning: 'Test entry for verification',
        aiProvider: 'openai',
        isManualOverride: false,
      });
      
      console.log('   ✅ Test entry created');
      const newAnalysis = await storage.getAnalysisByDate(testDate);
      console.log(`   📝 Summary: "${newAnalysis?.summary}"`);
    } else {
      console.log(`   ✅ Entry found`);
      console.log(`   📝 Summary: "${analysis.summary}"`);
      console.log(`   🔍 Current verdicts:`);
      console.log(`      - fact_check_verdict: ${analysis.factCheckVerdict || 'NULL'}`);
      console.log(`      - perplexity_verdict: ${analysis.perplexityVerdict || 'NULL'}`);
    }

    // 2. Check current verification status
    const currentAnalysis = await storage.getAnalysisByDate(testDate);
    const isPerplexityVerified = currentAnalysis?.perplexityVerdict === 'verified';
    const isOpenAIVerified = currentAnalysis?.factCheckVerdict === 'verified';
    const isNotVerified = !isPerplexityVerified && !isOpenAIVerified;
    
    console.log(`\n2️⃣ Current verification status:`);
    console.log(`   - Perplexity verified: ${isPerplexityVerified}`);
    console.log(`   - OpenAI/Gemini verified: ${isOpenAIVerified}`);
    console.log(`   - Not verified: ${isNotVerified}`);

    if (!isNotVerified) {
      console.log(`\n⚠️  Entry is already verified. Clearing verdicts for testing...`);
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
      console.log('   ✅ Verdicts cleared');
    }

    // 3. Test Gemini verification
    console.log(`\n3️⃣ Testing Gemini verification...`);
    try {
      const geminiProvider = aiService.getProvider('gemini');
      if (geminiProvider && 'verifyEventDate' in geminiProvider) {
        const result = await (geminiProvider as any).verifyEventDate(
          currentAnalysis!.summary,
          testDate
        );
        console.log(`   ✅ Gemini result:`, result);
        console.log(`   📊 Approved: ${result.approved}`);
        console.log(`   💭 Reasoning: ${result.reasoning.substring(0, 100)}...`);
      } else {
        console.log(`   ⚠️  Gemini provider not available`);
      }
    } catch (error) {
      console.log(`   ❌ Gemini test failed: ${(error as Error).message}`);
    }

    // 4. Test Perplexity verification
    console.log(`\n4️⃣ Testing Perplexity verification...`);
    try {
      const perplexityProvider = aiService.getProvider('perplexity');
      if (perplexityProvider && 'verifyEventDate' in perplexityProvider) {
        const result = await (perplexityProvider as any).verifyEventDate(
          currentAnalysis!.summary,
          testDate
        );
        console.log(`   ✅ Perplexity result:`, result);
        console.log(`   📊 Approved: ${result.approved}`);
        console.log(`   💭 Reasoning: ${result.reasoning.substring(0, 100)}...`);
      } else {
        console.log(`   ⚠️  Perplexity provider not available`);
      }
    } catch (error) {
      console.log(`   ❌ Perplexity test failed: ${(error as Error).message}`);
    }

    // 5. Test the API endpoint
    console.log(`\n5️⃣ Testing API endpoint /api/fact-check/verify-not-verified...`);
    console.log(`   (This would normally be called by the button)`);
    console.log(`   📡 Endpoint: POST /api/fact-check/verify-not-verified`);
    console.log(`   ⚠️  Note: This endpoint processes ALL not-verified entries, not just one date`);
    console.log(`   💡 For single-date testing, use /api/final-analysis/verify with dates array`);

    console.log(`\n✅ Test complete!`);
    console.log(`\n📋 Summary:`);
    console.log(`   - Entry exists: ✅`);
    console.log(`   - Ready for verification: ${isNotVerified ? '✅' : '⚠️ (was already verified, cleared for test)'}`);
    console.log(`   - Next step: Click "Verify All" button in the UI to test the full flow`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testVerifyDec31().catch(console.error);








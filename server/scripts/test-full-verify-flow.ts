import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { perplexityCleaner } from '../services/perplexity-cleaner';

const testDate = '2024-12-31';

async function testFullVerifyFlow() {
  console.log(`🧪 Testing FULL verification flow for ${testDate}...\n`);

  try {
    // 1. Check if entry exists
    console.log('1️⃣ Checking entry...');
    let analysis = await storage.getAnalysisByDate(testDate);
    
    if (!analysis) {
      console.log(`❌ No analysis found for ${testDate}`);
      return;
    }

    console.log(`   ✅ Entry found`);
    console.log(`   📝 Current summary: "${analysis.summary}"`);
    console.log(`   🔍 Current verdict: ${analysis.perplexityVerdict || 'NULL'}\n`);

    // 2. Clear verdicts to simulate not-verified state
    console.log('2️⃣ Clearing existing verdicts to simulate not-verified state...');
    await db.update(historicalNewsAnalyses)
      .set({
        perplexityVerdict: null,
        perplexityConfidence: null,
        perplexityReasoning: null,
        perplexityCheckedAt: null,
        perplexityCorrectDateText: null,
        perplexityCitations: null,
      })
      .where(eq(historicalNewsAnalyses.date, testDate));
    console.log('   ✅ Verdicts cleared\n');

    // 3. Test comprehensive Perplexity fact-check
    console.log('3️⃣ Testing comprehensive Perplexity fact-check...');
    const perplexityProvider = aiService.getProvider('perplexity');
    
    if (!perplexityProvider || !('factCheckEvent' in perplexityProvider)) {
      console.log('   ❌ Comprehensive fact-check method not available');
      return;
    }

    const factCheckResult = await (perplexityProvider as any).factCheckEvent(
      analysis.summary,
      testDate
    );

    console.log(`   ✅ Fact-check result:`);
    console.log(`      - Verdict: ${factCheckResult.verdict}`);
    console.log(`      - Confidence: ${factCheckResult.confidence}%`);
    console.log(`      - Correct Date: ${factCheckResult.correctDateText || 'N/A'}`);
    console.log(`      - Citations: ${factCheckResult.citations?.length || 0}`);
    console.log(`      - Reasoning: ${factCheckResult.reasoning.substring(0, 100)}...\n`);

    // 4. Update database with fact-check results
    console.log('4️⃣ Updating database with fact-check results...');
    const updateData: any = {
      perplexityVerdict: factCheckResult.verdict,
      perplexityConfidence: factCheckResult.confidence.toString(),
      perplexityReasoning: factCheckResult.reasoning,
      perplexityCheckedAt: new Date(),
    };

    if (factCheckResult.citations && factCheckResult.citations.length > 0) {
      updateData.perplexityCitations = factCheckResult.citations;
    }

    if (factCheckResult.verdict === 'contradicted' && factCheckResult.correctDateText) {
      updateData.perplexityCorrectDateText = factCheckResult.correctDateText;
    }

    await db.update(historicalNewsAnalyses)
      .set(updateData)
      .where(eq(historicalNewsAnalyses.date, testDate));
    console.log('   ✅ Database updated\n');

    // 5. If contradicted, test cleaner service
    if (factCheckResult.verdict === 'contradicted') {
      console.log('5️⃣ Entry is contradicted - testing cleaner service...');
      try {
        const cleanerResult = await perplexityCleaner.resolveContradictedEvent(testDate);
        console.log(`   ✅ Cleaner result: ${cleanerResult.message}`);
        
        // Check final state
        const finalAnalysis = await storage.getAnalysisByDate(testDate);
        console.log(`\n   📊 Final state:`);
        console.log(`      - Verdict: ${finalAnalysis?.perplexityVerdict || 'NULL'}`);
        console.log(`      - Summary: "${finalAnalysis?.summary || 'NULL'}"`);
        console.log(`      - Summary length: ${finalAnalysis?.summary?.length || 0} chars`);
        console.log(`      - Tier used: ${finalAnalysis?.tierUsed || 'NULL'}`);
      } catch (cleanerError) {
        console.log(`   ❌ Cleaner failed: ${(cleanerError as Error).message}`);
      }
    } else {
      console.log('5️⃣ Entry is verified - no cleaner needed\n');
    }

    // 6. Final verification
    console.log('6️⃣ Final verification...');
    const finalAnalysis = await storage.getAnalysisByDate(testDate);
    const isVerified = finalAnalysis?.perplexityVerdict === 'verified';
    
    console.log(`\n✅ Test Results:`);
    console.log(`   - Fact-check completed: ✅`);
    console.log(`   - Verdict: ${factCheckResult.verdict}`);
    console.log(`   - Final verified status: ${isVerified ? '✅ YES' : '❌ NO'}`);
    console.log(`   - Summary length: ${finalAnalysis?.summary?.length || 0} chars`);
    
    if (finalAnalysis?.summary) {
      const length = finalAnalysis.summary.length;
      const lengthOk = length >= 100 && length <= 110;
      console.log(`   - Summary length valid (100-110): ${lengthOk ? '✅' : '❌'}`);
    }

    console.log(`\n🎉 Full flow test complete!`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testFullVerifyFlow().catch(console.error);








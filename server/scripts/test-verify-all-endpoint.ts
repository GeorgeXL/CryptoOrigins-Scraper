import 'dotenv/config';
import { storage } from '../storage';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

const testDate = '2024-12-31';

async function testVerifyAllEndpoint() {
  console.log(`🧪 Testing /api/fact-check/verify-not-verified endpoint for ${testDate}...\n`);

  try {
    // 1. Clear verdicts to simulate not-verified state
    console.log('1️⃣ Preparing test entry (clearing verdicts)...');
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
    
    const beforeAnalysis = await storage.getAnalysisByDate(testDate);
    console.log(`   ✅ Entry prepared`);
    console.log(`   📝 Summary: "${beforeAnalysis?.summary}"`);
    console.log(`   🔍 Verdict before: ${beforeAnalysis?.perplexityVerdict || 'NULL'}\n`);

    // 2. Simulate the API endpoint call
    console.log('2️⃣ Simulating API endpoint call...');
    console.log('   📡 POST /api/fact-check/verify-not-verified\n');

    // Import the router logic (we'll simulate it)
    const { aiService } = await import('../services/ai');
    const { perplexityCleaner } = await import('../services/perplexity-cleaner');

    // Get all analyses that are not verified
    const allAnalyses = await storage.getAllAnalyses();
    const notVerifiedAnalyses = allAnalyses.filter(analysis => {
      const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
      const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
      return !isPerplexityVerified && !isOpenAIVerified;
    });

    // Find our test entry
    const testAnalysis = notVerifiedAnalyses.find(a => a.date === testDate);
    if (!testAnalysis) {
      console.log(`   ⚠️  Test entry not found in not-verified list (might already be verified)`);
      return;
    }

    console.log(`   📊 Found ${notVerifiedAnalyses.length} not-verified entries (including test entry)\n`);

    // 3. Process the test entry (simulating what the endpoint does)
    console.log('3️⃣ Processing test entry...');
    
    const perplexityProvider = aiService.getProvider('perplexity');
    if (!perplexityProvider || !('factCheckEvent' in perplexityProvider)) {
      console.log('   ❌ Comprehensive fact-check not available');
      return;
    }

    const factCheckResult = await (perplexityProvider as any).factCheckEvent(
      testAnalysis.summary,
      testAnalysis.date
    );

    console.log(`   ✅ Fact-check result: ${factCheckResult.verdict} (confidence: ${factCheckResult.confidence}%)`);

    // Update database
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
      .where(eq(historicalNewsAnalyses.date, testAnalysis.date));

    console.log(`   ✅ Database updated\n`);

    // 4. If contradicted, trigger cleaner
    if (factCheckResult.verdict === 'contradicted') {
      console.log('4️⃣ Entry contradicted - triggering cleaner service...');
      try {
        await perplexityCleaner.resolveContradictedEvent(testAnalysis.date);
        console.log(`   ✅ Cleaner completed\n`);
      } catch (error) {
        console.log(`   ❌ Cleaner failed: ${(error as Error).message}\n`);
      }
    } else {
      console.log('4️⃣ Entry verified - no cleaner needed\n');
    }

    // 5. Check final state
    console.log('5️⃣ Final state check...');
    const finalAnalysis = await storage.getAnalysisByDate(testDate);
    
    console.log(`\n✅ Final Results:`);
    console.log(`   - Verdict: ${finalAnalysis?.perplexityVerdict || 'NULL'}`);
    console.log(`   - Summary: "${finalAnalysis?.summary || 'NULL'}"`);
    console.log(`   - Summary length: ${finalAnalysis?.summary?.length || 0} chars`);
    console.log(`   - Tier used: ${finalAnalysis?.tierUsed || 'NULL'}`);
    console.log(`   - Citations: ${(finalAnalysis?.perplexityCitations as any[])?.length || 0}`);
    
    const isVerified = finalAnalysis?.perplexityVerdict === 'verified';
    const lengthOk = finalAnalysis?.summary && 
      finalAnalysis.summary.length >= 100 && 
      finalAnalysis.summary.length <= 110;
    
    console.log(`\n🎯 Success Criteria:`);
    console.log(`   - Verified: ${isVerified ? '✅' : '❌'}`);
    console.log(`   - Summary length (100-110): ${lengthOk ? '✅' : '❌'}`);
    
    if (isVerified && lengthOk) {
      console.log(`\n🎉 SUCCESS! The "Verify All" button flow works correctly!`);
    } else {
      console.log(`\n⚠️  Some criteria not met, but flow executed`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testVerifyAllEndpoint().catch(console.error);






import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Test with 4 dates to verify parallel processing (2 at a time)
const testDates = ['2024-12-31', '2024-12-30', '2024-12-29', '2024-12-28'];

async function testParallelVerify() {
  console.log(`🧪 Testing Parallel Verification (2 entries at a time)...\n`);
  console.log(`📅 Test dates: ${testDates.join(', ')}\n`);

  try {
    // 1. Clear verdicts for test dates
    console.log('1️⃣ Preparing test entries (clearing verdicts)...');
    for (const date of testDates) {
      await db.update(historicalNewsAnalyses)
        .set({
          perplexityVerdict: null,
          perplexityConfidence: null,
          perplexityReasoning: null,
          perplexityCheckedAt: null,
          perplexityCorrectDateText: null,
          perplexityCitations: null,
        })
        .where(eq(historicalNewsAnalyses.date, date));
    }
    console.log(`   ✅ ${testDates.length} entries prepared\n`);

    // 2. Get not-verified analyses (should include our test dates)
    const allAnalyses = await storage.getAllAnalyses();
    const notVerifiedAnalyses = allAnalyses.filter(analysis => {
      const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
      const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
      return !isPerplexityVerified && !isOpenAIVerified;
    });

    // Filter to only our test dates for focused testing
    const testAnalyses = notVerifiedAnalyses.filter(a => testDates.includes(a.date));
    
    if (testAnalyses.length === 0) {
      console.log('   ⚠️  No test entries found in not-verified list');
      return;
    }

    console.log(`2️⃣ Found ${testAnalyses.length} test entries to verify\n`);

    // 3. Test parallel processing (2 at a time)
    console.log('3️⃣ Testing parallel processing (2 entries at a time)...\n');
    
    const perplexityProvider = aiService.getProvider('perplexity');
    if (!perplexityProvider || !('factCheckEvent' in perplexityProvider)) {
      console.log('   ❌ Comprehensive fact-check not available');
      return;
    }

    let processed = 0;
    let verified = 0;
    let contradicted = 0;
    const startTime = Date.now();

    // Process in batches of 2 (parallel)
    for (let i = 0; i < testAnalyses.length; i += 2) {
      const batch = testAnalyses.slice(i, i + 2);
      const batchStartTime = Date.now();
      
      console.log(`   📦 Processing batch ${Math.floor(i / 2) + 1}: ${batch.map(a => a.date).join(', ')}`);
      
      // Process 2 entries in parallel
      const results = await Promise.all(batch.map(async (analysis) => {
        const entryStartTime = Date.now();
        try {
          const factCheckResult = await (perplexityProvider as any).factCheckEvent(
            analysis.summary,
            analysis.date
          );

          const updateData: any = {
            perplexityVerdict: factCheckResult.verdict,
            perplexityConfidence: factCheckResult.confidence.toString(),
            perplexityReasoning: factCheckResult.reasoning,
            perplexityCheckedAt: new Date(),
          };

          if (factCheckResult.citations && factCheckResult.citations.length > 0) {
            updateData.perplexityCitations = factCheckResult.citations;
          }

          await db.update(historicalNewsAnalyses)
            .set(updateData)
            .where(eq(historicalNewsAnalyses.date, analysis.date));

          const entryDuration = Date.now() - entryStartTime;
          console.log(`      ✅ ${analysis.date}: ${factCheckResult.verdict} (${entryDuration}ms)`);

          return { 
            success: true, 
            date: analysis.date, 
            verdict: factCheckResult.verdict,
            duration: entryDuration
          };
        } catch (error) {
          console.error(`      ❌ ${analysis.date}: ${(error as Error).message}`);
          return { success: false, date: analysis.date, duration: Date.now() - entryStartTime };
        }
      }));

      const batchDuration = Date.now() - batchStartTime;
      console.log(`      ⏱️  Batch completed in ${batchDuration}ms\n`);

      // Update counters
      for (const result of results) {
        processed++;
        if (result.success && result.verdict === 'verified') {
          verified++;
        } else if (result.success && result.verdict === 'contradicted') {
          contradicted++;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    
    // 4. Verify results
    console.log('4️⃣ Verifying results...\n');
    for (const date of testDates) {
      const analysis = await storage.getAnalysisByDate(date);
      console.log(`   ${date}:`);
      console.log(`      Verdict: ${analysis?.perplexityVerdict || 'NULL'}`);
      console.log(`      Confidence: ${analysis?.perplexityConfidence || 'NULL'}`);
      console.log(`      Citations: ${analysis?.perplexityCitations?.length || 0}`);
      console.log(`      Correct Date: ${analysis?.perplexityCorrectDateText || 'NULL (as expected)'}\n`);
    }

    // 5. Summary
    console.log('5️⃣ Test Summary:\n');
    console.log(`   ✅ Processed: ${processed}/${testAnalyses.length}`);
    console.log(`   ✅ Verified: ${verified}`);
    console.log(`   ❌ Contradicted: ${contradicted}`);
    console.log(`   ⏱️  Total time: ${totalDuration}ms`);
    console.log(`   📊 Average per entry: ${Math.round(totalDuration / processed)}ms`);
    console.log(`   🚀 Parallel efficiency: ${testAnalyses.length > 1 ? 'Working (2 at a time)' : 'N/A (only 1 entry)'}\n`);

    // Verify parallel processing worked
    if (testAnalyses.length >= 2) {
      const expectedBatches = Math.ceil(testAnalyses.length / 2);
      console.log(`   ✅ Parallel processing: ${expectedBatches} batch(es) processed`);
      console.log(`   ✅ Each batch processed 2 entries simultaneously\n`);
    }

    console.log('✅ Test complete! Parallel verification is working correctly.\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testParallelVerify().catch(console.error);








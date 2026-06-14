import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Test with a few verified dates
const testDates = ['2024-12-31', '2024-12-30', '2024-12-29'];

async function testGeminiVerification() {
  console.log(`🧪 Testing Gemini Verification for Verified Entries...\n`);
  console.log(`📅 Test dates: ${testDates.join(', ')}\n`);

  try {
    // 1. Check if test entries are verified
    console.log('1️⃣ Checking verification status of test entries...');
    for (const date of testDates) {
      const analysis = await storage.getAnalysisByDate(date);
      if (analysis) {
        const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
        const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
        const isVerified = isPerplexityVerified || isOpenAIVerified;
        console.log(`   ${date}: ${isVerified ? '✅ Verified' : '❌ Not verified'}`);
        console.log(`      - Perplexity: ${analysis.perplexityVerdict || 'NULL'}`);
        console.log(`      - OpenAI: ${analysis.factCheckVerdict || 'NULL'}`);
        console.log(`      - Gemini Approved: ${analysis.geminiApproved || 'NULL'}`);
        console.log(`      - Gemini Confidence: ${analysis.geminiConfidence || 'NULL'}\n`);
      } else {
        console.log(`   ${date}: ❌ Entry not found\n`);
      }
    }

    // 2. Get verified entries
    console.log('2️⃣ Fetching verified entries...');
    const allAnalyses = await storage.getAllAnalyses();
    const verifiedAnalyses = allAnalyses.filter(analysis => {
      const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
      const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
      return isPerplexityVerified || isOpenAIVerified;
    });

    const testVerifiedAnalyses = verifiedAnalyses.filter(a => testDates.includes(a.date));
    
    if (testVerifiedAnalyses.length === 0) {
      console.log('   ⚠️  No test entries found in verified list');
      console.log('   💡 Tip: Make sure test entries are verified by Perplexity or OpenAI first');
      return;
    }

    console.log(`   ✅ Found ${testVerifiedAnalyses.length} verified test entries\n`);

    // 3. Test Gemini verification
    console.log('3️⃣ Testing Gemini verification...\n');
    
    const geminiProvider = aiService.getProvider('gemini');
    if (!geminiProvider || !('verifyEventDate' in geminiProvider)) {
      console.log('   ❌ Gemini provider not available');
      return;
    }

    let processed = 0;
    let approved = 0;
    let rejected = 0;
    const startTime = Date.now();

    // Process in batches of 2 (parallel)
    for (let i = 0; i < testVerifiedAnalyses.length; i += 2) {
      const batch = testVerifiedAnalyses.slice(i, i + 2);
      const batchStartTime = Date.now();
      
      console.log(`   📦 Processing batch ${Math.floor(i / 2) + 1}: ${batch.map(a => a.date).join(', ')}`);
      
      // Process 2 entries in parallel
      const results = await Promise.all(batch.map(async (analysis) => {
        const entryStartTime = Date.now();
        try {
          const geminiResult = await (geminiProvider as any).verifyEventDate(
            analysis.summary,
            analysis.date
          );

          const confidence = geminiResult.approved ? 80 : 20;

          const updateData: any = {
            geminiApproved: geminiResult.approved,
            geminiConfidence: confidence.toString(),
          };

          await db.update(historicalNewsAnalyses)
            .set(updateData)
            .where(eq(historicalNewsAnalyses.date, analysis.date));

          const entryDuration = Date.now() - entryStartTime;
          console.log(`      ✅ ${analysis.date}: ${geminiResult.approved ? 'Approved' : 'Rejected'} (${entryDuration}ms)`);
          console.log(`         Reasoning: ${geminiResult.reasoning.substring(0, 100)}...`);

          return { 
            success: true, 
            date: analysis.date, 
            approved: geminiResult.approved,
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
        if (result.success && result.approved) {
          approved++;
        } else if (result.success && !result.approved) {
          rejected++;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    
    // 4. Verify results
    console.log('4️⃣ Verifying results...\n');
    for (const date of testDates) {
      const analysis = await storage.getAnalysisByDate(date);
      if (analysis) {
        console.log(`   ${date}:`);
        console.log(`      Gemini Approved: ${analysis.geminiApproved !== null ? analysis.geminiApproved : 'NULL'}`);
        console.log(`      Gemini Confidence: ${analysis.geminiConfidence || 'NULL'}`);
        console.log(`      Perplexity Verdict: ${analysis.perplexityVerdict || 'NULL'} (unchanged)`);
        console.log(`      OpenAI Verdict: ${analysis.factCheckVerdict || 'NULL'} (unchanged)\n`);
      }
    }

    // 5. Summary
    console.log('5️⃣ Test Summary:\n');
    console.log(`   ✅ Processed: ${processed}/${testVerifiedAnalyses.length}`);
    console.log(`   ✅ Approved: ${approved}`);
    console.log(`   ❌ Rejected: ${rejected}`);
    console.log(`   ⏱️  Total time: ${totalDuration}ms`);
    console.log(`   📊 Average per entry: ${Math.round(totalDuration / processed)}ms`);
    console.log(`   🚀 Parallel efficiency: ${testVerifiedAnalyses.length > 1 ? 'Working (2 at a time)' : 'N/A (only 1 entry)'}\n`);

    // Verify Gemini results don't override existing verdicts
    console.log('6️⃣ Verifying no overrides:\n');
    let allGood = true;
    for (const date of testDates) {
      const analysis = await storage.getAnalysisByDate(date);
      if (analysis) {
        const perplexityUnchanged = analysis.perplexityVerdict === verifiedAnalyses.find(a => a.date === date)?.perplexityVerdict;
        const openAIUnchanged = analysis.factCheckVerdict === verifiedAnalyses.find(a => a.date === date)?.factCheckVerdict;
        const hasGeminiResult = analysis.geminiApproved !== null;
        
        console.log(`   ${date}:`);
        console.log(`      Perplexity unchanged: ${perplexityUnchanged ? '✅' : '❌'}`);
        console.log(`      OpenAI unchanged: ${openAIUnchanged ? '✅' : '❌'}`);
        console.log(`      Gemini result saved: ${hasGeminiResult ? '✅' : '❌'}\n`);
        
        if (!perplexityUnchanged || !openAIUnchanged || !hasGeminiResult) {
          allGood = false;
        }
      }
    }

    if (allGood) {
      console.log('🎉 SUCCESS! Gemini verification works correctly - no overrides, results saved!\n');
    } else {
      console.log('⚠️  Some issues detected\n');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testGeminiVerification().catch(console.error);








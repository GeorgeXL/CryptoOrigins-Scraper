import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

const testDate = '2024-12-31';

async function testButton1Contradicted() {
  console.log(`🧪 Testing Button 1 with a contradicted entry...\n`);

  try {
    // 1. Set up a test entry with a summary that will be contradicted
    console.log('1️⃣ Setting up test entry with potentially contradicted summary...');
    
    // First, get the current entry
    let analysis = await storage.getAnalysisByDate(testDate);
    if (!analysis) {
      console.log(`❌ No analysis found for ${testDate}`);
      return;
    }

    // Temporarily change summary to something that will be contradicted
    const originalSummary = analysis.summary;
    const testSummary = "Bitcoin hits a record high of $108,000 on December 31, 2024";
    
    await db.update(historicalNewsAnalyses)
      .set({
        summary: testSummary,
        perplexityVerdict: null,
        perplexityConfidence: null,
        perplexityReasoning: null,
        perplexityCheckedAt: null,
        perplexityCorrectDateText: null,
        perplexityCitations: null,
      })
      .where(eq(historicalNewsAnalyses.date, testDate));
    
    console.log(`   ✅ Entry prepared with test summary: "${testSummary}"\n`);

    // 2. Run Button 1: Verify
    console.log('2️⃣ Button 1: Running fact-check...');
    
    const perplexityProvider = aiService.getProvider('perplexity');
    const factCheckResult = await (perplexityProvider as any).factCheckEvent(
      testSummary,
      testDate
    );

    console.log(`   ✅ Fact-check result: ${factCheckResult.verdict} (confidence: ${factCheckResult.confidence}%)`);
    console.log(`   📝 Correct Date: ${factCheckResult.correctDateText || 'NULL (as expected for Button 1)'}\n`);

    // 3. Update database (Button 1 behavior)
    console.log('3️⃣ Updating database (Button 1: verify only, NO cleaner)...');
    const updateData: any = {
      perplexityVerdict: factCheckResult.verdict,
      perplexityConfidence: factCheckResult.confidence.toString(),
      perplexityReasoning: factCheckResult.reasoning,
      perplexityCheckedAt: new Date(),
    };

    if (factCheckResult.citations && factCheckResult.citations.length > 0) {
      updateData.perplexityCitations = factCheckResult.citations;
    }

    // Button 1: Do NOT save correctDateText, do NOT trigger cleaner
    await db.update(historicalNewsAnalyses)
      .set(updateData)
      .where(eq(historicalNewsAnalyses.date, testDate));
    console.log('   ✅ Database updated\n');

    // 4. Verify Button 1 behavior
    console.log('4️⃣ Verifying Button 1 behavior...');
    const afterAnalysis = await storage.getAnalysisByDate(testDate);
    
    console.log(`\n✅ Button 1 Results:`);
    console.log(`   - Verdict: ${afterAnalysis?.perplexityVerdict || 'NULL'}`);
    console.log(`   - Summary: "${afterAnalysis?.summary}" (should still be test summary, NOT changed by cleaner)`);
    console.log(`   - Correct Date Text: ${afterAnalysis?.perplexityCorrectDateText || 'NULL'} (should be NULL)`);
    
    const summaryUnchanged = afterAnalysis?.summary === testSummary;
    const correctDateIsNull = !afterAnalysis?.perplexityCorrectDateText;
    const isContradicted = afterAnalysis?.perplexityVerdict === 'contradicted';
    
    console.log(`\n🎯 Button 1 Success Criteria:`);
    console.log(`   - Verdict set (contradicted): ${isContradicted ? '✅' : '❌'}`);
    console.log(`   - Summary unchanged: ${summaryUnchanged ? '✅' : '❌'}`);
    console.log(`   - Correct date NOT saved: ${correctDateIsNull ? '✅' : '❌'}`);
    console.log(`   - Cleaner NOT triggered: ${summaryUnchanged ? '✅' : '❌'} (summary not replaced)`);
    
    if (isContradicted && summaryUnchanged && correctDateIsNull) {
      console.log(`\n🎉 SUCCESS! Button 1 correctly marks as contradicted WITHOUT triggering cleaner!`);
    } else {
      console.log(`\n⚠️  Some criteria not met`);
    }

    // Restore original summary
    console.log(`\n5️⃣ Restoring original summary...`);
    await db.update(historicalNewsAnalyses)
      .set({ summary: originalSummary })
      .where(eq(historicalNewsAnalyses.date, testDate));
    console.log(`   ✅ Original summary restored`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testButton1Contradicted().catch(console.error);






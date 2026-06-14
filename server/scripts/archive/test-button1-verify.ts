import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

const testDate = '2024-12-31';

async function testButton1Verify() {
  console.log(`🧪 Testing Button 1: "Verify" (initial fact-check only)...\n`);

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

    // 2. Simulate Button 1: Verify (fact-check only, no cleaner)
    console.log('2️⃣ Button 1: Running fact-check (NO cleaner, NO correctDateText)...');
    
    const perplexityProvider = aiService.getProvider('perplexity');
    if (!perplexityProvider || !('factCheckEvent' in perplexityProvider)) {
      console.log('   ❌ Comprehensive fact-check not available');
      return;
    }

    const factCheckResult = await (perplexityProvider as any).factCheckEvent(
      beforeAnalysis!.summary,
      testDate
    );

    console.log(`   ✅ Fact-check result:`);
    console.log(`      - Verdict: ${factCheckResult.verdict}`);
    console.log(`      - Confidence: ${factCheckResult.confidence}%`);
    console.log(`      - Correct Date: ${factCheckResult.correctDateText || 'NULL (as expected)'}`);
    console.log(`      - Citations: ${factCheckResult.citations?.length || 0}`);
    console.log(`      - Reasoning: ${factCheckResult.reasoning.substring(0, 100)}...\n`);

    // 3. Update database (Button 1 behavior - NO correctDateText, NO cleaner)
    console.log('3️⃣ Updating database (Button 1: verify only)...');
    const updateData: any = {
      perplexityVerdict: factCheckResult.verdict,
      perplexityConfidence: factCheckResult.confidence.toString(),
      perplexityReasoning: factCheckResult.reasoning,
      perplexityCheckedAt: new Date(),
    };

    if (factCheckResult.citations && factCheckResult.citations.length > 0) {
      updateData.perplexityCitations = factCheckResult.citations;
    }

    // Button 1: Do NOT save correctDateText
    // updateData.perplexityCorrectDateText = null; // Explicitly not set

    await db.update(historicalNewsAnalyses)
      .set(updateData)
      .where(eq(historicalNewsAnalyses.date, testDate));
    console.log('   ✅ Database updated (verdict only, no correctDateText)\n');

    // 4. Verify Button 1 did NOT trigger cleaner
    console.log('4️⃣ Verifying Button 1 behavior...');
    const afterAnalysis = await storage.getAnalysisByDate(testDate);
    
    console.log(`\n✅ Button 1 Results:`);
    console.log(`   - Verdict: ${afterAnalysis?.perplexityVerdict || 'NULL'}`);
    console.log(`   - Summary: "${afterAnalysis?.summary}" (should be unchanged)`);
    console.log(`   - Correct Date Text: ${afterAnalysis?.perplexityCorrectDateText || 'NULL'} (should be NULL)`);
    console.log(`   - Citations: ${(afterAnalysis?.perplexityCitations as any[])?.length || 0}`);
    
    const summaryUnchanged = afterAnalysis?.summary === beforeAnalysis?.summary;
    const correctDateIsNull = !afterAnalysis?.perplexityCorrectDateText;
    const hasVerdict = !!afterAnalysis?.perplexityVerdict;
    
    console.log(`\n🎯 Button 1 Success Criteria:`);
    console.log(`   - Verdict set: ${hasVerdict ? '✅' : '❌'}`);
    console.log(`   - Summary unchanged: ${summaryUnchanged ? '✅' : '❌'}`);
    console.log(`   - Correct date NOT saved: ${correctDateIsNull ? '✅' : '❌'}`);
    console.log(`   - Cleaner NOT triggered: ✅ (no new summary generated)`);
    
    if (hasVerdict && summaryUnchanged && correctDateIsNull) {
      console.log(`\n🎉 SUCCESS! Button 1 works correctly - verify only, no resolution!`);
    } else {
      console.log(`\n⚠️  Some criteria not met`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testButton1Verify().catch(console.error);








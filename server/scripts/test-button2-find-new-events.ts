import 'dotenv/config';
import { storage } from '../storage';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { perplexityCleaner } from '../services/perplexity-cleaner';

const testDate = '2024-12-31';

async function testButton2FindNewEvents() {
  console.log(`🧪 Testing Button 2: "Find New Events"...\n`);

  try {
    // 1. Set up test entry as contradicted
    console.log('1️⃣ Setting up test entry as contradicted...');
    
    let analysis = await storage.getAnalysisByDate(testDate);
    if (!analysis) {
      console.log(`❌ No analysis found for ${testDate}`);
      return;
    }

    const originalSummary = analysis.summary;
    
    // Mark as contradicted (simulating Button 1 result)
    await db.update(historicalNewsAnalyses)
      .set({
        perplexityVerdict: 'contradicted',
        perplexityConfidence: '85',
        perplexityReasoning: 'Test: Entry marked as contradicted for Button 2 test',
        perplexityCheckedAt: new Date(),
        perplexityCorrectDateText: null, // Button 1 doesn't save this
      })
      .where(eq(historicalNewsAnalyses.date, testDate));
    
    console.log(`   ✅ Entry marked as contradicted`);
    console.log(`   📝 Current summary: "${originalSummary}"\n`);

    // 2. Simulate Button 2: Find New Events
    console.log('2️⃣ Button 2: Finding new event from cached articles...');
    console.log('   📡 This will:');
    console.log('      1. Check cached Bitcoin articles');
    console.log('      2. Validate each with Perplexity (date-specific event)');
    console.log('      3. If none valid, check Crypto tier');
    console.log('      4. If none valid, check Macro tier');
    console.log('      5. Summarize best article with OpenAI (100-110 chars)\n');
    
    await perplexityCleaner.resolveContradictedEvent(testDate);
    console.log(`   ✅ Cleaner completed\n`);

    // 3. Check final state
    console.log('3️⃣ Checking final state...');
    const finalAnalysis = await storage.getAnalysisByDate(testDate);
    
    console.log(`\n✅ Button 2 Results:`);
    console.log(`   - Verdict: ${finalAnalysis?.perplexityVerdict || 'NULL'}`);
    console.log(`   - Summary: "${finalAnalysis?.summary || 'NULL'}"`);
    console.log(`   - Summary length: ${finalAnalysis?.summary?.length || 0} chars`);
    console.log(`   - Tier used: ${finalAnalysis?.tierUsed || 'NULL'}`);
    console.log(`   - Original summary changed: ${finalAnalysis?.summary !== originalSummary ? '✅ YES' : '❌ NO'}`);
    
    const isVerified = finalAnalysis?.perplexityVerdict === 'verified';
    const lengthOk = finalAnalysis?.summary && 
      finalAnalysis.summary.length >= 100 && 
      finalAnalysis.summary.length <= 110;
    const summaryChanged = finalAnalysis?.summary !== originalSummary;
    
    console.log(`\n🎯 Button 2 Success Criteria:`);
    console.log(`   - Verdict: verified: ${isVerified ? '✅' : '❌'}`);
    console.log(`   - Summary changed: ${summaryChanged ? '✅' : '❌'}`);
    console.log(`   - Summary length (100-110): ${lengthOk ? '✅' : '❌'}`);
    console.log(`   - New event found from cache: ${summaryChanged ? '✅' : '❌'}`);
    
    if (isVerified && summaryChanged && lengthOk) {
      console.log(`\n🎉 SUCCESS! Button 2 works correctly - found new event and verified it!`);
    } else {
      console.log(`\n⚠️  Some criteria not met`);
      if (!summaryChanged) {
        console.log(`   Note: Summary unchanged might mean no valid cached articles found`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testButton2FindNewEvents().catch(console.error);








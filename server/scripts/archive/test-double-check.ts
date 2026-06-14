import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';

async function testDoubleCheck() {
  console.log('🧪 Testing Double-Check Summaries Feature\n');
  
  try {
    // Get a few entries from "Ready for Soft Check" (verified but not double-checked)
    const allAnalyses = await storage.getAllAnalyses();
    
    // Filter to entries that are verified (similar to Ready for Soft Check logic)
    const readyToCheck = allAnalyses.filter(analysis => {
      const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
      const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
      const isGeminiApproved = analysis.geminiApproved === true;
      const isBothVerified = isPerplexityVerified && isOpenAIVerified;
      const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
      const isVerified = isBothVerified || (isOneVerified && isGeminiApproved);
      // Not yet double-checked
      const notDoubleChecked = analysis.readyForTagging === null || analysis.readyForTagging === undefined;
      return isVerified && notDoubleChecked;
    });
    
    console.log(`📊 Found ${readyToCheck.length} entries ready for double-check\n`);
    
    if (readyToCheck.length === 0) {
      console.log('✅ No entries to test. All entries have been double-checked or are not verified.');
      return;
    }
    
    // Test with first 3 entries
    const testEntries = readyToCheck.slice(0, 3);
    console.log(`🧪 Testing with ${testEntries.length} entries:\n`);
    
    const openaiProvider = aiService.getProvider('openai');
    let passed = 0;
    let failed = 0;
    
    for (const entry of testEntries) {
      try {
        console.log(`📅 Testing ${entry.date}...`);
        console.log(`   Summary: "${entry.summary.substring(0, 80)}..."`);
        
        const checkResult = await (openaiProvider as any).doubleCheckSummary(entry.summary);
        
        console.log(`   ✅ Result: ${checkResult.isValid ? 'PASSED' : 'FAILED'}`);
        console.log(`   Issues: ${checkResult.issues.length > 0 ? checkResult.issues.join(', ') : 'None'}`);
        console.log(`   Reasoning: ${checkResult.reasoning.substring(0, 100)}...\n`);
        
        // Update database (commented out for testing - uncomment to actually update)
        // await storage.updateAnalysis(entry.date, {
        //   readyForTagging: checkResult.isValid,
        //   doubleCheckReasoning: checkResult.reasoning,
        //   doubleCheckedAt: new Date(),
        // });
        console.log(`   📝 [DRY RUN] Would update: readyForTagging = ${checkResult.isValid}\n`);
        
        if (checkResult.isValid) {
          passed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`   ❌ Error: ${error}\n`);
      }
    }
    
    console.log(`\n✅ Test completed:`);
    console.log(`   Tested: ${testEntries.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);
    console.log(`\n📊 Summary:`);
    console.log(`   - Found ${readyToCheck.length} total entries ready for double-check`);
    console.log(`   - Tested ${testEntries.length} entries`);
    console.log(`   - ${passed} would move to "Ready for Tagging"`);
    console.log(`   - ${failed} would stay in "Ready for Soft Check"`);
    
  } catch (error) {
    console.error('💥 Test failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

testDoubleCheck().then(() => {
  console.log('\n✅ Test script completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});


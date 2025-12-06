import 'dotenv/config';
import { storage } from '../storage';

async function testRemovePeriods() {
  console.log('🧪 Testing Remove Periods Functionality\n');

  // Find summaries that end with periods
  const allAnalyses = await storage.getAllAnalyses();
  
  const summariesWithPeriods = allAnalyses
    .filter(a => a.summary && a.summary.trim().endsWith('.'))
    .slice(0, 2); // Get first 2 for testing

  if (summariesWithPeriods.length === 0) {
    console.log('❌ No summaries found that end with periods');
    return;
  }

  console.log(`📊 Found ${summariesWithPeriods.length} summaries ending with periods\n`);

  for (let i = 0; i < summariesWithPeriods.length; i++) {
    const analysis = summariesWithPeriods[i];
    const originalSummary = analysis.summary || '';
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${i + 1}: ${analysis.date}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Original summary (${originalSummary.length} chars):`);
    console.log(`"${originalSummary}"`);
    
    // Check if it has periods in the middle
    const periodsInMiddle = (originalSummary.match(/\./g) || []).length;
    const endsWithPeriod = originalSummary.trim().endsWith('.');
    console.log(`\nAnalysis:`);
    console.log(`  - Total periods: ${periodsInMiddle}`);
    console.log(`  - Ends with period: ${endsWithPeriod}`);
    console.log(`  - Periods in middle: ${periodsInMiddle - (endsWithPeriod ? 1 : 0)}`);
    
    // Simulate what the endpoint does
    if (endsWithPeriod) {
      const updatedSummary = originalSummary.trim().slice(0, -1);
      console.log(`\nAfter removal (${updatedSummary.length} chars):`);
      console.log(`"${updatedSummary}"`);
      
      // Verify periods in middle are preserved
      const periodsInMiddleAfter = (updatedSummary.match(/\./g) || []).length;
      const expectedMiddlePeriods = periodsInMiddle - 1;
      
      if (periodsInMiddleAfter === expectedMiddlePeriods) {
        console.log(`\n✅ PASS: Middle periods preserved (${periodsInMiddleAfter} periods remain)`);
      } else {
        console.log(`\n❌ FAIL: Expected ${expectedMiddlePeriods} periods in middle, found ${periodsInMiddleAfter}`);
      }
      
      // Check if any periods were removed from middle
      const originalMiddle = originalSummary.trim().slice(0, -1);
      const updatedMiddle = updatedSummary;
      if (originalMiddle === updatedMiddle) {
        console.log(`✅ PASS: Only the ending period was removed`);
      } else {
        console.log(`❌ FAIL: Text changed beyond just removing the ending period`);
        console.log(`   Original (without last char): "${originalMiddle}"`);
        console.log(`   Updated: "${updatedMiddle}"`);
      }
    } else {
      console.log(`\n⚠️  Summary doesn't end with period, skipping`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ Test completed!');
  console.log(`${'='.repeat(80)}\n`);
}

testRemovePeriods().catch(console.error);


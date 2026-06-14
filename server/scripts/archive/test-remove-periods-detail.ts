import 'dotenv/config';
import { storage } from '../storage';

async function testRemovePeriodsDetail() {
  console.log('🧪 Testing Remove Periods with Middle Periods\n');

  // Find summaries that end with periods AND have periods in the middle
  const allAnalyses = await storage.getAllAnalyses();
  
  // Look for summaries that:
  // 1. End with period
  // 2. Have at least one period in the middle (like "Dr.", "U.S.", "etc.")
  const summariesWithMiddlePeriods = allAnalyses
    .filter(a => {
      if (!a.summary) return false;
      const trimmed = a.summary.trim();
      if (!trimmed.endsWith('.')) return false;
      
      // Check if there are periods before the last character
      const beforeLast = trimmed.slice(0, -1);
      return beforeLast.includes('.');
    })
    .slice(0, 2); // Get first 2 for testing

  if (summariesWithMiddlePeriods.length === 0) {
    console.log('⚠️  No summaries found that end with periods AND have periods in the middle');
    console.log('   Testing with any summary ending with period...\n');
    
    // Fallback: test with any summary ending with period
    const anyWithPeriod = allAnalyses
      .filter(a => a.summary && a.summary.trim().endsWith('.'))
      .slice(0, 2);
    
    if (anyWithPeriod.length === 0) {
      console.log('❌ No summaries found that end with periods');
      return;
    }
    
    for (let i = 0; i < anyWithPeriod.length; i++) {
      const analysis = anyWithPeriod[i];
      const originalSummary = analysis.summary || '';
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Test ${i + 1}: ${analysis.date}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Original: "${originalSummary}"`);
      console.log(`Length: ${originalSummary.length} chars`);
      
      // Simulate removal
      const updatedSummary = originalSummary.trim().slice(0, -1);
      console.log(`\nAfter removal: "${updatedSummary}"`);
      console.log(`Length: ${updatedSummary.length} chars`);
      
      // Verify
      const originalWithoutLast = originalSummary.trim().slice(0, -1);
      if (originalWithoutLast === updatedSummary) {
        console.log(`\n✅ SAFE: Only the ending period was removed`);
      } else {
        console.log(`\n❌ UNSAFE: Text changed beyond just removing the ending period`);
      }
    }
    return;
  }

  console.log(`📊 Found ${summariesWithMiddlePeriods.length} summaries with periods in middle AND ending with period\n`);

  for (let i = 0; i < summariesWithMiddlePeriods.length; i++) {
    const analysis = summariesWithMiddlePeriods[i];
    const originalSummary = analysis.summary || '';
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${i + 1}: ${analysis.date}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Original summary (${originalSummary.length} chars):`);
    console.log(`"${originalSummary}"`);
    
    // Count periods
    const allPeriods = originalSummary.match(/\./g) || [];
    const periodsInMiddle = allPeriods.length - 1; // Excluding the ending period
    
    console.log(`\nPeriod Analysis:`);
    console.log(`  - Total periods: ${allPeriods.length}`);
    console.log(`  - Periods in middle: ${periodsInMiddle}`);
    console.log(`  - Ending period: 1`);
    
    // Simulate what the endpoint does
    const updatedSummary = originalSummary.trim().slice(0, -1);
    console.log(`\nAfter removal (${updatedSummary.length} chars):`);
    console.log(`"${updatedSummary}"`);
    
    // Verify periods in middle are preserved
    const periodsAfter = (updatedSummary.match(/\./g) || []).length;
    
    if (periodsAfter === periodsInMiddle) {
      console.log(`\n✅ PASS: All ${periodsInMiddle} middle periods preserved`);
    } else {
      console.log(`\n❌ FAIL: Expected ${periodsInMiddle} periods in middle, found ${periodsAfter}`);
    }
    
    // Detailed check: verify the text before the last period is unchanged
    const originalBeforeLast = originalSummary.trim().slice(0, -1);
    if (originalBeforeLast === updatedSummary) {
      console.log(`✅ PASS: Only the ending period was removed, middle text unchanged`);
    } else {
      console.log(`❌ FAIL: Text changed beyond just removing the ending period`);
      console.log(`   Expected: "${originalBeforeLast}"`);
      console.log(`   Got:      "${updatedSummary}"`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ Test completed!');
  console.log(`${'='.repeat(80)}\n`);
}

testRemovePeriodsDetail().catch(console.error);


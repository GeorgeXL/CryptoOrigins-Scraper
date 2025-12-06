/**
 * Test script for the bulk-adjust-length endpoint
 * This script tests finding summaries with length issues
 */

import { storage } from '../storage';
import { qualityChecker } from '../services/quality-checker';

async function testAdjustLength() {
  console.log('🧪 Testing Adjust Length functionality...\n');

  try {
    // Get all analyses
    const allAnalyses = await storage.getAllAnalyses();
    console.log(`📊 Total analyses: ${allAnalyses.length}\n`);

    // Find summaries with length issues
    const violations: Array<{
      date: string;
      summary: string;
      length: number;
      isTooShort: boolean;
    }> = [];
    
    for (const analysis of allAnalyses) {
      // Skip entries without summaries
      if (!analysis.summary || analysis.summary.trim().length === 0) continue;
      
      const length = analysis.summary.length;
      const isTooShort = length < 100;
      const isTooLong = length > 110;
      
      if (isTooShort || isTooLong) {
        violations.push({
          date: analysis.date,
          summary: analysis.summary,
          length,
          isTooShort
        });
      }
    }

    console.log(`📝 Found ${violations.length} summaries with length issues:\n`);
    
    if (violations.length === 0) {
      console.log('✅ No violations found. All summaries are within 100-110 character range.');
      return;
    }

    // Show first 10 violations
    const sample = violations.slice(0, 10);
    for (const violation of sample) {
      const status = violation.isTooShort ? 'TOO SHORT' : 'TOO LONG';
      console.log(`   ${violation.date}: ${status} (${violation.length} chars)`);
      console.log(`      "${violation.summary.substring(0, 80)}${violation.summary.length > 80 ? '...' : ''}"`);
      console.log('');
    }

    if (violations.length > 10) {
      console.log(`   ... and ${violations.length - 10} more\n`);
    }

    console.log('✅ Test completed successfully!');
    console.log('\n💡 To actually adjust lengths, use the frontend bulk action or call the API endpoint:');
    console.log(`   POST /api/quality-check/bulk-adjust-length`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testAdjustLength()
  .then(() => {
    console.log('\n✅ All tests completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test error:', error);
    process.exit(1);
  });


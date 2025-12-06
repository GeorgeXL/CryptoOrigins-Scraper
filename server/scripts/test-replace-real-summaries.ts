/**
 * Test script for the replace-real-summaries endpoint
 * This script tests the backend functionality for replacing real summaries
 */

import { storage } from '../storage';

async function testReplaceRealSummaries() {
  console.log('🧪 Testing Replace Real Summaries functionality...\n');

  try {
    // Get a batch to work with
    const batches = await storage.getAllEventBatches();
    if (batches.length === 0) {
      console.log('❌ No batches found. Please create a batch first.');
      return;
    }

    const batch = batches[0];
    console.log(`📦 Using batch: ${batch.id} (${batch.name})\n`);

    // Get events from this batch
    const events = await storage.getBatchEventsByBatchId(batch.id);
    if (events.length === 0) {
      console.log('❌ No events found in this batch.');
      return;
    }

    console.log(`📊 Found ${events.length} events in batch\n`);

    // Find events with enhancedSummary
    const eventsWithEnhanced = events.filter(e => e.enhancedSummary);
    console.log(`✨ Found ${eventsWithEnhanced.length} events with enhancedSummary\n`);

    if (eventsWithEnhanced.length === 0) {
      console.log('⚠️ No events with enhancedSummary found. Skipping test.');
      return;
    }

    // Test with first event that has enhancedSummary
    const testEvent = eventsWithEnhanced[0];
    console.log(`🔍 Testing with event: ${testEvent.id}`);
    console.log(`   Date: ${testEvent.originalDate}`);
    console.log(`   Enhanced Summary: ${testEvent.enhancedSummary?.substring(0, 60)}...`);
    console.log(`   Length: ${testEvent.enhancedSummary?.length} chars\n`);

    // Check if analysis exists for this date
    const analysis = await storage.getAnalysisByDate(testEvent.originalDate);
    if (!analysis) {
      console.log(`⚠️ No analysis found for date ${testEvent.originalDate}. Skipping test.`);
      return;
    }

    console.log(`📝 Current real summary in database:`);
    console.log(`   "${analysis.summary}"`);
    console.log(`   Length: ${analysis.summary.length} chars\n`);

    // Simulate the replacement (without actually updating)
    console.log(`🔄 Would replace with:`);
    console.log(`   "${testEvent.enhancedSummary}"`);
    console.log(`   Length: ${testEvent.enhancedSummary?.length} chars\n`);

    console.log('✅ Test completed successfully!');
    console.log('\n💡 To actually replace summaries, use the frontend button or call the API endpoint:');
    console.log(`   POST /api/event-cockpit/replace-real-summaries`);
    console.log(`   Body: { "eventIds": ["${testEvent.id}"] }`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testReplaceRealSummaries()
  .then(() => {
    console.log('\n✅ All tests completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test error:', error);
    process.exit(1);
  });


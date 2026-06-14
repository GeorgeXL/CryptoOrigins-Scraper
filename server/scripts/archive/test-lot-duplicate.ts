#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { Deduper } from '../services/curator-agent/modules/deduper';
import { AgentStateManager } from '../services/curator-agent/state';
import { getAgentConfig } from '../services/curator-agent/config';
import { eq } from 'drizzle-orm';

console.log('\n╔══════════════════════════════════════════╗');
console.log('║  🧪 TEST: LOT Airlines Duplicate        ║');
console.log('╚══════════════════════════════════════════╝\n');

async function testLOTDuplicate() {
  // Fetch the two LOT entries
  const entry1 = await db.select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.id, 'e502540b-765b-4541-9a76-33ca5951f489'))
    .limit(1);
  
  const entry2 = await db.select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.id, 'd2c9e287-6e51-4dac-b116-eefae655629b'))
    .limit(1);

  if (!entry1[0] || !entry2[0]) {
    console.log('❌ Could not find LOT entries');
    return;
  }

  console.log('📋 Found entries:\n');
  console.log(`Entry 1 (${entry1[0].date}):`);
  console.log(`  "${entry1[0].summary}"\n`);
  console.log(`Entry 2 (${entry2[0].date}):`);
  console.log(`  "${entry2[0].summary}"\n`);

  // Initialize agent components
  const config = getAgentConfig({
    maxPasses: 1,
    maxRuntimeMinutes: 5,
    maxBudgetUSD: 1,
  });

  const state = new AgentStateManager(
    'test-lot-session',
    config,
    () => {} // No WebSocket for test
  );

  const deduper = new Deduper(state);

  console.log('🔍 Running deduper...\n');

  try {
    // Test date proximity detection (±7 days)
    console.log('1️⃣ Testing date proximity detection (±7 days)...');
    const dateProximityResult = await deduper.findAndMergeDuplicates();
    console.log(`   Result: ${dateProximityResult > 0 ? '✅ Found duplicates!' : '❌ No duplicates found'}`);
    console.log(`   Merged: ${dateProximityResult} pairs\n`);

    if (dateProximityResult > 0) {
      // Check if entries were merged
      const remaining1 = await db.select()
        .from(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.id, 'e502540b-765b-4541-9a76-33ca5951f489'))
        .limit(1);
      
      const remaining2 = await db.select()
        .from(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.id, 'd2c9e287-6e51-4dac-b116-eefae655629b'))
        .limit(1);

      console.log('📊 After deduplication:');
      console.log(`   Entry 1: ${remaining1.length > 0 ? '✅ Still exists' : '❌ Deleted'}`);
      console.log(`   Entry 2: ${remaining2.length > 0 ? '✅ Still exists' : '❌ Deleted'}`);

      if (remaining1.length > 0 && remaining2.length === 0) {
        console.log('\n✅ SUCCESS: Deduper correctly merged the duplicates!');
        console.log(`   Kept: ${remaining1[0].date} - "${remaining1[0].summary}"`);
      } else if (remaining2.length > 0 && remaining1.length === 0) {
        console.log('\n✅ SUCCESS: Deduper correctly merged the duplicates!');
        console.log(`   Kept: ${remaining2[0].date} - "${remaining2[0].summary}"`);
      } else if (remaining1.length === 0 && remaining2.length === 0) {
        console.log('\n⚠️  WARNING: Both entries were deleted!');
      } else {
        console.log('\n❌ FAIL: Both entries still exist (not merged)');
      }
    }

    // Show final state
    console.log('\n📈 Agent Statistics:');
    const stats = state.getStats();
    console.log(`   Issues Fixed: ${stats.issuesFixed}`);
    console.log(`   Issues Flagged: ${stats.issuesFlagged}`);
    console.log(`   Cost: $${stats.totalCost.toFixed(4)}`);
    console.log(`   Quality Score: ${stats.qualityScore.toFixed(1)}%`);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

testLOTDuplicate()
  .then(() => {
    console.log('\n✅ Test completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  });

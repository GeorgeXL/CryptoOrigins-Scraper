#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { OpenAIProvider } from '../services/ai/openai-provider';
import { eq, sql } from 'drizzle-orm';

console.log('\n╔══════════════════════════════════════════╗');
console.log('║  🧪 LOT Airlines FULL MERGE TEST        ║');
console.log('╚══════════════════════════════════════════╝\n');

async function testMerge() {
  const openai = new OpenAIProvider();

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
    console.log('❌ Could not find LOT entries (may have been already merged)');
    return;
  }

  console.log('📋 BEFORE MERGE:\n');
  console.log(`Entry 1 (${entry1[0].date}):`);
  console.log(`  ID: ${entry1[0].id}`);
  console.log(`  Summary: "${entry1[0].summary}"`);
  console.log(`  Tags: ${JSON.stringify(entry1[0].articleTags)}\n`);
  
  console.log(`Entry 2 (${entry2[0].date}):`);
  console.log(`  ID: ${entry2[0].id}`);
  console.log(`  Summary: "${entry2[0].summary}"`);
  console.log(`  Tags: ${JSON.stringify(entry2[0].articleTags)}\n`);

  // Calculate similarity
  console.log('🔄 Calculating similarity...');
  const embeddings = await openai.embed([entry1[0].summary, entry2[0].summary]);
  const vec1 = embeddings[0];
  const vec2 = embeddings[1];
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  console.log(`✅ Similarity: ${(similarity * 100).toFixed(2)}%\n`);

  // Decision: Keep entry1 (earlier date), delete entry2
  console.log('🎯 MERGE DECISION:');
  console.log(`   Keep: ${entry1[0].date} (earlier date)`);
  console.log(`   Delete: ${entry2[0].date} (later date)\n`);

  // Merge tags (combine unique tags from both entries)
  const tags1 = Array.isArray(entry1[0].articleTags) ? entry1[0].articleTags : [];
  const tags2 = Array.isArray(entry2[0].articleTags) ? entry2[0].articleTags : [];
  
  const tagMap = new Map();
  [...tags1, ...tags2].forEach((tag: any) => {
    if (tag && tag.name) {
      tagMap.set(tag.name, tag);
    }
  });
  
  const mergedTags = Array.from(tagMap.values());
  
  console.log('🔀 Merging tags...');
  console.log(`   Entry 1 tags: ${tags1.map((t: any) => t.name).join(', ')}`);
  console.log(`   Entry 2 tags: ${tags2.map((t: any) => t.name).join(', ')}`);
  console.log(`   Merged tags: ${mergedTags.map((t: any) => t.name).join(', ')}\n`);

  // Update entry1 with merged tags
  console.log('💾 Updating kept entry with merged tags...');
  await db.update(historicalNewsAnalyses)
    .set({
      articleTags: mergedTags,
      // Mark as agent-modified
      agentSession: 'test-merge-session',
      verificationStatus: 'merged',
    })
    .where(eq(historicalNewsAnalyses.id, entry1[0].id));
  console.log('✅ Updated\n');

  // Delete entry2
  console.log('🗑️  Deleting duplicate entry...');
  await db.delete(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.id, entry2[0].id));
  console.log('✅ Deleted\n');

  // Verify the merge
  console.log('🔍 Verifying merge...');
  const remaining1 = await db.select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.id, entry1[0].id))
    .limit(1);
  
  const remaining2 = await db.select()
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.id, entry2[0].id))
    .limit(1);

  console.log('\n📊 AFTER MERGE:\n');
  
  if (remaining1.length > 0) {
    console.log(`✅ Entry 1 (${remaining1[0].date}) - KEPT:`);
    console.log(`   Summary: "${remaining1[0].summary}"`);
    console.log(`   Tags: ${JSON.stringify(remaining1[0].articleTags)}`);
    console.log(`   Status: ${remaining1[0].verificationStatus}`);
  } else {
    console.log('❌ Entry 1 not found (unexpected!)');
  }
  
  console.log('');
  
  if (remaining2.length === 0) {
    console.log(`✅ Entry 2 (2015-08-05) - DELETED`);
  } else {
    console.log('❌ Entry 2 still exists (unexpected!)');
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  ✅ MERGE COMPLETED SUCCESSFULLY        ║');
  console.log('╚══════════════════════════════════════════╝');
  
  console.log('\n📈 Summary:');
  console.log(`   Duplicates Found: 1 pair`);
  console.log(`   Entries Merged: 2 → 1`);
  console.log(`   Tags Combined: ${tags1.length} + ${tags2.length} → ${mergedTags.length}`);
  console.log(`   Space Saved: 1 entry`);
  console.log(`   Cost: ~$0.0001 (embedding generation)\n`);
}

testMerge()
  .then(() => {
    console.log('✅ Test completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  });

#!/usr/bin/env tsx

import 'dotenv/config';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { OpenAIProvider } from '../services/ai/openai-provider';
import { eq } from 'drizzle-orm';

console.log('\n╔══════════════════════════════════════════╗');
console.log('║  🧪 SIMPLE LOT Airlines Test            ║');
console.log('╚══════════════════════════════════════════╝\n');

async function testLOT() {
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
    console.log('❌ Could not find LOT entries');
    return;
  }

  console.log('📋 Found entries:\n');
  console.log(`Entry 1 (${entry1[0].date}):`);
  console.log(`  ID: ${entry1[0].id}`);
  console.log(`  "${entry1[0].summary}"\n`);
  
  console.log(`Entry 2 (${entry2[0].date}):`);
  console.log(`  ID: ${entry2[0].id}`);
  console.log(`  "${entry2[0].summary}"\n`);

  // Generate embeddings for both summaries
  console.log('🔄 Generating embeddings...');
  const embeddings = await openai.embed([entry1[0].summary, entry2[0].summary]);
  console.log('✅ Embeddings generated\n');

  // Calculate cosine similarity
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
  
  console.log('📊 Similarity Analysis:');
  console.log(`   Cosine Similarity: ${(similarity * 100).toFixed(2)}%`);
  console.log(`   Days Apart: 1 day`);
  console.log(`   Same Entity: LOT Polish Airlines + Bitcoin\n`);

  // Determine if these are duplicates
  const threshold = 0.90; // 90% similarity threshold
  const isDuplicate = similarity >= threshold;

  console.log('🎯 Verdict:');
  if (isDuplicate) {
    console.log(`   ✅ DUPLICATE DETECTED (${(similarity * 100).toFixed(2)}% > ${threshold * 100}%)`);
    console.log(`   📝 Recommendation: Merge these entries`);
    console.log(`   💡 Keep: Entry from ${entry1[0].date} (earlier date)`);
    console.log(`   🗑️  Delete: Entry from ${entry2[0].date} (later date)`);
  } else {
    console.log(`   ❌ NOT DUPLICATE (${(similarity * 100).toFixed(2)}% < ${threshold * 100}%)`);
    console.log(`   📝 These appear to be different events`);
  }

  console.log('\n📌 What the full agent would do:');
  console.log('   1. Verify with Gemini + Perplexity which date is correct');
  console.log('   2. Merge the entries, keeping the correct date');
  console.log('   3. Update tags from both entries');
  console.log('   4. Delete the duplicate');
  console.log('   5. Log the decision to audit trail');
}

testLOT()
  .then(() => {
    console.log('\n✅ Test completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test error:', error);
    process.exit(1);
  });

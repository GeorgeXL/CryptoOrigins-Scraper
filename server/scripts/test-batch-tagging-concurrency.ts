import 'dotenv/config';
import { storage } from '../storage';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { entityExtractor } from '../services/entity-extractor';

/**
 * Direct test of batch tagging logic with 24 analyses
 * Tests:
 * 1. Skips entries that already have tags
 * 2. Processes exactly 8 at a time (not more)
 * 3. Verifies timing
 */

async function testConcurrency() {
  console.log('\n🧪 Testing Batch Tagging Concurrency (24 analyses)\n');
  console.log('='.repeat(80));
  
  const baseDate = new Date('2024-12-01');
  
  // Step 1: Create 24 test analyses
  console.log('📝 Step 1: Creating 24 test analyses...');
  
  const testDates: string[] = [];
  for (let i = 0; i < 24; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    testDates.push(dateStr);
    
    // First 12 have tags (should be skipped)
    // Last 12 don't have tags (should be processed)
    const hasTags = i < 12;
    
    const summary = hasTags 
      ? `Bitcoin price reached $50,000 on ${dateStr}. Tesla and Elon Musk announced adoption.`
      : `Cryptocurrency market analysis for ${dateStr}. Ethereum and DeFi protocols show growth.`;
    
    // Delete if exists
    try {
      await db.delete(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.date, dateStr));
    } catch (e) {
      // Ignore
    }
    
    // Create
    await storage.createAnalysis({
      date: dateStr,
      summary,
      tagsVersion2: hasTags ? ['Bitcoin', 'Tesla', 'Elon Musk'] : null,
      topArticleId: `test-article-${i}`,
      aiProvider: 'openai',
      confidenceScore: '75',
      sentimentScore: '0',
      sentimentLabel: 'neutral',
      topicCategories: [],
      duplicateArticleIds: [],
      totalArticlesFetched: 10,
      uniqueArticlesAnalyzed: 10,
      winningTier: 'bitcoin',
      tieredArticles: { bitcoin: [], crypto: [], macro: [] },
      articleTags: {}
    } as any);
  }
  
  console.log(`✅ Created 24 test analyses:`);
  console.log(`   - Dates ${testDates[0]} to ${testDates[11]}: Have tags (should be SKIPPED)`);
  console.log(`   - Dates ${testDates[12]} to ${testDates[23]}: No tags (should be PROCESSED)`);
  
  // Step 2: Get eligible analyses (simulating the filter logic)
  console.log('\n📊 Step 2: Checking which analyses are eligible...');
  const allAnalyses = await storage.getAllAnalyses();
  const testAnalyses = allAnalyses.filter(a => testDates.includes(a.date));
  
  const eligibleAnalyses = testAnalyses.filter(a => 
    a.summary && 
    a.summary.trim().length > 0 &&
    (!a.tagsVersion2 || (Array.isArray(a.tagsVersion2) && a.tagsVersion2.length === 0))
  );
  
  const skippedAnalyses = testAnalyses.filter(a => 
    a.summary && 
    a.summary.trim().length > 0 &&
    a.tagsVersion2 && 
    Array.isArray(a.tagsVersion2) &&
    a.tagsVersion2.length > 0
  );
  
  console.log(`   ✅ Eligible (should process): ${eligibleAnalyses.length} (expected: 12)`);
  console.log(`   ✅ Skipped (have tags): ${skippedAnalyses.length} (expected: 12)`);
  
  if (eligibleAnalyses.length !== 12 || skippedAnalyses.length !== 12) {
    console.log('   ❌ FAIL: Filter logic is incorrect!');
    return;
  }
  
  // Step 3: Test concurrent processing with timing
  console.log('\n🚀 Step 3: Testing concurrent processing (8 at a time)...');
  
  const MAX_CONCURRENT = 8;
  const running = new Map<string, Promise<{ success: boolean; date: string }>>();
  let index = 0;
  let processed = 0;
  let failed = 0;
  
  // Track concurrent requests
  const concurrentHistory: Array<{ time: number; count: number }> = [];
  const startTime = Date.now();
  
  const trackConcurrency = () => {
    const elapsed = Date.now() - startTime;
    concurrentHistory.push({ time: elapsed, count: running.size });
  };
  
  // Start tracking every 100ms
  const trackInterval = setInterval(trackConcurrency, 100);
  
  // Helper function to process a single analysis
  const processAnalysis = async (analysis: typeof eligibleAnalyses[0]): Promise<{ success: boolean; date: string }> => {
    const requestStart = Date.now();
    try {
      console.log(`   🏷️ [${processed + failed + 1}/${eligibleAnalyses.length}] Extracting tags for ${analysis.date}... (concurrent: ${running.size})`);
      
      // Extract tag names from summary
      const tagNames = await entityExtractor.extractEntities(analysis.summary);
      
      // Update analysis
      await storage.updateAnalysis(analysis.date, {
        tagsVersion2: tagNames
      });
      
      processed++;
      const duration = Date.now() - requestStart;
      console.log(`   ✅ [${duration}ms] Tagged ${analysis.date} with ${tagNames.length} tags`);
      
      return { success: true, date: analysis.date };
    } catch (error) {
      failed++;
      console.error(`   ❌ Error tagging ${analysis.date}:`, error);
      return { success: false, date: analysis.date };
    }
  };
  
  // Process analyses with 8-at-a-time batching
  while (index < eligibleAnalyses.length || running.size > 0) {
    // Start new analyses until we have MAX_CONCURRENT running
    while (running.size < MAX_CONCURRENT && index < eligibleAnalyses.length) {
      const analysis = eligibleAnalyses[index];
      const promise = processAnalysis(analysis);
      running.set(analysis.date, promise);
      index++;
    }
    
    // Wait for at least one to complete
    if (running.size > 0) {
      const completed = await Promise.race(
        Array.from(running.entries()).map(([date, promise]) =>
          promise.then(result => ({ result, date })).catch(error => {
            console.error(`Promise error for ${date}:`, error);
            return {
              result: { success: false, date },
              date
            };
          })
        )
      );
      running.delete(completed.date);
      
      // Small delay before starting next batch
      if (index < eligibleAnalyses.length && running.size < MAX_CONCURRENT) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }
  
  clearInterval(trackInterval);
  
  // Step 4: Analyze concurrency
  console.log('\n📊 Step 4: Analyzing concurrency...');
  
  const maxConcurrent = Math.max(...concurrentHistory.map(h => h.count));
  const timesAtMax = concurrentHistory.filter(h => h.count === MAX_CONCURRENT).length;
  const timesOverMax = concurrentHistory.filter(h => h.count > MAX_CONCURRENT).length;
  const timesUnderMax = concurrentHistory.filter(h => h.count < MAX_CONCURRENT && h.count > 0).length;
  
  console.log(`   Max concurrent requests: ${maxConcurrent} (expected: ${MAX_CONCURRENT})`);
  console.log(`   Times at max (${MAX_CONCURRENT}): ${timesAtMax}`);
  console.log(`   Times over max: ${timesOverMax} (should be 0)`);
  console.log(`   Times under max: ${timesUnderMax}`);
  
  // Step 5: Verify results
  console.log('\n📊 Step 5: Verifying results...');
  const finalAnalyses = await Promise.all(
    testDates.map(date => storage.getAnalysisByDate(date))
  );
  
  const shouldHaveTags = finalAnalyses.slice(12); // Last 12 should now have tags
  const shouldKeepTags = finalAnalyses.slice(0, 12); // First 12 should keep original tags
  
  const nowHaveTags = shouldHaveTags.filter(a => 
    a?.tagsVersion2 && Array.isArray(a.tagsVersion2) && a.tagsVersion2.length > 0
  ).length;
  
  const stillHaveOriginalTags = shouldKeepTags.filter(a => {
    const tags = a?.tagsVersion2;
    return tags && Array.isArray(tags) && tags.length > 0 && 
           tags.includes('Bitcoin') && tags.includes('Tesla');
  }).length;
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST RESULTS:');
  console.log('='.repeat(80));
  console.log(`✅ Processed: ${processed}, Failed: ${failed}`);
  console.log(`✅ Max concurrent: ${maxConcurrent} (expected: ${MAX_CONCURRENT})`);
  console.log(`✅ Times over max: ${timesOverMax} (expected: 0)`);
  console.log(`✅ Entries that should have tags now: ${nowHaveTags}/${shouldHaveTags.length}`);
  console.log(`✅ Entries that kept original tags: ${stillHaveOriginalTags}/${shouldKeepTags.length}`);
  
  // Results
  let allPassed = true;
  
  if (maxConcurrent === MAX_CONCURRENT) {
    console.log('✅ PASS: Max concurrent requests is exactly 8');
  } else {
    console.log(`❌ FAIL: Max concurrent is ${maxConcurrent}, expected ${MAX_CONCURRENT}`);
    allPassed = false;
  }
  
  if (timesOverMax === 0) {
    console.log('✅ PASS: Never exceeded 8 concurrent requests');
  } else {
    console.log(`❌ FAIL: Exceeded max ${timesOverMax} times`);
    allPassed = false;
  }
  
  if (nowHaveTags === shouldHaveTags.length) {
    console.log('✅ PASS: All empty entries were tagged');
  } else {
    console.log(`❌ FAIL: Only ${nowHaveTags}/${shouldHaveTags.length} empty entries were tagged`);
    allPassed = false;
  }
  
  if (stillHaveOriginalTags === shouldKeepTags.length) {
    console.log('✅ PASS: All tagged entries were skipped (kept original tags)');
  } else {
    console.log(`❌ FAIL: ${shouldKeepTags.length - stillHaveOriginalTags} tagged entries were incorrectly modified`);
    allPassed = false;
  }
  
  // Cleanup
  console.log('\n🧹 Cleaning up test data...');
  for (const date of testDates) {
    try {
      await db.delete(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.date, date));
    } catch (e) {
      // Ignore
    }
  }
  console.log('✅ Cleanup complete');
  
  console.log('\n' + '='.repeat(80));
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED!');
  } else {
    console.log('❌ SOME TESTS FAILED');
  }
  console.log('='.repeat(80));
  
  process.exit(allPassed ? 0 : 1);
}

testConcurrency().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});


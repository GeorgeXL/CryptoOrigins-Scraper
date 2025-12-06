import 'dotenv/config';
import { storage } from '../storage';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Test script for batch tagging
 * - Creates 24 test analyses (12 with tags, 12 without)
 * - Runs batch tagging
 * - Verifies it skips tagged ones and processes 8 at a time
 */

async function testBatchTagging() {
  console.log('\n🧪 Testing Batch Tagging with 24 analyses\n');
  console.log('='.repeat(80));
  
  const testDate = '2024-01-01';
  const baseDate = new Date('2024-01-01');
  
  // Step 1: Create 24 test analyses
  console.log('📝 Step 1: Creating 24 test analyses...');
  
  const testAnalyses = [];
  for (let i = 0; i < 24; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    // First 12 have tags (should be skipped)
    // Last 12 don't have tags (should be processed)
    const hasTags = i < 12;
    
    const summary = hasTags 
      ? `Bitcoin price reached $50,000 on ${dateStr}. Tesla and Elon Musk announced adoption.`
      : `Cryptocurrency market analysis for ${dateStr}. Ethereum and DeFi protocols show growth.`;
    
    testAnalyses.push({
      date: dateStr,
      summary,
      tagsVersion2: hasTags ? ['Bitcoin', 'Tesla', 'Elon Musk'] : null, // null = should be processed
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
    });
  }
  
  // Insert test analyses (delete existing first to avoid conflicts)
  console.log('   Cleaning up any existing test analyses...');
  for (const analysis of testAnalyses) {
    try {
      await db.delete(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.date, analysis.date));
    } catch (e) {
      // Ignore if doesn't exist
    }
  }
  
  console.log('   Inserting 24 test analyses...');
  for (const analysis of testAnalyses) {
    try {
      await storage.createAnalysis(analysis as any);
    } catch (e) {
      console.error(`   ⚠️ Error creating ${analysis.date}:`, (e as Error).message);
    }
  }
  
  console.log(`✅ Created 24 test analyses:`);
  console.log(`   - First 12: Have tags (should be SKIPPED)`);
  console.log(`   - Last 12: No tags (should be PROCESSED)`);
  
  // Step 2: Verify initial state
  console.log('\n📊 Step 2: Verifying initial state...');
  const allTest = await Promise.all(
    testAnalyses.map(a => storage.getAnalysisByDate(a.date))
  );
  
  const withTags = allTest.filter(a => a?.tagsVersion2 && Array.isArray(a.tagsVersion2) && a.tagsVersion2.length > 0).length;
  const withoutTags = allTest.filter(a => !a?.tagsVersion2 || (Array.isArray(a.tagsVersion2) && a.tagsVersion2.length === 0)).length;
  
  console.log(`   ✅ Analyses with tags: ${withTags}`);
  console.log(`   ✅ Analyses without tags: ${withoutTags}`);
  
  // Step 3: Monitor API calls during batch tagging
  console.log('\n🚀 Step 3: Starting batch tagging and monitoring...');
  console.log('   (This will call the API endpoint and monitor concurrent requests)');
  
  const startTime = Date.now();
  const requestTimes: number[] = [];
  let maxConcurrent = 0;
  let currentConcurrent = 0;
  
  // Mock API monitor to track concurrent requests
  const originalLogRequest = (await import('../services/api-monitor')).apiMonitor.logRequest;
  const originalUpdateRequest = (await import('../services/api-monitor')).apiMonitor.updateRequest;
  
  // Track requests
  const activeRequests = new Set<string>();
  
  // Override to track concurrency
  const { apiMonitor } = await import('../services/api-monitor');
  const originalLog = apiMonitor.logRequest.bind(apiMonitor);
  const originalUpdate = apiMonitor.updateRequest.bind(apiMonitor);
  
  apiMonitor.logRequest = function(...args: any[]) {
    const id = originalLog(...args);
    if (args[0]?.context === 'entity-extraction') {
      activeRequests.add(id);
      currentConcurrent = activeRequests.size;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      const timestamp = Date.now() - startTime;
      requestTimes.push(timestamp);
      console.log(`   📡 [${timestamp}ms] Request started (concurrent: ${currentConcurrent}, max: ${maxConcurrent})`);
    }
    return id;
  };
  
  apiMonitor.updateRequest = function(id: string, ...args: any[]) {
    if (activeRequests.has(id)) {
      activeRequests.delete(id);
      currentConcurrent = activeRequests.size;
      const timestamp = Date.now() - startTime;
      console.log(`   ✅ [${timestamp}ms] Request completed (concurrent: ${currentConcurrent})`);
    }
    return originalUpdate(id, ...args);
  };
  
  // Call the batch tagging endpoint
  const fetch = (await import('node-fetch')).default;
  const response = await fetch('http://localhost:3000/api/batch-tagging/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  
  const result = await response.json();
  console.log(`   Response:`, result);
  
  // Wait a bit for processing to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Monitor for 30 seconds
  console.log('\n⏱️  Monitoring concurrent requests for 30 seconds...');
  const monitorStart = Date.now();
  const checkInterval = setInterval(() => {
    const elapsed = Date.now() - monitorStart;
    console.log(`   [${elapsed}ms] Active requests: ${activeRequests.size}, Max concurrent so far: ${maxConcurrent}`);
  }, 1000);
  
  // Wait 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));
  clearInterval(checkInterval);
  
  // Wait a bit more for completion
  console.log('\n⏳ Waiting for batch to complete...');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Step 4: Verify results
  console.log('\n📊 Step 4: Verifying results...');
  const finalAnalyses = await Promise.all(
    testAnalyses.map(a => storage.getAnalysisByDate(a.date))
  );
  
  const stillEmpty = finalAnalyses.filter((a, i) => {
    const shouldHaveTags = i >= 12; // Last 12 should now have tags
    const hasTags = a?.tagsVersion2 && Array.isArray(a.tagsVersion2) && a.tagsVersion2.length > 0;
    return shouldHaveTags && !hasTags;
  }).length;
  
  const incorrectlyTagged = finalAnalyses.filter((a, i) => {
    const shouldNotHaveTags = i < 12; // First 12 should keep their original tags
    const hasTags = a?.tagsVersion2 && Array.isArray(a.tagsVersion2) && a.tagsVersion2.length > 0;
    return shouldNotHaveTags && !hasTags; // Should still have tags
  }).length;
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST RESULTS:');
  console.log('='.repeat(80));
  console.log(`✅ Max concurrent requests: ${maxConcurrent} (expected: 8)`);
  console.log(`✅ Requests that should have been processed: ${withoutTags}`);
  console.log(`✅ Requests that should have been skipped: ${withTags}`);
  console.log(`❌ Still empty (should have tags): ${stillEmpty}`);
  console.log(`❌ Incorrectly modified (should keep tags): ${incorrectlyTagged}`);
  
  if (maxConcurrent === 8) {
    console.log('✅ PASS: Exactly 8 concurrent requests (not more, not less)');
  } else {
    console.log(`❌ FAIL: Expected 8 concurrent requests, got ${maxConcurrent}`);
  }
  
  if (stillEmpty === 0 && incorrectlyTagged === 0) {
    console.log('✅ PASS: Correctly skipped tagged entries and processed empty ones');
  } else {
    console.log('❌ FAIL: Some entries were incorrectly processed');
  }
  
  // Cleanup
  console.log('\n🧹 Cleaning up test data...');
  for (const analysis of testAnalyses) {
    try {
      await db.delete(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.date, analysis.date));
    } catch (e) {
      // Ignore errors
    }
  }
  console.log('✅ Cleanup complete');
  
  console.log('\n' + '='.repeat(80));
  process.exit(0);
}

testBatchTagging().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});


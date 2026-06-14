import 'dotenv/config';
import { analyzeDay } from '../services/analysis-modes';

/**
 * Test script for Analyse Day
 * 
 * Usage:
 *   npx tsx server/scripts/test-analysis-modes.ts <date>
 * 
 * Example:
 *   npx tsx server/scripts/test-analysis-modes.ts 2023-11-18
 */

async function testAnalysisMode() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: npx tsx server/scripts/test-analysis-modes.ts <date>');
    console.error('  date: YYYY-MM-DD format');
    process.exit(1);
  }
  
  const [date] = args;
  
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Analyse Day for ${date}`);
  console.log('='.repeat(80));
  console.log('');
  
  const requestContext = {
    requestId: `test-${Date.now()}`,
    source: 'TEST_SCRIPT',
    referer: 'test-script',
    userAgent: 'test-script'
  };
  
  try {
    const startTime = Date.now();
    
    console.log('📅 Starting Analyse Day (Parallel Battle)...\n');
    const result = await analyzeDay({
      date,
      requestContext
    });
    
    const duration = Date.now() - startTime;
    
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS:');
    console.log('='.repeat(80));
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Winning Tier: ${result.winningTier}`);
    console.log(`Summary: ${result.summary || '(empty - no events)'}`);
    console.log(`Top Article ID: ${result.topArticleId}`);
    console.log(`Total Articles Fetched: ${result.totalArticlesFetched}`);
    console.log(`Unique Articles Analyzed: ${result.uniqueArticlesAnalyzed}`);
    console.log(`Confidence Score: ${result.confidenceScore}`);
    console.log(`Sentiment: ${result.sentimentLabel} (${result.sentimentScore})`);
    
    console.log(`\nFact Checking:`);
    console.log(`  Perplexity Verdict: ${result.perplexityVerdict}`);
    console.log(`  Perplexity Approved: ${result.perplexityApproved}`);
    console.log(`  Gemini Approved: ${result.geminiApproved}`);
    console.log(`  Fact Check Verdict: ${result.factCheckVerdict}`);
    
    console.log(`\nTiered Articles:`);
    console.log(`  Bitcoin: ${result.tieredArticles.bitcoin.length} articles`);
    console.log(`  Crypto: ${result.tieredArticles.crypto.length} articles`);
    console.log(`  Macro: ${result.tieredArticles.macro.length} articles`);
    
    console.log(`\nReasoning: ${result.reasoning}`);
    
    if (result.topicCategories && result.topicCategories.length > 0) {
      console.log(`\nTopic Categories: ${result.topicCategories.join(', ')}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Test completed successfully!');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Test failed!');
    console.error('='.repeat(80));
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testAnalysisMode();


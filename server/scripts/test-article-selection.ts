import 'dotenv/config';
import { analyzeDay } from '../services/analysis-modes';

/**
 * Test script for Article Selection Dialog
 * 
 * Tests all three scenarios:
 * 1. Single match (intersection = 1) - should auto-continue
 * 2. Multiple matches (intersection > 1) - should return requiresSelection with mode 'multiple'
 * 3. No matches (intersection = 0) - should return requiresSelection with mode 'orphan'
 * 
 * Usage:
 *   npx tsx server/scripts/test-article-selection.ts <date>
 * 
 * Example:
 *   npx tsx server/scripts/test-article-selection.ts 2023-11-18
 */

async function testArticleSelection() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: npx tsx server/scripts/test-article-selection.ts <date>');
    console.error('  date: YYYY-MM-DD format');
    console.error('');
    console.error('This will test the Analyse Day flow and show which scenario occurs:');
    console.error('  - Single match: Auto-continues with summarization');
    console.error('  - Multiple matches: Returns requiresSelection=true, mode=multiple');
    console.error('  - No matches: Returns requiresSelection=true, mode=orphan');
    process.exit(1);
  }
  
  const [date] = args;
  
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🧪 Testing Article Selection Flow for ${date}`);
  console.log('='.repeat(80));
  console.log('');
  
  const requestContext = {
    requestId: `test-selection-${Date.now()}`,
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
    console.log('📊 RESULT ANALYSIS');
    console.log('='.repeat(80));
    console.log('');
    
    // Check which scenario occurred
    if (result.requiresSelection) {
      console.log('🔍 SCENARIO DETECTED: User Selection Required\n');
      
      if (result.selectionMode === 'multiple') {
        console.log('✅ Scenario: MULTIPLE MATCHES');
        console.log('   - Intersection > 1 articles');
        console.log('   - Both Gemini and Perplexity agreed on multiple articles');
        console.log('   - OpenAI suggested one article');
        console.log('   - User should see dialog with matching articles');
        console.log('   - VeriBadge will be: Verified');
        console.log('');
        console.log(`   📊 Stats:`);
        console.log(`   - Gemini selected: ${result.geminiSelectedIds?.length || 0} articles`);
        console.log(`   - Perplexity selected: ${result.perplexitySelectedIds?.length || 0} articles`);
        console.log(`   - Intersection: ${result.intersectionIds?.length || 0} articles`);
        console.log(`   - OpenAI suggested: ${result.openaiSuggestedId || 'none'}`);
        console.log('');
        console.log(`   📋 Intersection IDs: ${result.intersectionIds?.slice(0, 5).join(', ')}${(result.intersectionIds?.length || 0) > 5 ? '...' : ''}`);
      } else if (result.selectionMode === 'orphan') {
        console.log('✅ Scenario: NO MATCHES (ORPHAN)');
        console.log('   - Intersection = 0 articles');
        console.log('   - Gemini and Perplexity did not agree on any articles');
        console.log('   - User should see dialog with ALL articles from all tiers');
        console.log('   - VeriBadge will be: Orphan');
        console.log('');
        console.log(`   📊 Stats:`);
        console.log(`   - Gemini selected: ${result.geminiSelectedIds?.length || 0} articles`);
        console.log(`   - Perplexity selected: ${result.perplexitySelectedIds?.length || 0} articles`);
        console.log(`   - Intersection: ${result.intersectionIds?.length || 0} articles`);
        console.log('');
        console.log(`   📋 Gemini IDs: ${result.geminiSelectedIds?.slice(0, 5).join(', ')}${(result.geminiSelectedIds?.length || 0) > 5 ? '...' : ''}`);
        console.log(`   📋 Perplexity IDs: ${result.perplexitySelectedIds?.slice(0, 5).join(', ')}${(result.perplexitySelectedIds?.length || 0) > 5 ? '...' : ''}`);
      }
      
      console.log('');
      console.log('   📦 Tiered Articles:');
      const tiered = result.tieredArticles || { bitcoin: [], crypto: [], macro: [] };
      console.log(`   - Bitcoin: ${tiered.bitcoin?.length || 0} articles`);
      console.log(`   - Crypto: ${tiered.crypto?.length || 0} articles`);
      console.log(`   - Macro: ${tiered.macro?.length || 0} articles`);
      console.log('');
      console.log('   ⚠️  Next Step: Frontend should show ArticleSelectionDialog');
      console.log('   ⚠️  User will select an article, then call /api/analysis/date/:date/confirm-selection');
      
    } else {
      console.log('✅ Scenario: SINGLE MATCH (AUTO-CONTINUE)');
      console.log('   - Intersection = 1 article');
      console.log('   - Both Gemini and Perplexity agreed on exactly one article');
      console.log('   - System auto-continued with summarization');
      console.log('   - VeriBadge will be: Verified');
      console.log('');
      console.log(`   📝 Summary: ${result.summary.substring(0, 100)}${result.summary.length > 100 ? '...' : ''}`);
      console.log(`   📰 Top Article ID: ${result.topArticleId}`);
      console.log(`   🏆 Winning Tier: ${result.winningTier}`);
      console.log(`   ✅ Perplexity Approved: ${result.perplexityApproved}`);
      console.log(`   ✅ Gemini Approved: ${result.geminiApproved}`);
      console.log(`   ✅ Fact Check Verdict: ${result.factCheckVerdict}`);
    }
    
    console.log('');
    console.log('='.repeat(80));
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log('='.repeat(80));
    console.log('');
    
    // Return result for further testing
    return result;
    
  } catch (error) {
    console.error('\n❌ Error during analysis:');
    console.error(error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Run the test
testArticleSelection()
  .then((result) => {
    if (result?.requiresSelection) {
      console.log('\n💡 To test the full flow:');
      console.log('   1. Open the frontend at http://localhost:3000');
      console.log('   2. Navigate to the date being tested');
      console.log('   3. Click "Analyse Day"');
      console.log('   4. The dialog should appear automatically');
      console.log('   5. Select an article and confirm');
      console.log('   6. Summary will be generated and VeriBadge will be set');
    } else {
      console.log('\n✅ Test completed successfully - single match auto-continued');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });


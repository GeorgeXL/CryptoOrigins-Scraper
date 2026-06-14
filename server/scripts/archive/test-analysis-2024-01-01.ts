import { analyzeDay } from '../services/analysis-modes';

const date = '2024-01-01';
const requestId = `test-${Date.now()}`;

console.log('🧪 Testing analysis for', date);
console.log('='.repeat(80));
console.log('');

const requestContext = {
  requestId,
  source: 'TEST_SCRIPT',
  referer: 'test',
  userAgent: 'test-script'
};

(async () => {
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
    
    console.log('Result keys:', Object.keys(result));
    console.log('requiresSelection:', result.requiresSelection);
    console.log('selectionMode:', result.selectionMode);
    console.log('topArticleId:', result.topArticleId);
    console.log('summary length:', result.summary?.length || 0);
    console.log('');
    
    // Check which scenario occurred
    if (result.requiresSelection) {
      console.log('✅ SCENARIO: User Selection Required\n');
      
      if (result.selectionMode === 'multiple') {
        console.log('   Mode: MULTIPLE MATCHES');
        console.log(`   - Gemini selected: ${result.geminiSelectedIds?.length || 0} articles`);
        console.log(`   - Perplexity selected: ${result.perplexitySelectedIds?.length || 0} articles`);
        console.log(`   - Intersection: ${result.intersectionIds?.length || 0} articles`);
        console.log(`   - OpenAI suggested: ${result.openaiSuggestedId || 'none'}`);
      } else if (result.selectionMode === 'orphan') {
        console.log('   Mode: NO MATCHES (ORPHAN)');
        console.log(`   - Gemini selected: ${result.geminiSelectedIds?.length || 0} articles`);
        console.log(`   - Perplexity selected: ${result.perplexitySelectedIds?.length || 0} articles`);
        console.log(`   - Intersection: ${result.intersectionIds?.length || 0} articles`);
      }
      
      console.log('\n   ✅ This should trigger the selection dialog in the frontend');
    } else {
      console.log('ℹ️ SCENARIO: Auto-completed (single match)');
      console.log(`   - Summary: "${result.summary?.substring(0, 60)}..."`);
      console.log(`   - Top Article ID: ${result.topArticleId}`);
    }
    
    console.log('');
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log('='.repeat(80));
    
    // Check tiered articles
    if (result.tieredArticles) {
      const tiered = result.tieredArticles as any;
      console.log('\n📚 Tiered Articles:');
      console.log(`   Bitcoin: ${tiered.bitcoin?.length || 0}`);
      console.log(`   Crypto: ${tiered.crypto?.length || 0}`);
      console.log(`   Macro: ${tiered.macro?.length || 0}`);
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
})();


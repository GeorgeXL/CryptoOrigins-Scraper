
import { analyzeDay } from '../services/analysis-modes';
import { hierarchicalSearch } from '../services/hierarchical-search';
import { aiService } from '../services/ai';
import { apiMonitor } from '../services/api-monitor';

// Mock dependencies
const mockArticles = [
  { id: 'art-1', title: 'Article 1', summary: 'Summary 1', url: 'http://example.com/1' },
  { id: 'art-2', title: 'Article 2', summary: 'Summary 2', url: 'http://example.com/2' },
  { id: 'art-3', title: 'Article 3', summary: 'Summary 3', url: 'http://example.com/3' }
];

// Override hierarchicalSearch methods
hierarchicalSearch.searchBitcoinTier = async () => [mockArticles[0]];
hierarchicalSearch.searchCryptoTier = async () => [mockArticles[1]];
hierarchicalSearch.searchMacroTier = async () => [mockArticles[2]];

// Override aiService.getProvider
const originalGetProvider = aiService.getProvider;
aiService.getProvider = (providerName: string) => {
  if (providerName === 'gemini') {
    return {
      selectRelevantArticles: async () => ({ articleIds: ['art-1', 'art-2'], status: 'success' })
    } as any;
  }
  if (providerName === 'perplexity') {
    return {
      selectRelevantArticles: async () => ({ articleIds: ['art-1', 'art-2'], status: 'success' })
    } as any;
  }
  if (providerName === 'openai') {
      return {
          generateCompletion: async () => ({ text: '"art-1"' }), // OpenAI suggests art-1
          generateJson: async () => ({ isSignificant: true, topArticleId: 'art-1', reasoning: 'reasoning' })
      } as any;
  }
  return originalGetProvider(providerName);
};

// Override apiMonitor to prevent errors
apiMonitor.logRequest = () => 'req-id';
apiMonitor.updateRequest = () => {};

async function runTest() {
  console.log('🧪 Starting Analysis Window Logic Test...');
  console.log('   Scenario: Both pick Article 1 AND Article 2 (Intersection > 1)');

  try {
    const result = await analyzeDay({
      date: '2025-01-01',
      requestContext: {
        requestId: 'test-req',
        source: 'TEST'
      }
    });

    console.log('\n📋 Result Summary:');
    console.log(`   requiresSelection: ${result.requiresSelection}`);
    console.log(`   selectionMode: ${result.selectionMode}`);
    console.log(`   geminiSelectedIds: ${result.geminiSelectedIds?.join(', ')}`);
    console.log(`   perplexitySelectedIds: ${result.perplexitySelectedIds?.join(', ')}`);
    console.log(`   intersectionIds: ${result.intersectionIds?.join(', ')}`);
    console.log(`   openaiSuggestedId: ${result.openaiSuggestedId}`);

    if (result.requiresSelection === true && result.selectionMode === 'multiple') {
        console.log('\n✅ TEST PASSED: Window triggers correctly on multiple matches (Multiple Mode).');
    } else {
        console.error('\n❌ TEST FAILED: Expected requiresSelection=true and selectionMode=multiple.');
    }

  } catch (error) {
    console.error('\n💥 Test crashed:', error);
  }
}

runTest();


/**
 * Comprehensive Test for Article Selection Dialog Window
 * 
 * This test simulates the full flow:
 * 1. User clicks "Analyse Day" button
 * 2. Backend processes the request
 * 3. Checks if requiresSelection flag is set correctly
 * 4. Verifies the dialog would open with correct data
 */

import { analyzeDay } from '../services/analysis-modes';
import { hierarchicalSearch } from '../services/hierarchical-search';
import { aiService } from '../services/ai';
import { apiMonitor } from '../services/api-monitor';

// Test data
const mockArticles = [
  { 
    id: 'art-1', 
    title: 'Bitcoin Reaches New All-Time High', 
    summary: 'Bitcoin price surged to $100,000', 
    url: 'http://example.com/1',
    text: 'Bitcoin reached a new all-time high today...',
    publishedDate: '2025-01-01T12:00:00Z'
  },
  { 
    id: 'art-2', 
    title: 'Ethereum Upgrade Announced', 
    summary: 'Ethereum developers announced major upgrade', 
    url: 'http://example.com/2',
    text: 'Ethereum developers have announced...',
    publishedDate: '2025-01-01T13:00:00Z'
  },
  { 
    id: 'art-3', 
    title: 'Federal Reserve Interest Rate Decision', 
    summary: 'Fed keeps rates unchanged', 
    url: 'http://example.com/3',
    text: 'The Federal Reserve announced...',
    publishedDate: '2025-01-01T14:00:00Z'
  }
];

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bold + colors.cyan);
  console.log('='.repeat(60));
}

function logTest(name: string) {
  log(`\n🧪 Test: ${name}`, colors.bold + colors.blue);
}

function logPass(message: string) {
  log(`✅ PASS: ${message}`, colors.green);
}

function logFail(message: string) {
  log(`❌ FAIL: ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, colors.yellow);
}

// Store original functions
const originalSearchBitcoin = hierarchicalSearch.searchBitcoinTier;
const originalSearchCrypto = hierarchicalSearch.searchCryptoTier;
const originalSearchMacro = hierarchicalSearch.searchMacroTier;
const originalGetProvider = aiService.getProvider;
const originalLogRequest = apiMonitor.logRequest;
const originalUpdateRequest = apiMonitor.updateRequest;

// Test Scenario 1: Orphan Mode (AIs Disagree)
async function testOrphanMode() {
  logTest('Scenario 1: Orphan Mode (AIs Disagree)');
  logInfo('Gemini picks Article 1, Perplexity picks Article 2');
  logInfo('Expected: requiresSelection=true, selectionMode=orphan');

  // Mock hierarchical search
  hierarchicalSearch.searchBitcoinTier = async () => [mockArticles[0]];
  hierarchicalSearch.searchCryptoTier = async () => [mockArticles[1]];
  hierarchicalSearch.searchMacroTier = async () => [mockArticles[2]];

  // Mock AI services - they disagree
  aiService.getProvider = (providerName: string) => {
    if (providerName === 'gemini') {
      return {
        selectRelevantArticles: async () => ({ 
          articleIds: ['art-1'], 
          status: 'success' 
        })
      } as any;
    }
    if (providerName === 'perplexity') {
      return {
        selectRelevantArticles: async () => ({ 
          articleIds: ['art-2'], 
          status: 'success' 
        })
      } as any;
    }
    return originalGetProvider(providerName);
  };

  // Mock API monitor
  apiMonitor.logRequest = () => 'req-id';
  apiMonitor.updateRequest = () => {};

  try {
    const result = await analyzeDay({
      date: '2025-01-01',
      requestContext: {
        requestId: 'test-orphan',
        source: 'TEST_ORPHAN'
      }
    });

    // Verify results
    const checks = [
      { 
        name: 'requiresSelection is true', 
        pass: result.requiresSelection === true 
      },
      { 
        name: 'selectionMode is orphan', 
        pass: result.selectionMode === 'orphan' 
      },
      { 
        name: 'geminiSelectedIds contains art-1', 
        pass: result.geminiSelectedIds?.includes('art-1') === true 
      },
      { 
        name: 'perplexitySelectedIds contains art-2', 
        pass: result.perplexitySelectedIds?.includes('art-2') === true 
      },
      { 
        name: 'intersectionIds is empty', 
        pass: (result.intersectionIds?.length || 0) === 0 
      },
      { 
        name: 'tieredArticles has data', 
        pass: (result.tieredArticles?.bitcoin?.length || 0) > 0 
      }
    ];

    let allPassed = true;
    checks.forEach(check => {
      if (check.pass) {
        logPass(check.name);
      } else {
        logFail(check.name);
        allPassed = false;
      }
    });

    if (allPassed) {
      logPass('All checks passed for Orphan Mode!');
      logInfo('✅ Dialog window WOULD appear in this scenario');
      return true;
    } else {
      logFail('Some checks failed for Orphan Mode');
      return false;
    }

  } catch (error) {
    logFail(`Test crashed: ${error}`);
    console.error(error);
    return false;
  }
}

// Test Scenario 2: Multiple Mode (AIs Agree on Multiple)
async function testMultipleMode() {
  logTest('Scenario 2: Multiple Mode (AIs Agree on Multiple Articles)');
  logInfo('Both Gemini and Perplexity pick Article 1 AND Article 2');
  logInfo('Expected: requiresSelection=true, selectionMode=multiple');

  // Mock hierarchical search
  hierarchicalSearch.searchBitcoinTier = async () => [mockArticles[0], mockArticles[1]];
  hierarchicalSearch.searchCryptoTier = async () => [];
  hierarchicalSearch.searchMacroTier = async () => [];

  // Mock AI services - they both pick multiple articles
  aiService.getProvider = (providerName: string) => {
    if (providerName === 'gemini') {
      return {
        selectRelevantArticles: async () => ({ 
          articleIds: ['art-1', 'art-2'], 
          status: 'success' 
        })
      } as any;
    }
    if (providerName === 'perplexity') {
      return {
        selectRelevantArticles: async () => ({ 
          articleIds: ['art-1', 'art-2'], 
          status: 'success' 
        })
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

  // Mock API monitor
  apiMonitor.logRequest = () => 'req-id';
  apiMonitor.updateRequest = () => {};

  try {
    const result = await analyzeDay({
      date: '2025-01-01',
      requestContext: {
        requestId: 'test-multiple',
        source: 'TEST_MULTIPLE'
      }
    });

    // Verify results
    const checks = [
      { 
        name: 'requiresSelection is true', 
        pass: result.requiresSelection === true 
      },
      { 
        name: 'selectionMode is multiple', 
        pass: result.selectionMode === 'multiple' 
      },
      { 
        name: 'intersectionIds contains both articles', 
        pass: (result.intersectionIds?.length || 0) >= 2 && 
              result.intersectionIds?.includes('art-1') === true &&
              result.intersectionIds?.includes('art-2') === true
      },
      { 
        name: 'openaiSuggestedId is set', 
        pass: !!result.openaiSuggestedId 
      },
      { 
        name: 'tieredArticles has data', 
        pass: (result.tieredArticles?.bitcoin?.length || 0) > 0 
      }
    ];

    let allPassed = true;
    checks.forEach(check => {
      if (check.pass) {
        logPass(check.name);
      } else {
        logFail(check.name);
        allPassed = false;
      }
    });

    if (allPassed) {
      logPass('All checks passed for Multiple Mode!');
      logInfo('✅ Dialog window WOULD appear in this scenario');
      return true;
    } else {
      logFail('Some checks failed for Multiple Mode');
      return false;
    }

  } catch (error) {
    logFail(`Test crashed: ${error}`);
    console.error(error);
    return false;
  }
}

// Test Scenario 3: Auto-Complete (AIs Agree on Single)
async function testAutoComplete() {
  logTest('Scenario 3: Auto-Complete (AIs Agree on Single Article)');
  logInfo('Both Gemini and Perplexity pick Article 1');
  logInfo('Expected: requiresSelection=false (NO dialog window)');

  // Mock hierarchical search
  hierarchicalSearch.searchBitcoinTier = async () => [mockArticles[0]];
  hierarchicalSearch.searchCryptoTier = async () => [];
  hierarchicalSearch.searchMacroTier = async () => [];

  // Mock AI services - they both pick the same single article
  aiService.getProvider = (providerName: string) => {
    if (providerName === 'gemini') {
      return {
        selectRelevantArticles: async () => ({ 
          articleIds: ['art-1'], 
          status: 'success' 
        })
      } as any;
    }
    if (providerName === 'perplexity') {
      return {
        selectRelevantArticles: async () => ({ 
          articleIds: ['art-1'], 
          status: 'success' 
        })
      } as any;
    }
    if (providerName === 'openai') {
      let callCount = 0;
      return {
        generateCompletion: async (options: any) => {
          callCount++;
          const prompt = options?.prompt || '';
          
          // First call: initial summary (too long - 114 chars to trigger adjustment)
          if (callCount === 1) {
            return { 
              text: 'Bitcoin reached a new all-time high today, breaking through the $100,000 barrier for the first time in its entire history' 
            };
          }
          
          // Subsequent calls: adjustment rounds - return properly sized summary (105 chars)
          // Check if it's an adjustment prompt (contains "too long" or "too short")
          if (prompt.includes('too long') || prompt.includes('too short') || callCount > 1) {
            // Return a summary that's exactly 105 characters (within 100-110 range)
            return { 
              text: 'Bitcoin reached a new all-time high today, breaking through the $100,000 barrier for the first time ever' 
            };
          }
          
          // Default fallback
          return { 
            text: 'Bitcoin reached a new all-time high today, breaking through the $100,000 barrier for the first time ever' 
          };
        },
        generateJson: async () => ({ isSignificant: true, topArticleId: 'art-1', reasoning: 'reasoning' })
      } as any;
    }
    return originalGetProvider(providerName);
  };

  // Mock API monitor
  apiMonitor.logRequest = () => 'req-id';
  apiMonitor.updateRequest = () => {};

  try {
    const result = await analyzeDay({
      date: '2025-01-01',
      requestContext: {
        requestId: 'test-autocomplete',
        source: 'TEST_AUTOCOMPLETE'
      }
    });

    // Verify results
    const checks = [
      { 
        name: 'requiresSelection is false or undefined', 
        pass: result.requiresSelection !== true 
      },
      { 
        name: 'summary is generated', 
        pass: !!(result.summary && result.summary.length > 0) 
      },
      { 
        name: 'topArticleId is set', 
        pass: result.topArticleId === 'art-1' 
      },
      { 
        name: 'winningTier is set', 
        pass: !!result.winningTier 
      }
    ];

    let allPassed = true;
    checks.forEach(check => {
      if (check.pass) {
        logPass(check.name);
      } else {
        logFail(check.name);
        allPassed = false;
      }
    });

    if (allPassed) {
      logPass('All checks passed for Auto-Complete Mode!');
      logInfo('✅ Dialog window WOULD NOT appear (auto-completed)');
      return true;
    } else {
      logFail('Some checks failed for Auto-Complete Mode');
      return false;
    }

  } catch (error) {
    logFail(`Test crashed: ${error}`);
    console.error(error);
    return false;
  }
}

// Restore original functions
function restoreMocks() {
  hierarchicalSearch.searchBitcoinTier = originalSearchBitcoin;
  hierarchicalSearch.searchCryptoTier = originalSearchCrypto;
  hierarchicalSearch.searchMacroTier = originalSearchMacro;
  aiService.getProvider = originalGetProvider;
  apiMonitor.logRequest = originalLogRequest;
  apiMonitor.updateRequest = originalUpdateRequest;
}

// Main test runner
async function runAllTests() {
  logSection('Article Selection Dialog Window - Comprehensive Test Suite');
  log('Testing all scenarios for the "Analyse Day" button behavior\n', colors.bold);

  const results = {
    orphan: false,
    multiple: false,
    autocomplete: false
  };

  try {
    // Run all tests
    results.orphan = await testOrphanMode();
    results.multiple = await testMultipleMode();
    results.autocomplete = await testAutoComplete();

    // Summary
    logSection('Test Summary');
    console.log(`Orphan Mode (Disagreement):     ${results.orphan ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Multiple Mode (Multiple Match): ${results.multiple ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Auto-Complete (Single Match):    ${results.autocomplete ? '✅ PASS' : '❌ FAIL'}`);

    const allPassed = results.orphan && results.multiple && results.autocomplete;
    
    console.log('\n' + '='.repeat(60));
    if (allPassed) {
      log('🎉 ALL TESTS PASSED!', colors.bold + colors.green);
      log('\n✅ The selection window logic is working correctly:', colors.green);
      log('   • Window appears when AIs disagree (Orphan Mode)', colors.green);
      log('   • Window appears when multiple articles match (Multiple Mode)', colors.green);
      log('   • Window does NOT appear when AIs agree on single article (Auto-Complete)', colors.green);
    } else {
      log('⚠️  SOME TESTS FAILED', colors.bold + colors.yellow);
      log('Please review the test output above for details.', colors.yellow);
    }
    console.log('='.repeat(60) + '\n');

    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    logFail(`Fatal error running tests: ${error}`);
    console.error(error);
    process.exit(1);
  } finally {
    restoreMocks();
  }
}

// Run tests
runAllTests();


import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';

// Test the battle feature with a single entry
async function testBattle() {
  console.log('⚔️ Testing Battle Feature...\n');

  try {
    // Get all analyses
    const allAnalyses = await storage.getAllAnalyses();
    console.log(`📊 Total analyses: ${allAnalyses.length}\n`);

    // Find AI Arena entries (same logic as endpoint)
    const arenaAnalyses = allAnalyses.filter(analysis => {
      const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
      const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
      const isGeminiApproved = analysis.geminiApproved === true;
      const isGeminiRejected = analysis.geminiApproved === false;
      const isBothVerified = isPerplexityVerified && isOpenAIVerified;
      const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
      
      const isNotVerified = !analysis.perplexityVerdict && !analysis.factCheckVerdict;
      if (isNotVerified) return false;
      
      const isReadyToTag = isBothVerified || (isOneVerified && isGeminiApproved);
      if (isReadyToTag) return false;
      
      if (isOneVerified && !isGeminiRejected) return false;
      
      const hasPerplexityVerdict = analysis.perplexityVerdict != null && analysis.perplexityVerdict !== '' && analysis.perplexityVerdict !== 'verified';
      const hasOpenAIVerdict = analysis.factCheckVerdict != null && analysis.factCheckVerdict !== '' && analysis.factCheckVerdict !== 'verified';
      
      return (!isPerplexityVerified && !isOpenAIVerified && (hasPerplexityVerdict || hasOpenAIVerdict)) ||
             (isOneVerified && isGeminiRejected);
    });

    console.log(`⚔️ Found ${arenaAnalyses.length} AI Arena entries\n`);

    if (arenaAnalyses.length === 0) {
      console.log('✅ No AI Arena entries to test');
      return;
    }

    // Test with first 3 entries
    const testEntries = arenaAnalyses.slice(0, 3);
    const perplexityProvider = aiService.getProvider('perplexity');
    const geminiProvider = aiService.getProvider('gemini');

    for (let i = 0; i < testEntries.length; i++) {
      const testAnalysis = testEntries[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🧪 TEST ${i + 1}/3: ${testAnalysis.date}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`   Summary: ${testAnalysis.summary.substring(0, 80)}...`);
      console.log(`   Perplexity: ${testAnalysis.perplexityVerdict || 'null'}`);
      console.log(`   OpenAI: ${testAnalysis.factCheckVerdict || 'null'}`);
      console.log(`   Gemini: ${testAnalysis.geminiApproved || 'null'}\n`);

      // Get cached articles
      const tieredArticles = testAnalysis.tieredArticles as any;
      if (!tieredArticles || typeof tieredArticles !== 'object') {
        console.log('⚠️ No cached articles found - would be marked as orphan\n');
        continue;
      }

      // Flatten articles
      const allArticles: Array<{ id: string; title: string; summary?: string }> = [];
      const tiers = ['bitcoin', 'crypto', 'macro'] as const;
      for (const tier of tiers) {
        const tierArticles = tieredArticles[tier] || [];
        for (const article of tierArticles) {
          if (article && article.id && article.title) {
            allArticles.push({
              id: article.id,
              title: article.title,
              summary: article.summary || article.text?.substring(0, 200) || undefined
            });
          }
        }
      }

      console.log(`📚 Found ${allArticles.length} cached articles`);

      if (allArticles.length === 0) {
        console.log('⚠️ No articles to test with - would be marked as orphan\n');
        continue;
      }

      // Use all articles (not just first 5) for more realistic test
      console.log(`📋 Testing with ${allArticles.length} articles\n`);

      // Send to both models in parallel
      console.log('🔵 Sending to Perplexity...');
      const perplexityIds = await perplexityProvider.selectRelevantArticles?.(allArticles, testAnalysis.date) || [];
      console.log(`   ✅ Perplexity selected: ${perplexityIds.length} articles`);
      if (perplexityIds.length > 0) {
        console.log(`   IDs: ${perplexityIds.slice(0, 3).join(', ')}${perplexityIds.length > 3 ? ` (+${perplexityIds.length - 3} more)` : ''}`);
      }
      console.log('');

      console.log('🟢 Sending to Gemini...');
      const geminiIds = await geminiProvider.selectRelevantArticles?.(allArticles, testAnalysis.date) || [];
      console.log(`   ✅ Gemini selected: ${geminiIds.length} articles`);
      if (geminiIds.length > 0) {
        console.log(`   IDs: ${geminiIds.slice(0, 3).join(', ')}${geminiIds.length > 3 ? ` (+${geminiIds.length - 3} more)` : ''}`);
      }
      console.log('');

      // Find intersection
      const intersection = perplexityIds.filter(id => geminiIds.includes(id));
      console.log(`🔍 Intersection: ${intersection.length} matching article(s)`);
      if (intersection.length > 0) {
        console.log(`   Matching IDs: ${intersection.slice(0, 3).join(', ')}${intersection.length > 3 ? ` (+${intersection.length - 3} more)` : ''}`);
      }
      console.log('');

      if (intersection.length === 0) {
        console.log('❌ Result: No matches - would be marked as ORPHAN');
      } else if (intersection.length === 1) {
        console.log('✅ Result: Single match - would use this article directly and summarize');
      } else {
        console.log(`🔀 Result: Multiple matches (${intersection.length}) - would ask OpenAI to select best, then summarize`);
      }
      console.log('');
    }

    console.log(`${'='.repeat(80)}`);
    console.log('✅ Battle test completed for 3 entries!');
    console.log('📊 Check API Monitor for all logged requests');
    console.log(`${'='.repeat(80)}`);

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  }
}

testBattle().catch(console.error);


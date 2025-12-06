import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';

// Test the battle feature with OpenAI article selection
async function testBattleWithOpenAI() {
  console.log('⚔️ Testing Battle Feature with OpenAI Selection...\n');

  try {
    // Get all analyses
    const allAnalyses = await storage.getAllAnalyses();
    console.log(`📊 Total analyses: ${allAnalyses.length}\n`);

    // Find AI Arena entries
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

    // Find an entry with multiple matches (from previous test, we know 2024-12-31 has 2 matches)
    let testAnalysis = arenaAnalyses.find(a => a.date === '2024-12-31');
    if (!testAnalysis) {
      testAnalysis = arenaAnalyses[0];
    }

    console.log(`🧪 Testing with entry: ${testAnalysis.date}`);
    console.log(`   Summary: ${testAnalysis.summary.substring(0, 80)}...`);
    console.log(`   Perplexity: ${testAnalysis.perplexityVerdict || 'null'}`);
    console.log(`   OpenAI: ${testAnalysis.factCheckVerdict || 'null'}`);
    console.log(`   Gemini: ${testAnalysis.geminiApproved || 'null'}\n`);

    // Get cached articles
    const tieredArticles = testAnalysis.tieredArticles as any;
    if (!tieredArticles || typeof tieredArticles !== 'object') {
      console.log('⚠️ No cached articles found');
      return;
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

    console.log(`📚 Found ${allArticles.length} cached articles\n`);

    if (allArticles.length === 0) {
      console.log('⚠️ No articles to test with');
      return;
    }

    // Send to both models
    const perplexityProvider = aiService.getProvider('perplexity');
    const geminiProvider = aiService.getProvider('gemini');

    console.log('🔵 Sending to Perplexity...');
    const perplexityIds = await perplexityProvider.selectRelevantArticles?.(allArticles, testAnalysis.date) || [];
    console.log(`   ✅ Perplexity selected: ${perplexityIds.length} articles`);
    if (perplexityIds.length > 0) {
      console.log(`   IDs: ${perplexityIds.join(', ')}`);
    }
    console.log('');

    console.log('🟢 Sending to Gemini...');
    const geminiIds = await geminiProvider.selectRelevantArticles?.(allArticles, testAnalysis.date) || [];
    console.log(`   ✅ Gemini selected: ${geminiIds.length} articles`);
    if (geminiIds.length > 0) {
      console.log(`   IDs: ${geminiIds.join(', ')}`);
    }
    console.log('');

    // Find intersection
    const intersection = perplexityIds.filter(id => geminiIds.includes(id));
    console.log(`🔍 Intersection: ${intersection.length} matching article(s)`);
    if (intersection.length > 0) {
      console.log(`   Matching IDs: ${intersection.join(', ')}`);
    }
    console.log('');

    if (intersection.length === 0) {
      console.log('❌ No matches - would be marked as orphan');
      return;
    }

    if (intersection.length === 1) {
      console.log('✅ Single match - would use this article directly');
      return;
    }

    // Multiple matches - test OpenAI selection
    console.log(`🔀 Multiple matches (${intersection.length}) - Testing OpenAI selection...\n`);

    // Find candidate articles
    const candidateArticles = [];
    for (const articleId of intersection) {
      for (const tier of tiers) {
        const tierArticles = tieredArticles[tier] || [];
        const article = tierArticles.find((a: any) => a.id === articleId);
        if (article) {
          candidateArticles.push(article);
          break;
        }
      }
    }

    // Build prompt (same as in battle logic)
    const articlesText = candidateArticles.map((article, idx) => {
      // Determine tier
      let articleTier = 'unknown';
      let tierIndex = 0;
      for (const tier of tiers) {
        const tierArticles = tieredArticles[tier] || [];
        const found = tierArticles.find((a: any) => a.id === article.id);
        if (found) {
          articleTier = tier;
          break;
        }
        tierIndex += tierArticles.length;
      }

      return `Article ${idx + 1} (ID: ${article.id}):
Title: ${article.title}
Summary: ${article.summary || article.text?.substring(0, 300) || 'N/A'}
Tier: ${articleTier}`;
    }).join('\n\n');

    const selectionPrompt = `You are selecting the most relevant news article for a Bitcoin/crypto timeline entry for ${testAnalysis.date}.

ARTICLES:
${articlesText}

Priority hierarchy (most to least important):
1. Bitcoin-related news (price movements, halvings, protocol updates, Bitcoin companies)
2. Web3/Crypto news (Ethereum, DeFi, NFTs, other cryptocurrencies, crypto companies)
3. Macroeconomics news (general economic events, regulations affecting crypto)

Select the article that is MOST relevant to Bitcoin and cryptocurrency history. Return ONLY the article ID.

Format: "id"`;

    console.log('📝 OpenAI Selection Prompt:');
    console.log('='.repeat(80));
    console.log(selectionPrompt);
    console.log('='.repeat(80));
    console.log('');

    // Call OpenAI
    const openaiProvider = aiService.getProvider('openai');
    console.log('🤖 Calling OpenAI to select best article...');
    const selectionResult = await openaiProvider.generateCompletion({
      prompt: selectionPrompt,
      model: 'gpt-5-mini',
      maxTokens: 50,
      temperature: 0.2
    });

    const selectedId = selectionResult.text.trim().replace(/"/g, '');
    const selectedArticle = candidateArticles.find((a: any) => a.id === selectedId) || candidateArticles[0];
    
    console.log(`✅ OpenAI selected: ${selectedId}`);
    console.log(`   Selected article: ${selectedArticle.title.substring(0, 80)}...`);
    console.log('');

    // Now test summary generation
    console.log('📝 Summary Generation Prompt:');
    console.log('='.repeat(80));
    const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
    const summaryPrompt = `Create a summary for a historical timeline entry from this article.

Title: "${selectedArticle.title}"
Text: "${articleText}"

CRITICAL REQUIREMENTS:
1. Summary MUST be EXACTLY 100-110 characters (strict requirement)
2. NO DATES anywhere in summary (no years, months, days, "On [date]", "In [year]")
3. Use active voice and present tense: "Bitcoin reaches $1000" not "Bitcoin reached $1000"
4. Focus on what actually HAPPENED, not what articles discussed
5. NO ending punctuation (no periods, colons, semicolons, dashes)
6. Be conversational yet professional
7. Emphasize the actual event/outcome over the reporting

Return ONLY the summary text, nothing else.`;
    
    console.log(summaryPrompt);
    console.log('='.repeat(80));
    console.log('');

    console.log('🤖 Calling OpenAI to generate summary...');
    const newSummary = await openaiProvider.generateCompletion({
      prompt: summaryPrompt,
      model: 'gpt-5-mini',
      maxTokens: 150,
      temperature: 0.2
    });

    let finalSummary = newSummary.text.trim();
    const length = finalSummary.length;
    console.log(`✅ Generated summary (${length} chars): "${finalSummary}"`);
    console.log('');

    if (length < 100 || length > 110) {
      console.log(`⚠️ Summary length ${length} is outside 100-110 range, would adjust`);
    } else {
      console.log(`✅ Summary length is correct (${length} chars)`);
    }

    console.log('\n✅ Full battle test with OpenAI selection completed!');
    console.log('📊 Check API Monitor for all logged requests');

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  }
}

testBattleWithOpenAI().catch(console.error);


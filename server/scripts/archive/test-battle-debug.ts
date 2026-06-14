import 'dotenv/config';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { aiService } from '../services/ai';
import { storage } from '../storage';

async function testBattleDebug() {
  console.log('🔍 Fetching AI Arena entries...');
  
  // Get entries in AI Arena (contradicted/uncertain or one verified but rejected by Gemini, and not orphan)
  const allAnalyses = await storage.getAllAnalyses();
  
  const arenaAnalyses = allAnalyses.filter(analysis => {
    const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
    const isPerplexityContradicted = analysis.perplexityVerdict === 'contradicted';
    const isPerplexityUncertain = analysis.perplexityVerdict === 'uncertain';
    const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
    const isOpenAIContradicted = analysis.factCheckVerdict === 'contradicted';
    const isOpenAIUncertain = analysis.factCheckVerdict === 'uncertain';
    const isGeminiRejected = analysis.geminiApproved === false;
    const isOrphan = analysis.isOrphan === true;

    // AI Arena: contradicted/uncertain OR one verified but rejected by Gemini
    const isContradicted = (isPerplexityContradicted || isOpenAIContradicted);
    const isUncertain = (isPerplexityUncertain || isOpenAIUncertain);
    const isOneServiceVerified = (isPerplexityVerified && !isOpenAIVerified) || (!isPerplexityVerified && isOpenAIVerified);
    const isInArena = (isContradicted || isUncertain || (isOneServiceVerified && isGeminiRejected)) && !isOrphan;

    return isInArena;
  });

  console.log(`📊 Found ${arenaAnalyses.length} entries in AI Arena`);
  
  // Take first 10
  const testEntries = arenaAnalyses.slice(0, 10);
  console.log(`🧪 Testing with ${testEntries.length} entries\n`);

  let processed = 0;
  let resolved = 0;
  let orphaned = 0;
  let failed = 0;

  for (const analysis of testEntries) {
    try {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`⚔️ Battling ${analysis.date}...`);
      console.log(`   Current summary: "${analysis.summary?.substring(0, 80)}..."`);
      console.log(`   Perplexity: ${analysis.perplexityVerdict || 'null'}`);
      console.log(`   OpenAI: ${analysis.factCheckVerdict || 'null'}`);
      console.log(`   Gemini: ${analysis.geminiApproved === null ? 'null' : analysis.geminiApproved}`);
      console.log(`   Is Orphan: ${analysis.isOrphan || false}`);
      
      // Get cached articles from tiered_articles
      const tieredArticles = analysis.tieredArticles as any;
      if (!tieredArticles || typeof tieredArticles !== 'object') {
        console.log(`⚠️ No cached articles for ${analysis.date}, marking as orphan`);
        await db.update(historicalNewsAnalyses)
          .set({ isOrphan: true })
          .where(eq(historicalNewsAnalyses.date, analysis.date));
        processed++;
        orphaned++;
        continue;
      }

      // Flatten all articles from all tiers
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

      if (allArticles.length === 0) {
        console.log(`⚠️ No articles found for ${analysis.date}, marking as orphan`);
        await db.update(historicalNewsAnalyses)
          .set({ isOrphan: true })
          .where(eq(historicalNewsAnalyses.date, analysis.date));
        processed++;
        orphaned++;
        continue;
      }

      console.log(`📚 Found ${allArticles.length} cached articles for ${analysis.date}`);

      // Send to both models in parallel
      const perplexityProvider = aiService.getProvider('perplexity');
      const geminiProvider = aiService.getProvider('gemini');

      console.log(`🔵 Calling Perplexity...`);
      console.log(`🟢 Calling Gemini...`);
      const [perplexityIds, geminiIds] = await Promise.all([
        perplexityProvider.selectRelevantArticles?.(allArticles, analysis.date) || Promise.resolve([]),
        geminiProvider.selectRelevantArticles?.(allArticles, analysis.date) || Promise.resolve([])
      ]);

      console.log(`🔵 Perplexity selected: ${perplexityIds.length} articles`);
      if (perplexityIds.length > 0) {
        console.log(`   IDs: ${perplexityIds.slice(0, 5).join(', ')}${perplexityIds.length > 5 ? ` (+${perplexityIds.length - 5} more)` : ''}`);
      }
      console.log(`🟢 Gemini selected: ${geminiIds.length} articles`);
      if (geminiIds.length > 0) {
        console.log(`   IDs: ${geminiIds.slice(0, 5).join(', ')}${geminiIds.length > 5 ? ` (+${geminiIds.length - 5} more)` : ''}`);
      }

      // Find intersection
      const intersection = perplexityIds.filter(id => geminiIds.includes(id));
      console.log(`🔍 Intersection for ${analysis.date}: ${intersection.length} matching article(s)`);
      if (intersection.length > 0) {
        console.log(`   Matching IDs: ${intersection.slice(0, 3).join(', ')}${intersection.length > 3 ? ` (+${intersection.length - 3} more)` : ''}`);
      }

      if (intersection.length === 0) {
        // No matches - mark as orphan
        console.log(`❌ No matching articles found for ${analysis.date}, marking as orphan`);
        try {
          const updateResult = await db.update(historicalNewsAnalyses)
            .set({ isOrphan: true })
            .where(eq(historicalNewsAnalyses.date, analysis.date));
          console.log(`✅ Successfully marked ${analysis.date} as orphan in database`);
          console.log(`   Update result:`, updateResult);
        } catch (dbError) {
          console.error(`❌ Database error marking orphan for ${analysis.date}:`, dbError);
          console.error(`   Error message:`, (dbError as Error).message);
          console.error(`   Error stack:`, (dbError as Error).stack);
        }
        processed++;
        orphaned++;
        continue;
      }

      // Find the actual article objects
      let selectedArticle: any = null;

      if (intersection.length === 1) {
        // Single match - use it directly
        const articleId = intersection[0];
        console.log(`✅ Single match found: ${articleId}`);
        // Find article in tiered articles
        for (const tier of tiers) {
          const tierArticles = tieredArticles[tier] || [];
          const article = tierArticles.find((a: any) => a.id === articleId);
          if (article) {
            selectedArticle = article;
            console.log(`   Found article in ${tier} tier: ${article.title.substring(0, 60)}...`);
            break;
          }
        }
      } else {
        // Multiple matches - use OpenAI to select best one
        console.log(`🔀 Multiple matches (${intersection.length}), asking OpenAI to select best...`);
        
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

        // Build prompt for OpenAI to select best article
        const articlesText = candidateArticles.map((article, idx) => 
          `Article ${idx + 1} (ID: ${article.id}):
Title: ${article.title}
Summary: ${article.summary || article.text?.substring(0, 300) || 'N/A'}
Tier: ${candidateArticles.indexOf(article) < tieredArticles.bitcoin?.length ? 'bitcoin' : 
        candidateArticles.indexOf(article) < (tieredArticles.bitcoin?.length || 0) + (tieredArticles.crypto?.length || 0) ? 'crypto' : 'macro'}`
        ).join('\n\n');

        const selectionPrompt = `You are selecting the most relevant news article for a Bitcoin/crypto timeline entry for ${analysis.date}.

ARTICLES:
${articlesText}

Priority hierarchy (most to least important):
1. Bitcoin-related news (price movements, halvings, protocol updates, Bitcoin companies)
2. Web3/Crypto news (Ethereum, DeFi, NFTs, other cryptocurrencies, crypto companies)
3. Macroeconomics news (general economic events, regulations affecting crypto)

Select the article that is MOST relevant to Bitcoin and cryptocurrency history. Return ONLY the article ID.

Format: "id"`;

        const openaiProvider = aiService.getProvider('openai');
        console.log(`🤖 [BATTLE] Calling OpenAI for article selection (${intersection.length} matches)...`);
        const selectionResult = await openaiProvider.generateCompletion({
          prompt: selectionPrompt,
          model: 'gpt-5-mini',
          maxTokens: 50,
          temperature: 0.2,
          context: 'battle-article-selection',
          purpose: 'Select best article from multiple matches'
        });
        console.log(`✅ [BATTLE] OpenAI selection completed`);
        console.log(`   OpenAI response: "${selectionResult.text}"`);

        const selectedId = selectionResult.text.trim().replace(/"/g, '');
        selectedArticle = candidateArticles.find((a: any) => a.id === selectedId) || candidateArticles[0];
        console.log(`✅ OpenAI selected: ${selectedId}`);
      }

      if (!selectedArticle) {
        console.error(`❌ Could not find selected article for ${analysis.date}`);
        await db.update(historicalNewsAnalyses)
          .set({ isOrphan: true })
          .where(eq(historicalNewsAnalyses.date, analysis.date));
        processed++;
        orphaned++;
        continue;
      }

      // Generate summary using OpenAI
      const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
      const openaiProvider = aiService.getProvider('openai');
      console.log(`📝 [BATTLE] Calling OpenAI for summary generation...`);
      console.log(`   Article title: "${selectedArticle.title}"`);
      const newSummary = await openaiProvider.generateCompletion({
        context: 'summary-generation',
        purpose: 'Generate 100-110 character summary for battle result',
        prompt: `Create a summary for a historical timeline entry from this article.

Title: "${selectedArticle.title}"
Text: "${articleText}"

CRITICAL REQUIREMENTS:
1. ⚠️ CHARACTER COUNT IS MANDATORY: Summary MUST be EXACTLY 100-110 characters. Count every character including spaces. Verify the character count before responding. This is a strict requirement that cannot be violated.
2. NO DATES anywhere in summary (no years, months, days, "On [date]", "In [year]")
3. Use active voice and present tense: "Bitcoin reaches $1000" not "Bitcoin reached $1000"
4. Focus on what actually HAPPENED, not what articles discussed
5. NO ending punctuation (no periods/full stops, colons, semicolons, dashes). We are NOT interested in full stops at the end - do not include them.
6. Be conversational yet professional
7. Emphasize the actual event/outcome over the reporting

IMPORTANT: After writing your summary, count the characters. If it's not between 100-110 characters, rewrite it until it is. Return ONLY the summary text, nothing else.`,
        model: 'gpt-5-mini',
        maxTokens: 150,
        temperature: 0.2
      });
      console.log(`✅ [BATTLE] Summary generation completed`);
      console.log(`   Generated summary: "${newSummary.text}"`);
      console.log(`   Length: ${newSummary.text.trim().length} characters`);

      // Validate and adjust length if needed (up to 3 rounds)
      let finalSummary = newSummary.text.trim();
      let length = finalSummary.length;
      let adjustmentRound = 0;
      const maxAdjustmentRounds = 3;

      while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
        adjustmentRound++;
        console.log(`   ⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting...`);
        
        if (length < 100) {
          const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary (100-110 chars), nothing else.`;
          console.log(`🔧 [BATTLE] Calling OpenAI for summary adjustment (round ${adjustmentRound})...`);
          const adjusted = await openaiProvider.generateCompletion({
            prompt: adjustPrompt,
            model: 'gpt-5-mini',
            maxTokens: 150,
            temperature: 0.2,
            context: 'summary-adjustment',
            purpose: `Adjust summary length (round ${adjustmentRound})`
          });
          console.log(`✅ [BATTLE] OpenAI adjustment completed`);
          console.log(`   Adjusted summary: "${adjusted.text}"`);
          console.log(`   New length: ${adjusted.text.trim().length} characters`);
          finalSummary = adjusted.text.trim();
          length = finalSummary.length;
        } else if (length > 110) {
          const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary (100-110 chars), nothing else.`;
          console.log(`🔧 [BATTLE] Calling OpenAI for summary adjustment (round ${adjustmentRound})...`);
          const adjusted = await openaiProvider.generateCompletion({
            prompt: adjustPrompt,
            model: 'gpt-5-mini',
            maxTokens: 150,
            temperature: 0.2,
            context: 'summary-adjustment',
            purpose: `Adjust summary length (round ${adjustmentRound})`
          });
          console.log(`✅ [BATTLE] OpenAI adjustment completed`);
          console.log(`   Adjusted summary: "${adjusted.text}"`);
          console.log(`   New length: ${adjusted.text.trim().length} characters`);
          finalSummary = adjusted.text.trim();
          length = finalSummary.length;
        }
      }

      // Final validation
      if (length < 100 || length > 110) {
        console.warn(`⚠️ Final summary still ${length} chars after ${adjustmentRound} adjustment rounds: "${finalSummary}"`);
      } else {
        console.log(`✅ Summary adjusted to ${length} chars after ${adjustmentRound} round(s)`);
      }

      // Update entry with new summary and mark as verified
      console.log(`💾 [BATTLE] Updating database for ${analysis.date}...`);
      console.log(`   New summary: "${finalSummary}"`);
      console.log(`   Article ID: ${selectedArticle.id}`);
      console.log(`   Setting: perplexityVerdict='verified', geminiApproved=true, isOrphan=false`);
      
      try {
        const updateResult = await db.update(historicalNewsAnalyses)
          .set({
            summary: finalSummary,
            topArticleId: selectedArticle.id,
            perplexityVerdict: 'verified',
            geminiApproved: true,
            isOrphan: false,
            reasoning: `Battle result: Both Perplexity and Gemini agreed on this article. Original summary was incorrect.`
          })
          .where(eq(historicalNewsAnalyses.date, analysis.date));
        console.log(`✅ [BATTLE] Database update successful for ${analysis.date}`);
        console.log(`   Update result rows affected:`, (updateResult as any)?.rowCount || 'unknown');
        
        // Verify the update by fetching the record
        const verifyResult = await db.select()
          .from(historicalNewsAnalyses)
          .where(eq(historicalNewsAnalyses.date, analysis.date))
          .limit(1);
        
        if (verifyResult.length > 0) {
          const updated = verifyResult[0];
          console.log(`✅ [BATTLE] Verification - Record updated successfully:`);
          console.log(`   Summary: "${updated.summary?.substring(0, 80)}..."`);
          console.log(`   Perplexity: ${updated.perplexityVerdict}`);
          console.log(`   Gemini: ${updated.geminiApproved}`);
          console.log(`   Is Orphan: ${updated.isOrphan}`);
        } else {
          console.error(`❌ [BATTLE] Verification FAILED - Record not found after update!`);
        }
      } catch (dbError) {
        console.error(`❌ [BATTLE] Database update FAILED for ${analysis.date}:`, dbError);
        console.error(`   Error details:`, (dbError as Error).message);
        console.error(`   Stack:`, (dbError as Error).stack);
        throw dbError; // Re-throw to be caught by outer catch
      }

      console.log(`✅ Battle won for ${analysis.date}: "${finalSummary.substring(0, 50)}..."`);
      
      processed++;
      resolved++;
      
    } catch (error) {
      console.error(`❌ [BATTLE] Error processing ${analysis.date}:`, error);
      console.error(`   Error message:`, (error as Error).message);
      console.error(`   Error stack:`, (error as Error).stack);
      processed++;
      failed++;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Final Results:`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Resolved: ${resolved}`);
  console.log(`   Orphaned: ${orphaned}`);
  console.log(`   Failed: ${failed}`);
  console.log(`${'='.repeat(80)}\n`);

  process.exit(0);
}

testBattleDebug().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


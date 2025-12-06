import 'dotenv/config';
import { storage } from '../storage';
import { aiService } from '../services/ai';
import { db } from '../db';
import { historicalNewsAnalyses } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Test the full battle process for 5 entries
async function testBattleFull() {
  console.log('⚔️ Testing Full Battle Process for 50 Entries...\n');
  
  const results = {
    total: 0,
    successful: 0,
    orphaned: 0,
    errors: 0,
    summaryLengths: [] as number[],
    adjustmentRounds: [] as number[]
  };

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

    // Use first 50 entries
    const testAnalyses = arenaAnalyses.slice(0, 50);
    for (let i = 0; i < testAnalyses.length; i++) {
      results.total++;
      const testAnalysis = testAnalyses[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🧪 FULL BATTLE TEST ${i + 1}/50: ${testAnalysis.date}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`   Summary: ${testAnalysis.summary.substring(0, 80)}...`);
      console.log(`   Perplexity: ${testAnalysis.perplexityVerdict || 'null'}`);
      console.log(`   OpenAI: ${testAnalysis.factCheckVerdict || 'null'}`);
      console.log(`   Gemini: ${testAnalysis.geminiApproved || 'null'}`);
      console.log(`   Current topArticleId: ${testAnalysis.topArticleId || 'null'}\n`);
      
      try {
        // Get cached articles
        const tieredArticles = testAnalysis.tieredArticles as any;
        if (!tieredArticles || typeof tieredArticles !== 'object') {
          console.log('⚠️ No cached articles found - would be marked as orphan');
          await db.update(historicalNewsAnalyses)
            .set({ isOrphan: true })
            .where(eq(historicalNewsAnalyses.date, testAnalysis.date));
          console.log('✅ Marked as orphan in database');
          results.orphaned++;
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

        console.log(`📚 Found ${allArticles.length} cached articles\n`);

        if (allArticles.length === 0) {
          console.log('⚠️ No articles found - would be marked as orphan');
          await db.update(historicalNewsAnalyses)
            .set({ isOrphan: true })
            .where(eq(historicalNewsAnalyses.date, testAnalysis.date));
          console.log('✅ Marked as orphan in database');
          results.orphaned++;
          continue;
        }

        // Send to both models in parallel
        const perplexityProvider = aiService.getProvider('perplexity');
        const geminiProvider = aiService.getProvider('gemini');

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
          console.log('❌ No matches - marking as orphan');
          await db.update(historicalNewsAnalyses)
            .set({ isOrphan: true })
            .where(eq(historicalNewsAnalyses.date, testAnalysis.date));
          console.log('✅ Marked as orphan in database');
          results.orphaned++;
          continue;
        }

        // Find the actual article objects
        let selectedArticle: any = null;

        if (intersection.length === 1) {
          // Single match - use it directly
          const articleId = intersection[0];
          for (const tier of tiers) {
            const tierArticles = tieredArticles[tier] || [];
            const article = tierArticles.find((a: any) => a.id === articleId);
            if (article) {
              selectedArticle = article;
              break;
            }
          }
          console.log(`✅ Single match found: ${articleId}`);
          console.log(`   Article: ${selectedArticle?.title?.substring(0, 80)}...`);
        } else {
          // Multiple matches - use OpenAI to select best one
          console.log(`🔀 Multiple matches (${intersection.length}), asking OpenAI to select best...\n`);
          
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
          const articlesText = candidateArticles.map((article, idx) => {
            // Determine tier
            let articleTier = 'unknown';
            for (const tier of tiers) {
              const tierArticles = tieredArticles[tier] || [];
              const found = tierArticles.find((a: any) => a.id === article.id);
              if (found) {
                articleTier = tier;
                break;
              }
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
          console.log('-'.repeat(80));
          console.log(selectionPrompt.substring(0, 500) + '...');
          console.log('-'.repeat(80));
          console.log('');

          const openaiProvider = aiService.getProvider('openai');
          console.log('🤖 Calling OpenAI to select best article...');
          const selectionResult = await openaiProvider.generateCompletion({
            prompt: selectionPrompt,
            model: 'gpt-5-mini',
            maxTokens: 50,
            temperature: 0.2
          });

          const selectedId = selectionResult.text.trim().replace(/"/g, '').replace(/^id:\s*/i, '');
          selectedArticle = candidateArticles.find((a: any) => a.id === selectedId) || candidateArticles[0];
          console.log(`✅ OpenAI selected: ${selectedId}`);
          console.log(`   Selected article: ${selectedArticle.title.substring(0, 80)}...`);
          console.log('');
        }

        if (!selectedArticle) {
          console.error(`❌ Could not find selected article`);
          await db.update(historicalNewsAnalyses)
            .set({ isOrphan: true })
            .where(eq(historicalNewsAnalyses.date, testAnalysis.date));
          console.log('✅ Marked as orphan in database');
          results.orphaned++;
          continue;
        }

        // Generate summary using OpenAI
        console.log('📝 Generating summary...');
        const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
        const openaiProvider = aiService.getProvider('openai');
        const newSummary = await openaiProvider.generateCompletion({
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

        // Validate and adjust length if needed (up to 3 rounds)
        let finalSummary = newSummary.text.trim();
        let length = finalSummary.length;
        let adjustmentRound = 0;
        const maxAdjustmentRounds = 3;

        console.log(`   Initial summary (${length} chars): "${finalSummary}"`);

        while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
          adjustmentRound++;
          console.log(`   ⚠️ Round ${adjustmentRound}/${maxAdjustmentRounds}: Summary length ${length} chars, adjusting...`);
          
          if (length < 100) {
            const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary (100-110 chars), nothing else.`;
            const adjusted = await openaiProvider.generateCompletion({
              prompt: adjustPrompt,
              model: 'gpt-5-mini',
              maxTokens: 150,
              temperature: 0.2
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
            console.log(`   After round ${adjustmentRound}: ${length} chars - "${finalSummary}"`);
          } else if (length > 110) {
            const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary (100-110 chars), nothing else.`;
            const adjusted = await openaiProvider.generateCompletion({
              prompt: adjustPrompt,
              model: 'gpt-5-mini',
              maxTokens: 150,
              temperature: 0.2
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
            console.log(`   After round ${adjustmentRound}: ${length} chars - "${finalSummary}"`);
          }
        }

        // Final validation
        if (length < 100 || length > 110) {
          console.warn(`   ⚠️ Final summary still ${length} chars after ${adjustmentRound} rounds: "${finalSummary}"`);
        } else {
          console.log(`   ✅ Final summary (${length} chars) after ${adjustmentRound} round(s): "${finalSummary}"`);
        }
        
        results.summaryLengths.push(length);
        results.adjustmentRounds.push(adjustmentRound);
        console.log('');

        // Update entry with new summary and mark as verified
        console.log('💾 Updating database...');
        await db.update(historicalNewsAnalyses)
          .set({
            summary: finalSummary,
            topArticleId: selectedArticle.id,
            perplexityVerdict: 'verified',
            geminiApproved: true,
            isOrphan: false,
            reasoning: `Battle result: Both Perplexity and Gemini agreed on this article. Original summary was incorrect.`
          })
          .where(eq(historicalNewsAnalyses.date, testAnalysis.date));

        console.log('✅ Database updated successfully!');
        results.successful++;
        console.log('');
        console.log(`${'='.repeat(80)}`);
        console.log('📊 BATTLE RESULTS:');
        console.log(`${'='.repeat(80)}`);
        console.log(`   Date: ${testAnalysis.date}`);
        console.log(`   Old Summary: ${testAnalysis.summary.substring(0, 80)}...`);
        console.log(`   New Summary: ${finalSummary}`);
        console.log(`   Selected Article: ${selectedArticle.title.substring(0, 80)}...`);
        console.log(`   Article ID: ${selectedArticle.id}`);
        console.log(`   Status: perplexity_verdict = 'verified', gemini_approved = true`);
        console.log(`   Entry will now appear in "Ready to be Tagged" tab`);
        console.log(`${'='.repeat(80)}`);
      } catch (error) {
        console.error(`❌ Error processing ${testAnalysis.date}:`, (error as Error).message);
        results.errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL TEST RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log(`   Total entries tested: ${results.total}`);
    console.log(`   ✅ Successful: ${results.successful}`);
    console.log(`   🏷️  Orphaned: ${results.orphaned}`);
    console.log(`   ❌ Errors: ${results.errors}`);
    if (results.summaryLengths.length > 0) {
      const avgLength = Math.round(results.summaryLengths.reduce((a, b) => a + b, 0) / results.summaryLengths.length);
      const minLength = Math.min(...results.summaryLengths);
      const maxLength = Math.max(...results.summaryLengths);
      const inRange = results.summaryLengths.filter(l => l >= 100 && l <= 110).length;
      console.log(`\n   Summary Length Stats:`);
      console.log(`   - Average: ${avgLength} chars`);
      console.log(`   - Range: ${minLength}-${maxLength} chars`);
      console.log(`   - In range (100-110): ${inRange}/${results.summaryLengths.length} (${Math.round(inRange/results.summaryLengths.length*100)}%)`);
    }
    if (results.adjustmentRounds.length > 0) {
      const avgRounds = (results.adjustmentRounds.reduce((a, b) => a + b, 0) / results.adjustmentRounds.length).toFixed(1);
      const maxRounds = Math.max(...results.adjustmentRounds);
      console.log(`\n   Adjustment Rounds:`);
      console.log(`   - Average: ${avgRounds} rounds`);
      console.log(`   - Max: ${maxRounds} rounds`);
    }
    console.log('='.repeat(80));
    console.log('\n✅ Full battle test completed for 50 entries!');
    console.log('📊 Check API Monitor for all logged requests');

  } catch (error) {
    console.error('❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  }
}

testBattleFull().catch(console.error);


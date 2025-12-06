import { storage } from '../storage';
import { apiMonitor } from './api-monitor';
import { type HistoricalNewsAnalysis, type TieredArticles, type ArticleData } from "@shared/schema";
import { aiService } from './ai';
import { hierarchicalSearch } from './hierarchical-search';

class PerplexityCleanerService {
  /**
   * Resolves a single contradicted event.
   * This is the main orchestrator for the cleaning flow.
   */
  public async resolveContradictedEvent(contradictedDate: string): Promise<{ success: boolean; message: string; updatedDate?: string; newTier?: string }> {
    const monitorId = apiMonitor.logRequest({
      service: 'perplexity-cleaner',
      endpoint: '/resolve-contradiction',
      method: 'POST',
      status: 'pending',
      context: 'internal-job',
      purpose: `Resolve contradicted event for ${contradictedDate}`,
      triggeredBy: 'PerplexityCleanerService',
      requestData: { date: contradictedDate }
    });

    const startTime = Date.now();

    try {
      const contradictedAnalysis = await storage.getAnalysisByDate(contradictedDate);
      if (!contradictedAnalysis || contradictedAnalysis.perplexityVerdict !== 'contradicted') {
        throw new Error(`No contradicted analysis found for ${contradictedDate}`);
      }

      const correctDateText = contradictedAnalysis.perplexityCorrectDateText;

      // Validate correctDateText is a valid date format before using it
      let validCorrectDate: string | null = null;
      if (correctDateText) {
        // Check if it's a valid date format (YYYY-MM-DD or contains YYYY-MM-DD)
        const dateMatch = correctDateText.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          validCorrectDate = dateMatch[0];
        } else {
          console.log(`[PerplexityCleaner] Invalid date format in correctDateText: "${correctDateText}", will find new event instead`);
        }
      }

      if (validCorrectDate) {
        // Case 1: A corrected date is suggested - compare summaries and decide
        await this.handleContradictionWithCorrection(contradictedAnalysis, validCorrectDate);
        apiMonitor.updateRequest(monitorId, { status: 'success', duration: Date.now() - startTime });
        return { 
          success: true, 
          message: `Successfully resolved contradiction for ${contradictedDate} with corrected date ${correctDateText}`,
          updatedDate: contradictedDate,
          newTier: 'resolved'
        };
      } else {
        // Case 2: No corrected date, just find a new event for the original date
        await this.findAndAssignNewEvent(contradictedAnalysis, 'No correct date provided');
        apiMonitor.updateRequest(monitorId, { status: 'success', duration: Date.now() - startTime });
        return { 
          success: true, 
          message: `Successfully resolved contradiction for ${contradictedDate} by finding new event`,
          updatedDate: contradictedDate,
          newTier: 'resolved'
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      apiMonitor.updateRequest(monitorId, { 
        status: 'error', 
        errorCategory: 'other', 
        requestData: { error: errorMessage },
        duration: Date.now() - startTime,
      });
      console.error(`[PerplexityCleaner] Error resolving contradiction for ${contradictedDate}:`, error);
      throw new Error(errorMessage);
    }
  }

  /**
   * Handles the case where Perplexity provided a corrected date.
   */
  private async handleContradictionWithCorrection(contradictedAnalysis: HistoricalNewsAnalysis, correctDateText: string): Promise<void> {
    const correctDateAnalysis = await storage.getAnalysisByDate(correctDateText);
    
    // Get cached articles for both dates
    const contradictedTieredArticles = this.getCachedArticles(contradictedAnalysis);
    const correctTieredArticles = correctDateAnalysis ? this.getCachedArticles(correctDateAnalysis) : { bitcoin: [], crypto: [], macro: [] };

    if (!correctDateAnalysis) {
      // If the corrected date has no analysis, move the summary there and find new for contradicted
      console.log(`[PerplexityCleaner] Corrected date ${correctDateText} has no analysis. Moving summary.`);
      
      // Create new analysis for correct date
      const newAnalysisForCorrectDate: Omit<HistoricalNewsAnalysis, 'id' | 'lastAnalyzed'> = {
        date: correctDateText,
        summary: contradictedAnalysis.summary,
        reasoning: `Summary moved from contradicted date ${contradictedAnalysis.date}. Original reasoning: ${contradictedAnalysis.reasoning || 'N/A'}`,
        isManualOverride: false, // AI-driven automated cleanup, not manual entry
        topArticleId: null,
        aiProvider: 'openai',
        articleTags: null,
        confidenceScore: null,
        sentimentScore: null,
        sentimentLabel: null,
        topicCategories: null,
        duplicateArticleIds: null,
        totalArticlesFetched: 0,
        uniqueArticlesAnalyzed: 0,
        tierUsed: null,
        winningTier: null,
        tieredArticles: contradictedAnalysis.tieredArticles,
        analyzedArticles: null,
        isFlagged: false,
        flagReason: null,
        flaggedAt: null,
        factCheckVerdict: null,
        factCheckConfidence: null,
        factCheckReasoning: null,
        factCheckedAt: null,
        perplexityVerdict: 'verified',
        perplexityConfidence: null,
        perplexityReasoning: `Summary moved from contradicted date ${contradictedAnalysis.date}.`,
        perplexityCorrectDate: null,
        perplexityCorrectDateText: null,
        perplexityCitations: null,
        perplexityCheckedAt: new Date(),
        reVerified: false,
        reVerifiedAt: null,
        reVerificationDate: null,
        reVerificationSummary: null,
        reVerificationTier: null,
        reVerificationArticles: null,
        reVerificationReasoning: null,
        reVerificationStatus: null,
        reVerificationWinner: null,
        tags: [],
      };

      await storage.createAnalysis(newAnalysisForCorrectDate);
      await this.findAndAssignNewEvent(contradictedAnalysis, 'Original summary moved to new correct date entry');
      return;
    }

    // Both dates have analyses - compare summaries using Perplexity
    console.log(`[PerplexityCleaner] Comparing summaries between ${contradictedAnalysis.date} and ${correctDateAnalysis.date}`);
    
    const comparison = await aiService.getProvider('perplexity').compareSummaries(
      contradictedAnalysis.date,
      contradictedAnalysis.summary,
      correctDateText,
      correctDateAnalysis.summary,
      correctTieredArticles // Use corrected date's articles for context
    );

    if (comparison.winner === 'original') {
      // The contradicted summary is better for the corrected date - swap them
      console.log(`[PerplexityCleaner] Swapping summaries - contradicted summary is better for corrected date`);
      const originalCorrectSummary = correctDateAnalysis.summary;
      
      await storage.updateAnalysis(correctDateAnalysis.date, { 
        summary: contradictedAnalysis.summary,
        reasoning: `Summary swapped from ${contradictedAnalysis.date} by AI resolution. ${comparison.reasoning}`,
      });
      
      await storage.updateAnalysis(contradictedAnalysis.date, { 
        summary: originalCorrectSummary,
        reasoning: `Summary swapped from ${correctDateAnalysis.date} by AI resolution.`,
      });
    } else {
      // The corrected summary is better - keep it, but we still need to find new event for contradicted date
      console.log(`[PerplexityCleaner] Corrected summary is better - keeping it, finding new event for contradicted date`);
    }

    // Now find a new event for the contradicted date (which may have been swapped)
    await this.findAndAssignNewEvent(contradictedAnalysis, `Summary comparison completed. Winner: ${comparison.winner}`);
  }

  /**
   * Finds a new significant event using hierarchical waterfall with Perplexity validation.
   * Checks cached Bitcoin → fetches fresh Bitcoin → fetches Crypto → fetches Macro, validating each article is date-specific.
   */
  private async findAndAssignNewEvent(analysis: HistoricalNewsAnalysis, reason: string): Promise<void> {
    console.log(`[PerplexityCleaner] Finding new event for ${analysis.date}. Reason: ${reason}`);
    
    const targetDate = analysis.date;
    const previousArticleId = analysis.topArticleId || null;
    
    // STEP 1: Try cached Bitcoin articles with validation
    console.log(`[PerplexityCleaner] Step 1: Checking cached Bitcoin articles...`);
    const tieredArticles = this.getCachedArticles(analysis);
    
    if (tieredArticles.bitcoin.length > 0) {
      const validArticle = await this.findValidArticleInTier(
        tieredArticles.bitcoin,
        targetDate,
        previousArticleId,
        'bitcoin'
      );
      
      if (validArticle) {
        console.log(`[PerplexityCleaner] ✅ Found valid Bitcoin article from cache: ${validArticle.article.id}`);
        await this.assignArticleToAnalysis(analysis, validArticle.article, 'bitcoin', validArticle.reasoning);
        return;
      }
      console.log(`[PerplexityCleaner] No valid cached Bitcoin articles found. Proceeding to fetch fresh articles...`);
    } else {
      console.log(`[PerplexityCleaner] No cached Bitcoin articles available. Proceeding to fetch fresh articles...`);
    }
    
    // STEP 2: Fetch fresh Bitcoin articles from EXA and validate
    console.log(`[PerplexityCleaner] Step 2: Fetching fresh Bitcoin articles from EXA...`);
    try {
      const bitcoinArticles = await hierarchicalSearch.searchBitcoinTier(targetDate, {
        requestId: `cleaner-${targetDate}`,
        source: 'perplexity-cleaner'
      });
      
      if (bitcoinArticles.length > 0) {
        const validArticle = await this.findValidArticleInTier(
          bitcoinArticles,
          targetDate,
          previousArticleId,
          'bitcoin'
        );
        
        if (validArticle) {
          console.log(`[PerplexityCleaner] ✅ Found valid fresh Bitcoin article: ${validArticle.article.id}`);
          await this.assignArticleToAnalysis(analysis, validArticle.article, 'bitcoin', validArticle.reasoning);
          return;
        }
        console.log(`[PerplexityCleaner] No valid fresh Bitcoin articles found. Proceeding to Crypto tier...`);
      } else {
        console.log(`[PerplexityCleaner] No fresh Bitcoin articles found. Proceeding to Crypto tier...`);
      }
    } catch (error) {
      console.error(`[PerplexityCleaner] Error fetching fresh Bitcoin articles:`, error);
    }
    
    // STEP 3: Fetch fresh Crypto articles from EXA and validate
    console.log(`[PerplexityCleaner] Step 3: Fetching fresh Crypto articles from EXA...`);
    try {
      const cryptoArticles = await hierarchicalSearch.searchCryptoTier(targetDate, {
        requestId: `cleaner-${targetDate}`,
        source: 'perplexity-cleaner'
      });
      
      if (cryptoArticles.length > 0) {
        const validArticle = await this.findValidArticleInTier(
          cryptoArticles,
          targetDate,
          previousArticleId,
          'crypto'
        );
        
        if (validArticle) {
          console.log(`[PerplexityCleaner] ✅ Found valid Crypto article: ${validArticle.article.id}`);
          await this.assignArticleToAnalysis(analysis, validArticle.article, 'crypto', validArticle.reasoning);
          return;
        }
        console.log(`[PerplexityCleaner] No valid Crypto articles found. Proceeding to Macro tier...`);
      } else {
        console.log(`[PerplexityCleaner] No Crypto articles found. Proceeding to Macro tier...`);
      }
    } catch (error) {
      console.error(`[PerplexityCleaner] Error fetching Crypto articles:`, error);
    }
    
    // STEP 4: Fetch fresh Macro articles from EXA and validate
    console.log(`[PerplexityCleaner] Step 4: Fetching fresh Macro articles from EXA...`);
    try {
      const macroArticles = await hierarchicalSearch.searchMacroTier(targetDate, {
        requestId: `cleaner-${targetDate}`,
        source: 'perplexity-cleaner'
      });
      
      if (macroArticles.length > 0) {
        const validArticle = await this.findValidArticleInTier(
          macroArticles,
          targetDate,
          previousArticleId,
          'macro'
        );
        
        if (validArticle) {
          console.log(`[PerplexityCleaner] ✅ Found valid Macro article: ${validArticle.article.id}`);
          await this.assignArticleToAnalysis(analysis, validArticle.article, 'macro', validArticle.reasoning);
          return;
        }
        console.log(`[PerplexityCleaner] No valid Macro articles found.`);
      } else {
        console.log(`[PerplexityCleaner] No Macro articles found.`);
      }
    } catch (error) {
      console.error(`[PerplexityCleaner] Error fetching Macro articles:`, error);
    }
    
    // STEP 5: No valid articles found in any tier
    console.warn(`[PerplexityCleaner] ❌ No valid date-specific events found for ${targetDate} in any tier after checking all cached and fresh articles.`);
    await storage.updateAnalysis(analysis.date, {
      summary: 'No significant date-specific event found after cleaning contradicted entry.',
      reasoning: 'Contradicted entry removed. Perplexity validation found no articles describing actual events on this date (only general overviews/analysis articles) after checking Bitcoin, Crypto, and Macro tiers.',
      isManualOverride: false, // AI-driven automated cleanup, not manual entry
      perplexityVerdict: 'verified',
      perplexityReasoning: 'Contradiction resolved, but no date-specific events found after validating all tiers (cached and fresh articles).'
    });
  }

  /**
   * Finds a valid article in a tier by validating each article is date-specific.
   * Returns the first article that passes validation.
   */
  private async findValidArticleInTier(
    articles: ArticleData[],
    targetDate: string,
    excludeArticleId: string | null,
    tier: 'bitcoin' | 'crypto' | 'macro'
  ): Promise<{ article: ArticleData; reasoning: string } | null> {
    // Filter out excluded article
    const availableArticles = excludeArticleId 
      ? articles.filter(a => a.id !== excludeArticleId)
      : articles;
    
    if (availableArticles.length === 0) {
      return null;
    }
    
    // Validate each article until we find one that passes
    for (const article of availableArticles) {
      console.log(`[PerplexityCleaner] Validating ${tier} article: ${article.title.substring(0, 60)}...`);
      
      const validation = await aiService.getProvider('perplexity').validateArticleIsDateSpecificEvent(article, targetDate);
      
      if (validation.isValid && validation.confidence >= 50) {
        console.log(`[PerplexityCleaner] ✅ Article validated: ${validation.reasoning}`);
        return {
          article,
          reasoning: `Validated as date-specific event (confidence: ${validation.confidence}%): ${validation.reasoning}`
        };
      } else {
        console.log(`[PerplexityCleaner] ❌ Article rejected: ${validation.reasoning} (confidence: ${validation.confidence}%)`);
      }
    }
    
    return null;
  }

  /**
   * Assigns a validated article to the analysis and generates a summary.
   */
  private async assignArticleToAnalysis(
    analysis: HistoricalNewsAnalysis,
    article: ArticleData,
    tier: 'bitcoin' | 'crypto' | 'macro',
    validationReasoning: string
  ): Promise<void> {
    // Generate new summary using OpenAI with strict requirements
    const articleText = (article.text || article.summary || '').substring(0, 2000);
      const newSummary = await aiService.getProvider('openai').generateCompletion({
        prompt: `Create a summary for a historical timeline entry from this article.

Title: "${article.title}"
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
    
    while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
      adjustmentRound++;
      console.log(`⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting: "${finalSummary}"`);
      
      if (length < 100) {
        // Add more detail
        const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary (100-110 chars), nothing else.`;
        const adjusted = await aiService.getProvider('openai').generateCompletion({
          prompt: adjustPrompt,
          model: 'gpt-5-mini',
          maxTokens: 150,
          temperature: 0.2
        });
        finalSummary = adjusted.text.trim();
        length = finalSummary.length;
      } else if (length > 110) {
        // Trim it down
        const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary (100-110 chars), nothing else.`;
        const adjusted = await aiService.getProvider('openai').generateCompletion({
          prompt: adjustPrompt,
          model: 'gpt-5-mini',
          maxTokens: 150,
          temperature: 0.2
        });
        finalSummary = adjusted.text.trim();
        length = finalSummary.length;
      }
    }
    
    // Final validation
    if (length < 100 || length > 110) {
      console.warn(`⚠️ Final summary still ${length} chars after ${adjustmentRound} adjustment rounds: "${finalSummary}"`);
    } else {
      console.log(`✅ Summary generated: ${length} chars (after ${adjustmentRound} round(s)) - "${finalSummary}"`);
    }

    await storage.updateAnalysis(analysis.date, {
      summary: finalSummary,
      reasoning: `New event chosen by Perplexity/OpenAI after resolving contradiction. ${validationReasoning}. Original article URL: ${article.url}`,
      isManualOverride: false, // AI-driven automated cleanup, not manual entry
      perplexityVerdict: 'verified',
      perplexityReasoning: `Original event was incorrect. New date-specific event selected from ${tier} tier: ${finalSummary}`,
      perplexityCorrectDateText: null, // Clear the incorrect suggestion
      topArticleId: article.id,
      tierUsed: tier,
    });
  }

  private getCachedArticles(analysis: HistoricalNewsAnalysis): TieredArticles {
    const tieredArticles = analysis.tieredArticles;

    // Robustly check if tieredArticles is a valid object before proceeding
    if (tieredArticles === null || typeof tieredArticles !== 'object') {
      return { bitcoin: [], crypto: [], macro: [] };
    }

    const typedTieredArticles = tieredArticles as TieredArticles;

    return {
      bitcoin: typedTieredArticles.bitcoin || [],
      crypto: typedTieredArticles.crypto || [],
      macro: typedTieredArticles.macro || [],
    };
  }
}

export const perplexityCleaner = new PerplexityCleanerService();


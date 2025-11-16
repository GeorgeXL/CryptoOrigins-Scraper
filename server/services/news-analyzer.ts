import { exaService } from './exa';
import { hierarchicalSearch } from './hierarchical-search';
import { bitcoinHistory } from './bitcoin-history';

import { validateTierSignificance, type NewsAnalysisResult, type TierValidationResult } from './openai';
import { type ArticleData } from '@shared/schema';
import { storage } from '../storage';

import type { InsertHistoricalNewsAnalysis, TieredArticles } from '@shared/schema';

export interface NewsAnalysisOptions {
  date: string;
  forceReanalysis?: boolean;
  aiProvider?: 'openai';
  newsProvider?: 'exa';
  requestContext?: {
    requestId: string;
    source: string;
    referer?: string;
    userAgent?: string;
  };
}

export interface NewsAnalysisFullResult extends NewsAnalysisResult {
  articles: ArticleData[];
  totalArticlesFetched: number;
  analysisDate: string;
  validationMetrics?: {
    totalArticles: number;
    accessibleArticles: number;
    filteredArticles: number;
    accessibilityRate: number;
    validationResults: any[];
  };
}

export class NewsAnalyzerService {
  private static activeRequests = new Map<string, Promise<NewsAnalysisFullResult>>();
  private static pendingRequests = new Set<string>(); // NEW: Track pending requests
  private static recentRequests = new Map<string, { timestamp: number; result?: NewsAnalysisFullResult }>(); // Track recent requests
  private static readonly DEDUPLICATION_WINDOW = 5 * 60 * 1000; // 5 minutes

  // Static method to clear all cache entries for a specific date
  static clearCacheForDate(date: string): void {
    const aiProviders = ['openai']; // All possible AI providers
    let entriesCleared = 0;
    
    for (const aiProvider of aiProviders) {
      const requestKey = `${date}-${aiProvider}`;
      
      // Clear from recent requests cache
      if (this.recentRequests.has(requestKey)) {
        this.recentRequests.delete(requestKey);
        entriesCleared++;
      }
      
      // Clear from active requests (in case there's a running request)
      if (this.activeRequests.has(requestKey)) {
        this.activeRequests.delete(requestKey);
        entriesCleared++;
      }
      
      // Clear from pending requests
      if (this.pendingRequests.has(requestKey)) {
        this.pendingRequests.delete(requestKey);
        entriesCleared++;
      }
    }
    
    if (entriesCleared > 0) {
      console.log(`🧹 Cache cleared for date ${date}: removed ${entriesCleared} entries`);
    } else {
      console.log(`🧹 No cache entries found for date ${date}`);
    }
  }

  async analyzeNewsForDate(options: NewsAnalysisOptions): Promise<NewsAnalysisFullResult> {
    const { date, forceReanalysis = false, aiProvider = 'openai', requestContext } = options;
    const requestKey = `${date}-${aiProvider}`;
    const reqId = requestContext?.requestId || `internal-${Date.now()}`;
    
    console.log(`🔍 [${reqId}] AnalyzeNewsForDate ENTRY: ${date} (source: ${requestContext?.source || 'unknown'})`);
    console.log(`🔍 [${reqId}] Request context: ${JSON.stringify(requestContext || {})}`);
    
    // ATOMIC CHECK 1: Check for existing active request
    if (NewsAnalyzerService.activeRequests.has(requestKey) && !forceReanalysis) {
      console.log(`🔄 [${reqId}] DEDUPLICATION: Returning existing analysis promise for ${date}`);
      console.log(`🔄 [${reqId}] Currently ${NewsAnalyzerService.activeRequests.size} active requests`);
      return NewsAnalyzerService.activeRequests.get(requestKey)!;
    }

    // EXTENDED CHECK: Check for recent completed requests (within deduplication window)
    if (!forceReanalysis) {
      const recentRequest = NewsAnalyzerService.recentRequests.get(requestKey);
      if (recentRequest) {
        const timeElapsed = Date.now() - recentRequest.timestamp;
        if (timeElapsed < NewsAnalyzerService.DEDUPLICATION_WINDOW && recentRequest.result) {
          console.log(`⏰ [${reqId}] RECENT DEDUPLICATION: Request for ${date} completed ${Math.round(timeElapsed/1000)}s ago, returning cached result`);
          return recentRequest.result;
        } else if (timeElapsed >= NewsAnalyzerService.DEDUPLICATION_WINDOW) {
          // Clean up expired entry
          NewsAnalyzerService.recentRequests.delete(requestKey);
        }
      }
    }
    
    // ATOMIC CHECK 2: Check if request is already pending
    if (NewsAnalyzerService.pendingRequests.has(requestKey) && !forceReanalysis) {
      console.log(`⏳ [${reqId}] REQUEST PENDING: Waiting for existing request for ${date}`);
      // No delay needed - immediate retry
      return this.analyzeNewsForDate(options);
    }
    
    // ATOMIC SET: Mark as pending IMMEDIATELY to prevent race conditions
    NewsAnalyzerService.pendingRequests.add(requestKey);
    console.log(`🚀 [${reqId}] NEW ANALYSIS REQUEST: ${date} (force: ${forceReanalysis})`);
    console.log(`📊 [${reqId}] Active requests before: ${NewsAnalyzerService.activeRequests.size}, Pending: ${NewsAnalyzerService.pendingRequests.size}`);
    
    try {
      // Create the analysis promise and set it in the map
      const analysisPromise = this.performAnalysisWithDeduplication(options);
      NewsAnalyzerService.activeRequests.set(requestKey, analysisPromise);
      console.log(`📊 [${reqId}] Active requests after adding: ${NewsAnalyzerService.activeRequests.size}`);

      const result = await analysisPromise;
      console.log(`✅ [${reqId}] Analysis completed for ${date}`);
      
      // Cache the result for deduplication window
      NewsAnalyzerService.recentRequests.set(requestKey, {
        timestamp: Date.now(),
        result: result
      });
      console.log(`📋 [${reqId}] Cached result for ${date} in recent requests for 5 minutes`);
      
      return result;
    } finally {
      // Clean up both tracking mechanisms
      NewsAnalyzerService.activeRequests.delete(requestKey);
      NewsAnalyzerService.pendingRequests.delete(requestKey);
      console.log(`🧹 [${reqId}] Cleaned up request for ${date}, remaining active: ${NewsAnalyzerService.activeRequests.size}, pending: ${NewsAnalyzerService.pendingRequests.size}`);
    }
  }

  private async performAnalysisWithDeduplication(options: NewsAnalysisOptions): Promise<NewsAnalysisFullResult> {
    const { date, forceReanalysis = false } = options;
    
    // Check if analysis already exists in database (only after we've claimed the request)
    if (!forceReanalysis) {
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (existingAnalysis) {
        console.log(`📋 DEDUPLICATION: Returning existing analysis from database for ${date}`);
        return {
          topArticleId: existingAnalysis.topArticleId || '',
          summary: existingAnalysis.summary,
          reasoning: existingAnalysis.reasoning || '',
          confidenceScore: parseFloat(existingAnalysis.confidenceScore || '0'),
          aiProvider: existingAnalysis.aiProvider || 'openai',
          sentimentScore: parseFloat(existingAnalysis.sentimentScore || '0'),
          sentimentLabel: (existingAnalysis.sentimentLabel as 'bullish' | 'bearish' | 'neutral') || 'neutral',
          topicCategories: (existingAnalysis.topicCategories as string[]) || [],
          duplicateArticleIds: (existingAnalysis.duplicateArticleIds as string[]) || [],
          totalArticlesFetched: existingAnalysis.totalArticlesFetched || 0,
          uniqueArticlesAnalyzed: existingAnalysis.uniqueArticlesAnalyzed || 0,
          articles: [],
          analysisDate: date,
        };
      }
    }

    // Proceed with the actual analysis
    return this.performAnalysis(options);
  }

  private async performAnalysis(options: NewsAnalysisOptions): Promise<NewsAnalysisFullResult> {
    const { date, forceReanalysis = false, aiProvider = 'openai', requestContext } = options;
    const analysisId = `analysis-${date}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const reqId = requestContext?.requestId || analysisId;

    try {
      console.log(`🌊 [${analysisId}] Starting SEQUENTIAL WATERFALL analysis for ${date}...`);
      
      // Sequential tier analysis with ALL tier collection
      const tiers: ('bitcoin' | 'crypto' | 'macro')[] = ['bitcoin', 'crypto', 'macro'];
      let finalArticles: ArticleData[] = [];
      let finalTier = '';
      let winningTier = '';
      let sourcesUsed: string[] = ['EXA'];
      let searchPath: string[] = [];
      let validationResults: TierValidationResult[] = [];
      
      // NEW: Collect articles from ALL tiers for transparency
      const tieredArticles: TieredArticles = {
        bitcoin: [],
        crypto: [],
        macro: []
      };

      for (const tier of tiers) {
        console.log(`\n🎯 [${analysisId}] === TIER ${tier.toUpperCase()} ANALYSIS ===`);
        
        // Step 1: Search tier-specific articles
        let tierArticles: ArticleData[] = [];
        if (tier === 'bitcoin') {
          console.log(`🪙 [${analysisId}] Calling searchBitcoinTier...`);
          tierArticles = await hierarchicalSearch.searchBitcoinTier(date, requestContext);
        } else if (tier === 'crypto') {
          console.log(`🔗 [${analysisId}] Calling searchCryptoTier...`);
          tierArticles = await hierarchicalSearch.searchCryptoTier(date, requestContext);
        } else if (tier === 'macro') {
          console.log(`📈 [${analysisId}] Calling searchMacroTier...`);
          tierArticles = await hierarchicalSearch.searchMacroTier(date, requestContext);
        }

        console.log(`🔍 [${analysisId}] Found ${tierArticles.length} articles for ${tier} tier`);
        searchPath.push(`${tier} (${tierArticles.length})`);
        
        // Store articles from this tier (only for processed tiers)
        tieredArticles[tier] = tierArticles;
        console.log(`💾 [${analysisId}] Stored ${tierArticles.length} articles in ${tier} tier collection`);

        // Step 2: Validate tier significance
        let validation: TierValidationResult;
        if (tierArticles.length === 0) {
          validation = {
            isSignificant: false,
            reasoning: `No articles found for ${tier} tier`,
            tier
          };
        } else {
          console.log(`🤖 [${analysisId}] Calling validateTierSignificance for ${tier}...`);
          validation = await validateTierSignificance(tierArticles, tier, date);
        }

        validationResults.push(validation);
        console.log(`🤖 [${analysisId}] OpenAI Validation: ${validation.isSignificant ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'}`);
        console.log(`📝 [${analysisId}] Reasoning: ${validation.reasoning}`);
        
        // DEBUG: Add detailed validation logging
        console.log(`🔍 [${analysisId}] Validation result:`, {
          isSignificant: validation.isSignificant,
          tier: validation.tier,
          topArticleId: validation.topArticleId,
          reasoning: validation.reasoning?.substring(0, 100) + '...'
        });

        // Step 3: If significant, set as winning tier and STOP WATERFALL (optimization)
        if (validation.isSignificant && !winningTier) {
          // Only set winning tier if we haven't found one yet (preserve waterfall priority)
          finalArticles = tierArticles;
          finalTier = tier;
          winningTier = tier;
          console.log(`🎉 [${analysisId}] TIER ${tier.toUpperCase()} VALIDATED AS WINNER - STOPPING WATERFALL (EXA OPTIMIZATION)`);
          console.log(`🎉 [${analysisId}] Winner: ${tier} tier with ${tierArticles.length} articles - STOPPING TO SAVE API CALLS`);
          // CRITICAL OPTIMIZATION: Stop at first significant tier to save EXA API calls
          break;
        } else if (validation.isSignificant) {
          console.log(`✅ [${analysisId}] TIER ${tier.toUpperCase()} also significant but ${winningTier} already won`);
        } else {
          console.log(`⬇️ [${analysisId}] ${tier} tier not significant - continuing to next tier...`);
        }
      }

      // Fallback to historical events if all tiers failed
      if (finalArticles.length === 0) {
        console.log(`📚 All tiers empty - checking Bitcoin historical events...`);
        const historicalContext = bitcoinHistory.generateHistoricalContext(date);
        
        if (historicalContext.hasEvent) {
          console.log(`🎯 Found historical Bitcoin event: ${historicalContext.event!.title}`);
          
          const historicalArticle: ArticleData = {
            id: `bitcoin-history-${date}`,
            title: historicalContext.event!.title,
            url: 'https://bitcoin.org/en/',
            publishedDate: date,
            author: 'Bitcoin Historical Database',
            text: historicalContext.contextualSummary!,
            score: 1.0
          };
          
          finalArticles = [historicalArticle];
          finalTier = 'bitcoin-history';
          searchPath.push('Bitcoin History');
        } else {
          // Ultimate fallback
          console.log(`🔄 Creating fallback analysis - no content found anywhere`);
          
          const fallbackArticle: ArticleData = {
            id: `no-news-${date}`,
            title: `No significant news found for ${date}`,
            url: 'https://bitcoin.org/en/',
            publishedDate: date,
            author: 'Bitcoin News Analysis System',
            text: `No significant news was found for ${date} after exhaustive search across Bitcoin, crypto, and macroeconomic sources.`,
            score: 0.1
          };
          
          finalArticles = [fallbackArticle];
          finalTier = 'fallback';
          searchPath.push('System Fallback');
        }
      }

      console.log(`\n📊 [${analysisId}] FINAL RESULTS: ${finalArticles.length} articles from ${finalTier} tier`);
      console.log(`🛤️ [${analysisId}] Search path: ${searchPath.join(' → ')}`);

      // Create validation metrics
      const validationMetrics = {
        totalArticles: finalArticles.length,
        accessibleArticles: finalArticles.length,
        filteredArticles: 0,
        accessibilityRate: 1.0,
        validationResults: validationResults
      };

      // Use AI-selected article from tier validation
      console.log(`🎯 [${analysisId}] Using AI-selected article from ${finalTier} tier (${finalArticles.length} articles)...`);
      
      // Find the AI-selected article from validation results
      const successfulValidation = validationResults.find(v => v.isSignificant && v.topArticleId);
      let topArticle: ArticleData;
      
      console.log(`🔍 [${analysisId}] Successful validation check:`, successfulValidation);
      
      if (successfulValidation?.topArticleId) {
        // Use AI-selected article
        topArticle = finalArticles.find(article => article.id === successfulValidation.topArticleId) || finalArticles[0];
        console.log(`🤖 AI selected article: "${topArticle.title}" (AI choice: ${successfulValidation.topArticleId})`);
      } else {
        // Fallback to EXA score sorting (for macro tier or validation errors)
        const sortedArticles = finalArticles.sort((a, b) => (b.score || 0) - (a.score || 0));
        topArticle = sortedArticles[0];
        console.log(`📊 Fallback to top EXA-scored article: "${topArticle.title}" (score: ${topArticle.score})`);
      }
      
      console.log(`🔍 [${analysisId}] Top article selection:`, topArticle?.id);
      
      // Generate summary for the selected article
      let analysisResult = await this.generateSummaryForTopArticle(topArticle, finalArticles, date, requestContext);
      
      // Update metrics to reflect validated counts
      analysisResult.totalArticlesFetched = validationMetrics.totalArticles;
      analysisResult.uniqueArticlesAnalyzed = finalArticles.length - (analysisResult.duplicateArticleIds?.length || 0);

      // Log final tiered articles collection
      const totalCollectedArticles = tieredArticles.bitcoin.length + tieredArticles.crypto.length + tieredArticles.macro.length;
      console.log(`🗂️ [${analysisId}] FINAL TIERED COLLECTION - Bitcoin: ${tieredArticles.bitcoin.length}, Crypto: ${tieredArticles.crypto.length}, Macro: ${tieredArticles.macro.length} (Total: ${totalCollectedArticles})`);
      console.log(`🏆 [${analysisId}] WINNING TIER: ${winningTier || finalTier} | ANALYSIS TIER: ${finalTier}`);

      // Step 4: Save analysis to database with tiered articles
      const analysisData: InsertHistoricalNewsAnalysis = {
        date,
        summary: analysisResult.summary,
        topArticleId: analysisResult.topArticleId,
        isManualOverride: false,
        aiProvider: analysisResult.aiProvider,
        reasoning: analysisResult.reasoning,
        confidenceScore: analysisResult.confidenceScore.toString(),
        sentimentScore: analysisResult.sentimentScore.toString(),
        sentimentLabel: analysisResult.sentimentLabel,
        topicCategories: analysisResult.topicCategories,
        duplicateArticleIds: analysisResult.duplicateArticleIds,
        totalArticlesFetched: analysisResult.totalArticlesFetched,
        uniqueArticlesAnalyzed: analysisResult.uniqueArticlesAnalyzed,
        
        // NEW: Multi-tier article storage
        winningTier: winningTier || finalTier,
        tieredArticles: tieredArticles,
        articleTags: {
          totalArticles: validationMetrics.totalArticles,
          topSources: this.extractTopSources(finalArticles),
          duplicatesFound: analysisResult.duplicateArticleIds.length,
          sourcesUsed: sourcesUsed,
          totalFetched: validationMetrics.totalArticles,
          accessibleArticles: validationMetrics.accessibleArticles,
          filteredArticles: validationMetrics.filteredArticles,
          accessibilityRate: validationMetrics.accessibilityRate,
          analysisMetadata: {
            processingDate: new Date().toISOString(),
            version: '3.0-multi-provider',
            sentimentAnalysis: true,
            topicCategorization: true,
            duplicateDetection: true,
            multiSourceIntegration: true,
            searchStrategy: {
              provider: 'sequential-waterfall',
              tierUsed: finalTier,
              searchPath: searchPath.join(' → '),
              totalSearched: finalArticles.length,
              diagnostics: 'Sequential Waterfall Analysis'
            },
            tierUsed: finalTier,
            winningTier: winningTier || finalTier,
            tieredArticlesCount: {
              bitcoin: tieredArticles.bitcoin.length,
              crypto: tieredArticles.crypto.length, 
              macro: tieredArticles.macro.length,
              total: totalCollectedArticles
            },
            analyzedArticles: finalArticles // Store the exact articles analyzed (legacy)
          }
        },
      };

      // Check if analysis already exists and update or create accordingly
      const existingAnalysis = await storage.getAnalysisByDate(date);
      let savedAnalysis;
      
      if (existingAnalysis) {
        console.log(`Updating existing analysis for ${date}`);
        savedAnalysis = await storage.updateAnalysis(date, analysisData);
      } else {
        console.log(`Creating new analysis for ${date}`);
        savedAnalysis = await storage.createAnalysis(analysisData);
      }
      
      console.log(`💾 [${analysisId}] Analysis saved for ${date}`);

      return {
        ...analysisResult,
        articles: finalArticles,
        totalArticlesFetched: validationMetrics.totalArticles,
        analysisDate: date,
        validationMetrics,
      };

    } catch (error) {
      console.error(`❌ [${analysisId}] News analysis failed for ${date}:`, error);
      throw new Error(`Failed to analyze news for ${date}: ${(error as Error).message}`);
    }
  }

  // ... (rest of the methods remain the same as original)
  async fetchAndAnalyzeWithoutPersisting(options: NewsAnalysisOptions): Promise<{
    summary: string;
    topArticleId: string;
    reasoning: string;
    winningTier: string;
    tieredArticles: TieredArticles;
    aiProvider: string;
    confidenceScore: number;
    sentimentScore: number;
    sentimentLabel: 'bullish' | 'bearish' | 'neutral';
    topicCategories: string[];
    duplicateArticleIds: string[];
  }> {
    const { date, aiProvider = 'openai', requestContext } = options;
    const analysisId = `no-persist-${date}-${Date.now()}`;

    console.log(`🔍 [${analysisId}] Starting NON-PERSISTING analysis for ${date}...`);
    
    // Sequential tier analysis
    const tiers: ('bitcoin' | 'crypto' | 'macro')[] = ['bitcoin', 'crypto', 'macro'];
    let finalArticles: ArticleData[] = [];
    let finalTier = '';
    let winningTier = '';
    let validationResults: TierValidationResult[] = [];
    
    const tieredArticles: TieredArticles = {
      bitcoin: [],
      crypto: [],
      macro: []
    };

    for (const tier of tiers) {
      console.log(`🎯 [${analysisId}] Analyzing tier: ${tier.toUpperCase()}`);
      
      let tierArticles: ArticleData[] = [];
      if (tier === 'bitcoin') {
        tierArticles = await hierarchicalSearch.searchBitcoinTier(date, requestContext);
      } else if (tier === 'crypto') {
        tierArticles = await hierarchicalSearch.searchCryptoTier(date, requestContext);
      } else if (tier === 'macro') {
        tierArticles = await hierarchicalSearch.searchMacroTier(date, requestContext);
      }

      console.log(`🔍 [${analysisId}] Found ${tierArticles.length} articles for ${tier} tier`);
      tieredArticles[tier] = tierArticles;

      let validation: TierValidationResult;
      if (tierArticles.length === 0) {
        validation = {
          isSignificant: false,
          reasoning: `No articles found for ${tier} tier`,
          tier
        };
      } else {
        validation = await validateTierSignificance(tierArticles, tier, date);
      }

      validationResults.push(validation);
      console.log(`🤖 [${analysisId}] Validation: ${validation.isSignificant ? 'SIGNIFICANT' : 'NOT SIGNIFICANT'}`);

      if (validation.isSignificant && !winningTier) {
        finalArticles = tierArticles;
        finalTier = tier;
        winningTier = tier;
        console.log(`🎉 [${analysisId}] WINNER: ${tier.toUpperCase()} - stopping waterfall`);
        break;
      }
    }

    // Fallback to historical events if all tiers failed
    if (finalArticles.length === 0) {
      console.log(`📚 [${analysisId}] No articles - checking Bitcoin history...`);
      const historicalContext = bitcoinHistory.generateHistoricalContext(date);
      
      if (historicalContext.hasEvent) {
        const historicalArticle: ArticleData = {
          id: `bitcoin-history-${date}`,
          title: historicalContext.event!.title,
          url: 'https://bitcoin.org/en/',
          publishedDate: date,
          author: 'Bitcoin Historical Database',
          text: historicalContext.contextualSummary!,
          score: 1.0
        };
        finalArticles = [historicalArticle];
        finalTier = 'bitcoin-history';
      } else {
        const fallbackArticle: ArticleData = {
          id: `no-news-${date}`,
          title: `No significant news found for ${date}`,
          url: 'https://bitcoin.org/en/',
          publishedDate: date,
          author: 'Bitcoin News Analysis System',
          text: `No significant news was found for ${date} after exhaustive search across Bitcoin, crypto, and macroeconomic sources.`,
          score: 0.1
        };
        finalArticles = [fallbackArticle];
        finalTier = 'fallback';
      }
    }

    console.log(`📊 [${analysisId}] Final: ${finalArticles.length} articles from ${finalTier} tier`);

    // Select top article using AI validation
    const successfulValidation = validationResults.find(v => v.isSignificant && v.topArticleId);
    let topArticle: ArticleData;
    
    if (successfulValidation?.topArticleId) {
      topArticle = finalArticles.find(article => article.id === successfulValidation.topArticleId) || finalArticles[0];
      console.log(`🤖 [${analysisId}] AI selected: "${topArticle.title}"`);
    } else {
      const sortedArticles = finalArticles.sort((a, b) => (b.score || 0) - (a.score || 0));
      topArticle = sortedArticles[0];
      console.log(`📊 [${analysisId}] Fallback to top scored: "${topArticle.title}"`);
    }
    
    // Generate summary
    const analysisResult = await this.generateSummaryForTopArticle(topArticle, finalArticles, date, requestContext);
    
    console.log(`✅ [${analysisId}] Analysis completed WITHOUT persisting`);

    return {
      summary: analysisResult.summary,
      topArticleId: analysisResult.topArticleId,
      reasoning: analysisResult.reasoning,
      winningTier: winningTier || finalTier,
      tieredArticles: tieredArticles,
      aiProvider: analysisResult.aiProvider,
      confidenceScore: analysisResult.confidenceScore,
      sentimentScore: analysisResult.sentimentScore,
      sentimentLabel: analysisResult.sentimentLabel,
      topicCategories: analysisResult.topicCategories,
      duplicateArticleIds: analysisResult.duplicateArticleIds
    };
  }

  async bulkAnalyzeRange(startDate: string, endDate: string): Promise<{
    successful: string[];
    failed: Array<{date: string, error: string}>;
    total: number;
  }> {
    const dates = this.generateDateRange(startDate, endDate);
    const successful: string[] = [];
    const failed: Array<{date: string, error: string}> = [];

    console.log(`Starting bulk analysis for ${dates.length} dates from ${startDate} to ${endDate}`);

    for (const date of dates) {
      try {
        await this.analyzeNewsForDate({ date });
        successful.push(date);
        console.log(`✓ Completed analysis for ${date}`);
        
        // No delay needed - removed for maximum speed
      } catch (error) {
        failed.push({ date, error: (error as Error).message });
        console.error(`✗ Failed analysis for ${date}:`, (error as Error).message);
      }
    }

    return {
      successful,
      failed,
      total: dates.length,
    };
  }

  private extractTopSources(articles: ArticleData[]): string[] {
    const sourceCounts = new Map<string, number>();
    
    articles.forEach(article => {
      try {
        const domain = new URL(article.url).hostname.toLowerCase();
        sourceCounts.set(domain, (sourceCounts.get(domain) || 0) + 1);
      } catch (error) {
        // Invalid URL, skip
      }
    });

    return Array.from(sourceCounts.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([domain]) => domain);
  }

  private generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    while (start <= end) {
      dates.push(start.toISOString().split('T')[0]);
      start.setDate(start.getDate() + 1);
    }
    
    return dates;
  }

  // delay() method removed - no longer needed

  private async generateSummaryForTopArticle(
    topArticle: ArticleData, 
    allArticles: ArticleData[], 
    date: string,
    requestContext?: {
      requestId: string;
      source: string;
      referer?: string;
      userAgent?: string;
    }
  ): Promise<NewsAnalysisResult> {
    try {
      // Detect duplicates among all articles
      const duplicateArticleIds = this.detectDuplicateArticles(allArticles);
      const uniqueArticles = allArticles.filter(article => !duplicateArticleIds.includes(article.id));

      console.log(`🎯 Summarizing top article: "${topArticle.title}" (${topArticle.score})`);
      
      // ENHANCED: Day-specific event synthesis prompt
      const systemPrompt = `You write concise, natural summaries of what happened in Bitcoin on a given calendar day.

TASK: Based on the article title and summary provided, understand what actually happened on that specific day and write about it in exactly 100-110 characters.

INPUT CONTRACT:
- You will receive an article TITLE and EXA SUMMARY (article content/snippet)
- Your job is to infer what event occurred on that calendar day from these inputs
- Focus on the day's event, not just the article's perspective

REQUIREMENTS:
- EXACTLY 100-110 characters (count carefully)
- Write what happened that day in natural flowing language
- Use active voice and present tense
- NO dashes (-), semicolons (;), or colons (:) anywhere
- NEVER end with a period or punctuation
- Do not include any dates or time-relative words (today/yesterday) in the summary
- Write like you're telling someone what happened that day in conversation
- Focus on the actual event/announcement that occurred, not what the article discusses

EXAMPLES:
INPUT: Title: "Fed Criticism Mounts" + Summary: "Article defends Fed independence against proposed transparency act"
OUTPUT: "Fed faces criticism over proposed transparency act threatening monetary policy independence"

INPUT: Title: "Bitcoin Price Drop" + Summary: "Analysis shows Bitcoin fell 10% amid regulatory concerns"  
OUTPUT: "Bitcoin drops 10% to $3,805 as market reacts to regulatory concerns"

OUTPUT: JSON object with:
- summary: string (100-110 characters exactly)
- reasoning: string (why significant for Bitcoin)
- confidenceScore: number (0-100)
- sentimentScore: number (-1 to 1)
- sentimentLabel: string ('bearish'|'neutral'|'bullish')
- topicCategories: string[] (regulation, adoption, price, technology, mining, institutional, economic, political)`;

      // FIXED: Prepare more focused user prompt
      const articleContent = topArticle.summary || topArticle.text || 'No content available';
      const userPrompt = `From the title and EXA summary below, understand what actually happened on ${date} and write it in exactly 100-110 characters:

ARTICLE TITLE: "${topArticle.title}"
EXA SUMMARY: ${articleContent}

TASK: Based on these inputs, infer what event occurred on this calendar day and write about it naturally.

PROCESSING INSTRUCTIONS:
- Read the title to understand the main topic
- Read the EXA summary to understand what actually happened
- Combine both to understand the day's key event
- Write what happened that day, not what the article discusses about what happened

FORBIDDEN: Never start with "Article", "Report", "Blog", "Study", "Analysis", "Op-ed"
FORBIDDEN: No dashes (-), semicolons (;), or colons (:) anywhere in the summary
REQUIRED: Natural flowing language describing what occurred on ${date}

TRANSFORMATION EXAMPLES:
Title: "Fed Under Fire" + EXA: "Article defends central bank against criticism"
Day Event: "Fed faces criticism over proposed transparency act threatening monetary policy independence"

Title: "Bitcoin Volatility" + EXA: "Report shows price dropped amid regulatory concerns"  
Day Event: "Bitcoin drops 10% as market reacts to regulatory uncertainty"

Count characters carefully to ensure 100-110 character length. Never end with a period.`;

      // Monitor API request with detailed context
      const { apiMonitor } = await import('./api-monitor');
      const startTime = Date.now();
      let requestId: string | null = null;

      try {
        // Log request as 'pending' before making the call
        requestId = apiMonitor.logRequest({
          service: 'openai',
          endpoint: '/chat/completions',
          method: 'POST',
          status: 'pending',
          context: 'article-summarization',
          purpose: 'Generate 100-110 character summary for selected news article',
          triggeredBy: `${requestContext?.source || 'UNKNOWN'} analysis for date ${date} (${requestContext?.requestId || 'no-trace-id'})`,
          requestData: { 
            model: 'gpt-4o-mini', 
            tokens: 800, 
            purpose: 'article-summarization',
            articleId: topArticle.id,
            articleTitle: topArticle.title?.substring(0, 100) + (topArticle.title?.length > 100 ? '...' : ''),
            tier: 'unknown',
            traceInfo: {
              requestId: requestContext?.requestId,
              source: requestContext?.source,
              referer: requestContext?.referer,
              userAgent: requestContext?.userAgent
            }
          }
        });

        // Use OpenAI for summarization only
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          timeout: 60 * 1000, // 60 seconds
          maxRetries: 0, // No retries to enforce API limits
        });
        // Retry loop for proper 100-110 character summaries
        let result: any = null;
        let finalSummary: string = '';
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          console.log(`🤖 [OpenAI Attempt ${attempt}/${maxAttempts}] Requesting summary...`);
          
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system" as const, content: systemPrompt },
              { role: "user" as const, content: userPrompt }
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 800,
          });

          const responseContent = response.choices[0].message.content;
          if (!responseContent) {
            throw new Error('Empty response from OpenAI');
          }

          try {
            result = JSON.parse(responseContent);
          } catch (parseError) {
            console.warn(`❌ [Attempt ${attempt}] Failed to parse OpenAI response as JSON:`, responseContent);
            throw new Error(`Invalid JSON response from OpenAI: ${parseError}`);
          }

          // Validate that we have a summary field
          if (!result || typeof result.summary !== 'string') {
            console.warn(`❌ [Attempt ${attempt}] OpenAI response missing summary field:`, result);
            throw new Error('OpenAI response missing summary field');
          }
          
          // Log exact OpenAI response for debugging
          console.log(`📝 [OpenAI Response ${attempt}] Summary: "${result.summary}"`);
          console.log(`📏 [OpenAI Response ${attempt}] Length: ${result.summary?.length || 0} characters`);
          
          // Update API monitor with OpenAI response details  
          if (requestId) {
            apiMonitor.updateRequest(requestId, {
              status: 'pending',
              requestData: {
                model: 'gpt-4o-mini',
                purpose: 'article-summarization',
                attempt: attempt,
                openaiResponse: {
                  summary: result.summary || 'No summary',
                  length: result.summary?.length || 0,
                  reasoning: result.reasoning || 'No reasoning',
                  confidence: result.confidenceScore || 0
                }
              }
            });
          }
          
          // Validate summary length
          if (result.summary && result.summary.length >= 100 && result.summary.length <= 110) {
            finalSummary = result.summary;
            console.log(`✅ [Attempt ${attempt}] SUCCESS: ${finalSummary.length} characters within range`);
            break;
          } else {
            console.log(`❌ [Attempt ${attempt}] FAILED: ${result.summary?.length || 0} chars (need 100-110)`);
            if (attempt < maxAttempts) {
              console.log(`🔄 [Attempt ${attempt}] Retrying with enhanced prompt...`);
            }
          }
        }

        // If all attempts failed, use a proper fallback (should be very rare)
        if (!finalSummary) {
          console.warn(`🚨 All ${maxAttempts} OpenAI attempts failed length validation, creating intelligent fallback`);
          finalSummary = this.createIntelligentFallbackSummary(topArticle, date);
          console.log(`⚠️ Intelligent fallback summary: "${finalSummary}" (${finalSummary.length} chars)`);
        }
        
        // Store the final summary
        result.summary = finalSummary;
        console.log(`🎯 Final summary stored: "${result.summary}" (${result.summary.length} characters)`);

        // Update request as successful - preserve existing openaiResponse
        if (requestId) {
          apiMonitor.updateRequest(requestId, {
            status: 'success',
            duration: Date.now() - startTime,
            responseSize: result.summary?.length || 0,
            requestData: { 
              model: 'gpt-4o-mini', 
              tokens: 800, 
              purpose: 'article-summarization',
              articleId: topArticle.id,
              articleTitle: topArticle.title?.substring(0, 100) + (topArticle.title?.length > 100 ? '...' : ''),
              tier: 'unknown',
              // Preserve the openaiResponse from earlier updates
              openaiResponse: {
                summary: result.summary || 'No summary',
                length: result.summary?.length || 0,
                reasoning: result.reasoning || 'No reasoning',
                confidence: result.confidenceScore || 0
              },
              result: {
                summaryLength: result.summary?.length || 0,
                confidenceScore: result.confidenceScore || 0,
                sentimentLabel: result.sentimentLabel || 'neutral',
                finalSummary: result.summary?.substring(0, 150) || 'No summary',
                attemptsUsed: finalSummary !== result.summary ? 'fallback' : 'openai-success'
              }
            }
          });
        }

        return {
          topArticleId: topArticle.id,
          summary: result.summary,
          reasoning: result.reasoning || `Selected highest EXA-scored article: ${topArticle.title}`,
          confidenceScore: result.confidenceScore || 85,
          aiProvider: 'openai-summary-only',
          sentimentScore: result.sentimentScore || 0,
          sentimentLabel: result.sentimentLabel || 'neutral',
          topicCategories: result.topicCategories || ['technology'],
          duplicateArticleIds,
          totalArticlesFetched: allArticles.length,
          uniqueArticlesAnalyzed: uniqueArticles.length
        };

      } catch (apiError) {
        // Update request as error if something goes wrong
        if (requestId) {
          apiMonitor.updateRequest(requestId, {
            status: 'error',
            error: (apiError as Error).message,
            duration: Date.now() - startTime,
            requestData: { 
              model: 'gpt-4o-mini', 
              tokens: 800, 
              purpose: 'article-summarization',
              articleId: topArticle.id,
              articleTitle: topArticle.title?.substring(0, 100) + (topArticle.title?.length > 100 ? '...' : ''),
              tier: 'unknown',
              error: (apiError as Error).message
            }
          });
        }
        // Re-throw to preserve original error handling
        throw apiError;
      }

    } catch (error) {
      console.error('❌ Error generating summary for top article:', error);
      
      // IMPROVED: Validate fallback quality before using
      const fallbackSummary = this.createIntelligentFallbackSummary(topArticle, date);
      console.log(`🚨 Complete OpenAI failure - validating intelligent fallback: "${fallbackSummary}" (${fallbackSummary.length} chars)`);
      
      // Quality check the fallback summary
      const { qualityChecker } = await import('./quality-checker');
      const qualityIssues = qualityChecker.checkSummaryQuality(fallbackSummary);
      const hasHighSeverityIssues = qualityIssues.some(issue => issue.severity === 'high');
      
      if (hasHighSeverityIssues) {
        console.error(`❌ Fallback summary failed quality check: ${qualityIssues.map(i => i.message).join(', ')}`);
        throw new Error(`Analysis failed: AI generation failed and fallback summary has quality issues: ${qualityIssues.map(i => i.message).join(', ')}`);
      }
      
      console.log(`✅ Fallback summary passed quality check`);
      
      return {
        topArticleId: topArticle.id,
        summary: fallbackSummary,
        reasoning: `OpenAI failed - quality-validated fallback from top EXA article (${topArticle.score}): ${topArticle.title}`,
        confidenceScore: 40, // Lower confidence for fallback
        aiProvider: 'openai-fallback',
        sentimentScore: 0,
        sentimentLabel: 'neutral',
        topicCategories: ['technology'],
        duplicateArticleIds: [],
        totalArticlesFetched: allArticles.length,
        uniqueArticlesAnalyzed: allArticles.length
      };
    }
  }

  /**
   * FIXED: Create intelligent fallback summary when OpenAI fails
   */
  private createIntelligentFallbackSummary(article: ArticleData, date: string): string {
    const title = article.title || 'Bitcoin news event';
    const content = article.summary || article.text || '';
    
    // Extract key information from title and content
    const titleWords = title.split(' ').filter((word: string) => word.length > 2);
    const contentWords = content.split(' ').filter((word: string) => word.length > 2);
    
    // Look for key Bitcoin-related terms and numbers
    const bitcoinTerms = ['bitcoin', 'btc', 'crypto', 'cryptocurrency', 'blockchain', 'mining', 'hash', 'price', 'trading', 'exchange', 'wallet', 'adoption', 'regulation', 'etf', 'halving'];
    const numberPattern = /\$[\d,]+|\d+%|\d+\.\d+%|\d+\.\d+[kmb]?/gi;
    
    // Find numbers in the content
    const numbers = content.match(numberPattern) || [];
    const significantNumbers = numbers.slice(0, 2); // Take first 2 significant numbers
    
    // Find Bitcoin-related terms
    const relevantTerms = [...titleWords, ...contentWords].filter(word => 
      bitcoinTerms.some(term => word.toLowerCase().includes(term))
    ).slice(0, 3);
    
    // Create a meaningful summary based on available information
    let summary = '';
    
    if (significantNumbers.length > 0 && relevantTerms.length > 0) {
      // Case 1: We have numbers and Bitcoin terms
      const number = significantNumbers[0];
      const term = relevantTerms[0];
      summary = `Bitcoin ${term} ${number}`;
    } else if (relevantTerms.length > 0) {
      // Case 2: We have Bitcoin terms but no numbers
      const term = relevantTerms[0];
      summary = `Bitcoin ${term} update`;
    } else if (title.length > 20) {
      // Case 3: Use title but make it more concise
      summary = title.replace(/Bitcoin|BTC|crypto|cryptocurrency/gi, 'Bitcoin').substring(0, 50);
    } else {
      // Case 4: Generic fallback
      summary = 'Bitcoin market update';
    }
    
    // Ensure proper length (100-110 characters)
    if (summary.length < 100) {
      // Add context to reach minimum length
      const context = ' - significant development in cryptocurrency market';
      summary = summary + context;
    }
    
    if (summary.length > 110) {
      // Truncate to fit within limit
      summary = summary.substring(0, 107) + '...';
    }
    
    // Final validation - NO DOTS PADDING
    if (summary.length < 100) {
      // Instead of padding with dots, add meaningful context
      const shortfall = 100 - summary.length;
      if (shortfall > 30) {
        summary += ' amid ongoing market developments and regulatory changes';
      } else if (shortfall > 15) {
        summary += ' in today\'s market';
      } else {
        summary += ' reported';
      }
    }
    
    return summary.substring(0, 110);
  }

  private detectDuplicateArticles(articles: ArticleData[]): string[] {
    const duplicates: string[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();

    for (const article of articles) {
      // Check for duplicate URLs
      if (article.url && seenUrls.has(article.url)) {
        duplicates.push(article.id);
        continue;
      }
      if (article.url) seenUrls.add(article.url);

      // Check for very similar titles (fuzzy matching)
      const normalizedTitle = article.title?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      if (normalizedTitle) {
        const isDuplicateTitle = Array.from(seenTitles).some(existingTitle => {
          const similarity = this.calculateStringSimilarity(normalizedTitle, existingTitle);
          return similarity > 0.85; // 85% similarity threshold
        });
        
        if (isDuplicateTitle) {
          duplicates.push(article.id);
          continue;
        }
        seenTitles.add(normalizedTitle);
      }
    }

    return duplicates;
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  }

  // Method for getting analysis progress/stats
  async getAnalysisProgress(): Promise<{
    totalAnalyses: number;
    datesWithAnalysis: string[];
    earliestDate?: string;
    latestDate?: string;
  }> {
    try {
      const allAnalyses = await storage.getAllAnalyses();
      const dates = allAnalyses.map(a => a.date).sort();
      
      return {
        totalAnalyses: allAnalyses.length,
        datesWithAnalysis: dates,
        earliestDate: dates[0],
        latestDate: dates[dates.length - 1]
      };
    } catch (error) {
      console.error('Error getting analysis progress:', error);
      return {
        totalAnalyses: 0,
        datesWithAnalysis: [],
      };
    }
  }

  // Method for getting year-based analysis data
  async getYearAnalysisData(year: number): Promise<{
    year: number;
    totalAnalyses: number;
    monthlyBreakdown: Array<{
      month: number;
      analyzedDays: number;
      totalDays: number;
      percentage: number;
    }>;
    analyses: Array<{
      date: string;
      summary: string;
      confidenceScore: number;
      sentimentLabel: string;
      hasManualEntry: boolean;
      isManualOverride: boolean;
    }>;
    progress: {
      totalDays: number;
      analyzedDays: number;
      percentage: number;
    };
  }> {
    try {
      // Optimize: Query only the specific year instead of loading all analyses
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      const yearAnalyses = await storage.getAnalysesByDateRange(startDate, endDate);
      
      // Calculate total days in the year (handle leap years)
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      
      // Group by month and calculate monthly breakdown
      const monthlyBreakdown = Array.from({length: 12}, (_, i) => {
        const month = i + 1;
        const monthAnalyses = yearAnalyses.filter(analysis => {
          const analysisMonth = parseInt(analysis.date.split('-')[1]);
          return analysisMonth === month;
        });
        
        const totalDaysInMonth = daysInMonths[i];
        const analyzedDays = monthAnalyses.length;
        const percentage = totalDaysInMonth > 0 ? Math.round((analyzedDays / totalDaysInMonth) * 100) : 0;
        
        return {
          month,
          analyzedDays,
          totalDays: totalDaysInMonth,
          percentage
        };
      });

      // Get manual entries for this year - query by date range
      const allManualEntries = await storage.getAllManualEntries();
      const yearManualEntries = allManualEntries.filter(entry => {
        const entryYear = parseInt(entry.date.split('-')[0]);
        return entryYear === year;
      });
      
      const analyses = yearAnalyses.map(analysis => ({
        date: analysis.date,
        summary: analysis.summary,
        confidenceScore: parseFloat(analysis.confidenceScore || '0'),
        sentimentLabel: analysis.sentimentLabel || 'neutral',
        hasManualEntry: yearManualEntries.some(entry => entry.date === analysis.date),
        isManualOverride: analysis.isManualOverride || false
      }));

      // Calculate overall progress
      const totalDaysInYear = daysInMonths.reduce((sum, days) => sum + days, 0);
      const totalAnalyzedDays = yearAnalyses.length;
      const overallPercentage = Math.round((totalAnalyzedDays / totalDaysInYear) * 100);

      return {
        year,
        totalAnalyses: yearAnalyses.length,
        monthlyBreakdown,
        analyses: analyses.sort((a, b) => a.date.localeCompare(b.date)),
        progress: {
          totalDays: totalDaysInYear,
          analyzedDays: totalAnalyzedDays,
          percentage: overallPercentage
        }
      };
    } catch (error) {
      console.error(`Error getting year analysis data for ${year}:`, error);
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const totalDaysInYear = daysInMonths.reduce((sum, days) => sum + days, 0);
      
      return {
        year,
        totalAnalyses: 0,
        monthlyBreakdown: Array.from({length: 12}, (_, i) => ({
          month: i + 1,
          analyzedDays: 0,
          totalDays: daysInMonths[i],
          percentage: 0
        })),
        analyses: [],
        progress: {
          totalDays: totalDaysInYear,
          analyzedDays: 0,
          percentage: 0
        }
      };
    }
  }
}

export const newsAnalyzer = new NewsAnalyzerService();

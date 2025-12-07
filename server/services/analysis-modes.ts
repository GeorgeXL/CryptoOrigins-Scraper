import { hierarchicalSearch } from './hierarchical-search';
import { aiService } from './ai';
import { apiMonitor } from './api-monitor';
import { storage } from '../storage';
import type { ArticleData, TieredArticles, InsertHistoricalNewsAnalysis } from '@shared/schema';
import { z } from 'zod';

export interface AnalysisModeResult {
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
  totalArticlesFetched: number;
  uniqueArticlesAnalyzed: number;
  // Fact checking fields
  perplexityVerdict?: 'verified' | 'contradicted' | 'uncertain';
  perplexityApproved?: boolean;
  geminiApproved?: boolean;
  factCheckVerdict?: 'verified' | 'contradicted' | 'uncertain';
  // Selection required fields
  requiresSelection?: boolean;
  selectionMode?: 'orphan' | 'multiple';
  geminiSelectedIds?: string[];
  perplexitySelectedIds?: string[];
  intersectionIds?: string[];
  openaiSuggestedId?: string;
}

export interface AnalysisModeOptions {
  date: string;
  requestContext?: {
    requestId: string;
    source: string;
    referer?: string;
    userAgent?: string;
  };
}

/**
 * Analyse Day: Parallel Battle Analysis
 * 1. Fetch all 3 tiers from Exa in parallel
 * 2. Send all articles to Gemini and Perplexity independently (parallel)
 * 3. Find intersection of approved articles
 * 4. OpenAI selects best from intersection
 * 5. OpenAI summarizes
 * 
 * Automatically sets fact checking fields: perplexity_verdict, gemini_approved, fact_check_verdict
 */
export async function analyzeDay(options: AnalysisModeOptions): Promise<AnalysisModeResult> {
  const { date, requestContext } = options;
  const requestId = requestContext?.requestId || `analyze-${Date.now()}`;
  
  console.log(`📅 [ANALYSE DAY] Starting parallel battle analysis for ${date}`);
  
  // STEP 1: Fetch all 3 tiers in parallel
  console.log(`📥 [ANALYSE DAY] Step 1: Fetching all 3 tiers in parallel...`);
  
  const [bitcoinArticles, cryptoArticles, macroArticles] = await Promise.all([
    hierarchicalSearch.searchBitcoinTier(date, {
      ...requestContext,
      source: `${requestContext?.source || 'UNKNOWN'}-ANALYSE-DAY-BITCOIN`
    }),
    hierarchicalSearch.searchCryptoTier(date, {
      ...requestContext,
      source: `${requestContext?.source || 'UNKNOWN'}-ANALYSE-DAY-CRYPTO`
    }),
    hierarchicalSearch.searchMacroTier(date, {
      ...requestContext,
      source: `${requestContext?.source || 'UNKNOWN'}-ANALYSE-DAY-MACRO`
    })
  ]);
  
  const tieredArticles: TieredArticles = {
    bitcoin: bitcoinArticles,
    crypto: cryptoArticles,
    macro: macroArticles
  };
  
  console.log(`📊 [ANALYSE DAY] Fetched: Bitcoin=${bitcoinArticles.length}, Crypto=${cryptoArticles.length}, Macro=${macroArticles.length}`);
  
  // Flatten all articles - include URL for matching
  const allArticles: Array<{ id: string; title: string; summary?: string; url?: string }> = [];
  const articleMap = new Map<string, ArticleData>();
  
  for (const article of bitcoinArticles) {
    allArticles.push({ id: article.id, title: article.title, summary: article.summary, url: article.url });
    articleMap.set(article.id, article);
  }
  for (const article of cryptoArticles) {
    allArticles.push({ id: article.id, title: article.title, summary: article.summary, url: article.url });
    articleMap.set(article.id, article);
  }
  for (const article of macroArticles) {
    allArticles.push({ id: article.id, title: article.title, summary: article.summary, url: article.url });
    articleMap.set(article.id, article);
  }
  
  if (allArticles.length === 0) {
    console.log(`❌ [ANALYSE DAY] No articles found in any tier for ${date}`);
    console.log(`   🔄 Returning selection data for user to choose (Orphan mode - no articles found)`);
    return {
      summary: '',
      topArticleId: 'none',
      reasoning: 'No articles found in any tier for this date. User selection required.',
      winningTier: 'none',
      tieredArticles,
      aiProvider: 'openai',
      confidenceScore: 0,
      sentimentScore: 0,
      sentimentLabel: 'neutral',
      topicCategories: [],
      duplicateArticleIds: [],
      totalArticlesFetched: 0,
      uniqueArticlesAnalyzed: 0,
      perplexityVerdict: 'uncertain',
      perplexityApproved: false,
      geminiApproved: false,
      factCheckVerdict: 'uncertain',
      requiresSelection: true,
      selectionMode: 'orphan',
      geminiSelectedIds: [],
      perplexitySelectedIds: [],
      intersectionIds: []
    };
  }
  
  // STEP 2: Send to Gemini and Perplexity in parallel
  console.log(`🤖 [ANALYSE DAY] Step 2: Sending to Gemini and Perplexity in parallel...`);
  
  const geminiProvider = aiService.getProvider('gemini');
  const perplexityProvider = aiService.getProvider('perplexity');
  
  const [geminiResult, perplexityResult] = await Promise.all([
    geminiProvider.selectRelevantArticles?.(allArticles, date) || Promise.resolve({ articleIds: [], status: 'error', error: 'Method not available' }),
    perplexityProvider.selectRelevantArticles?.(allArticles, date) || Promise.resolve({ articleIds: [], status: 'error', error: 'Method not available' })
  ]);
  
  const geminiIds = Array.isArray(geminiResult.articleIds) ? geminiResult.articleIds : [];
  const perplexityIds = Array.isArray(perplexityResult.articleIds) ? perplexityResult.articleIds : [];
  
  console.log(`🔵 [ANALYSE DAY] Gemini selected: ${geminiIds.length} articles (status: ${geminiResult.status})`);
  if (geminiResult.status === 'error') {
    console.warn(`   ⚠️ Gemini error: ${geminiResult.error}`);
  } else if (geminiResult.status === 'no_matches') {
    console.log(`   ℹ️ Gemini found no relevant articles for ${date}`);
  }
  
  console.log(`🟣 [ANALYSE DAY] Perplexity selected: ${perplexityIds.length} articles (status: ${perplexityResult.status})`);
  if (perplexityResult.status === 'error') {
    console.warn(`   ⚠️ Perplexity error: ${perplexityResult.error}`);
  } else if (perplexityResult.status === 'no_matches') {
    console.log(`   ℹ️ Perplexity found no relevant articles for ${date}`);
  }
  
  // STEP 3: Find intersection and convert URLs to article IDs
  // Helper function to convert URL/ID to article ID
  const convertToArticleId = (idOrUrl: string | null | undefined): string | null => {
    if (!idOrUrl || typeof idOrUrl !== 'string') {
      return null;
    }
    // First try direct ID match
    if (articleMap.has(idOrUrl)) {
      return idOrUrl;
    }
    
    // Try URL matching
    const normalizeUrl = (url: string) => {
      try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.toLowerCase().replace(/\/$/, '');
      } catch {
        return url.toLowerCase().replace(/\/$/, '');
      }
    };
    
    const normalizedId = normalizeUrl(idOrUrl);
    
    for (const [articleId, articleData] of articleMap.entries()) {
      const articleWithUrl = articleData as any;
      if (!articleWithUrl.url) continue;
      
      if (articleWithUrl.url === idOrUrl || 
          normalizeUrl(articleWithUrl.url) === normalizedId ||
          idOrUrl.includes(articleWithUrl.url) || 
          articleWithUrl.url.includes(idOrUrl)) {
        return articleId;
      }
    }
    
    return null;
  };
  
  // Convert Gemini IDs to article IDs
  const geminiArticleIds = geminiIds
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map(id => {
      const converted = convertToArticleId(id);
      if (!converted) {
        console.warn(`   ⚠️ [ANALYSE DAY] Could not convert Gemini ID/URL to article ID: ${id.substring(0, 60)}...`);
      }
      return converted;
    })
    .filter((id): id is string => id !== null);
  const perplexityArticleIds = perplexityIds
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map(id => {
      const converted = convertToArticleId(id);
      if (!converted) {
        console.warn(`   ⚠️ [ANALYSE DAY] Could not convert Perplexity ID/URL to article ID: ${id.substring(0, 60)}...`);
      }
      return converted;
    })
    .filter((id): id is string => id !== null);
  
  console.log(`   🔵 Gemini: ${geminiIds.length} raw IDs -> ${geminiArticleIds.length} converted article IDs`);
  console.log(`   🟣 Perplexity: ${perplexityIds.length} raw IDs -> ${perplexityArticleIds.length} converted article IDs`);
  
  // Find intersection using article IDs
  const intersection = geminiArticleIds.filter(id => perplexityArticleIds.includes(id));
  console.log(`🔍 [ANALYSE DAY] Intersection: ${intersection.length} matching article(s)`);
  console.log(`   🔵 Gemini IDs: ${geminiIds.slice(0, 3).join(', ')}${geminiIds.length > 3 ? '...' : ''}`);
  console.log(`   🔵 Gemini Article IDs: ${geminiArticleIds.slice(0, 3).join(', ')}${geminiArticleIds.length > 3 ? '...' : ''}`);
  console.log(`   🟣 Perplexity IDs: ${perplexityIds.slice(0, 3).join(', ')}${perplexityIds.length > 3 ? '...' : ''}`);
  console.log(`   🟣 Perplexity Article IDs: ${perplexityArticleIds.slice(0, 3).join(', ')}${perplexityArticleIds.length > 3 ? '...' : ''}`);
  
  if (intersection.length === 0) {
    console.log(`❌ [ANALYSE DAY] No matching articles found (no intersection)`);
    console.log(`   This means Gemini and Perplexity didn't agree on any articles.`);
    console.log(`   🔄 Returning selection data for user to choose (Orphan mode)`);
    return {
      summary: '',
      topArticleId: 'none',
      reasoning: 'No articles were approved by both Gemini and Perplexity. User selection required.',
      winningTier: 'none',
      tieredArticles,
      aiProvider: 'openai',
      confidenceScore: 0,
      sentimentScore: 0,
      sentimentLabel: 'neutral',
      topicCategories: [],
      duplicateArticleIds: [],
      totalArticlesFetched: allArticles.length,
      uniqueArticlesAnalyzed: 0,
      perplexityVerdict: 'uncertain',
      perplexityApproved: false,
      geminiApproved: false,
      factCheckVerdict: 'uncertain',
      requiresSelection: true,
      selectionMode: 'orphan',
      geminiSelectedIds: geminiArticleIds,
      perplexitySelectedIds: perplexityArticleIds,
      intersectionIds: []
    };
  }
  
  // STEP 4: Handle intersection cases
  let selectedArticle: ArticleData;
  
  if (intersection.length === 1) {
    // Single match - auto-continue
    const articleId = intersection[0]; // This is now an article ID (already converted)
    const article = articleMap.get(articleId);
    
    if (!article) {
      console.error(`❌ [ANALYSE DAY] Article ${articleId} not found in articleMap!`);
      throw new Error(`Article ${articleId} not found in articleMap`);
    }
    selectedArticle = article;
    console.log(`✅ [ANALYSE DAY] Single match found: ${articleId}`);
    console.log(`   📰 Article title: "${selectedArticle.title.substring(0, 60)}..."`);
    // Continue to summarization below
  } else {
    // Multiple matches - get OpenAI suggestion and return for user confirmation
    console.log(`🔀 [ANALYSE DAY] Multiple matches (${intersection.length}), asking OpenAI to select best...`);
    
    const candidateArticles = intersection.map(id => articleMap.get(id)!).filter(Boolean);
    console.log(`   📋 Candidates: ${candidateArticles.map(a => a.id).join(', ')}`);
    
    if (candidateArticles.length === 0) {
      console.error(`❌ [ANALYSE DAY] No valid candidate articles found!`);
      throw new Error('No valid candidate articles found in intersection');
    }
    
    // Try to get OpenAI suggestion, but if it fails, still return selection data
    let openaiSuggestedId: string | undefined = undefined;
    try {
      const openaiSuggestedIdOrUrl = await selectBestArticleWithOpenAI(candidateArticles, date, tieredArticles, requestId);
      
      // Convert OpenAI's suggestion (might be URL or ID) to article ID
      const openaiSuggestedArticleId = convertToArticleId(openaiSuggestedIdOrUrl);
      
      // Verify the suggested article exists
      const suggestedArticle = openaiSuggestedArticleId ? articleMap.get(openaiSuggestedArticleId) : null;
      
      if (suggestedArticle) {
        openaiSuggestedId = suggestedArticle.id;
        console.log(`✅ [ANALYSE DAY] OpenAI suggested: ${openaiSuggestedIdOrUrl} -> ${openaiSuggestedId}`);
        console.log(`   📰 Article title: "${suggestedArticle.title.substring(0, 60)}..."`);
      } else {
        console.warn(`⚠️ [ANALYSE DAY] OpenAI suggested article ${openaiSuggestedIdOrUrl} (converted: ${openaiSuggestedArticleId}) not found in articleMap, will use first candidate`);
        openaiSuggestedId = candidateArticles[0].id;
      }
    } catch (openaiError) {
      console.error(`⚠️ [ANALYSE DAY] OpenAI selection failed: ${(openaiError as Error).message}`);
      console.log(`   🔄 Continuing without OpenAI suggestion - user will select manually`);
      // Use first candidate as fallback suggestion
      openaiSuggestedId = candidateArticles[0].id;
      console.log(`   📋 Fallback suggestion: ${openaiSuggestedId}`);
    }
    
    console.log(`   🔄 Returning selection data for user confirmation (Verified mode)`);
    
    // Return early with selection data (even if OpenAI failed)
    return {
      summary: '',
      topArticleId: 'none',
      reasoning: openaiSuggestedId 
        ? `Multiple articles matched. OpenAI suggested: ${openaiSuggestedId}. User confirmation required.`
        : `Multiple articles matched. User selection required.`,
      winningTier: 'none',
      tieredArticles,
      aiProvider: 'openai',
      confidenceScore: 0,
      sentimentScore: 0,
      sentimentLabel: 'neutral',
      topicCategories: [],
      duplicateArticleIds: [],
      totalArticlesFetched: allArticles.length,
      uniqueArticlesAnalyzed: 0,
      perplexityVerdict: 'verified',
      perplexityApproved: true,
      geminiApproved: true,
      factCheckVerdict: 'verified',
      requiresSelection: true,
      selectionMode: 'multiple',
      geminiSelectedIds: geminiArticleIds,
      perplexitySelectedIds: perplexityArticleIds,
      intersectionIds: intersection,
      openaiSuggestedId: openaiSuggestedId
    };
  }
  
  // Only reach here if intersection.length === 1 (single match, auto-continue)
  if (intersection.length !== 1) {
    throw new Error('Unexpected state: should only reach summarization with single match');
  }
  
  // Continue with the single match case - verify article exists
  if (!selectedArticle) {
    throw new Error('Selected article not found');
  }
  
  // Determine winning tier
  let winningTier = 'bitcoin';
  if (tieredArticles.crypto.some(a => a.id === selectedArticle.id)) {
    winningTier = 'crypto';
  } else if (tieredArticles.macro.some(a => a.id === selectedArticle.id)) {
    winningTier = 'macro';
  }
  console.log(`   🏆 Winning tier: ${winningTier}`);
  
  // STEP 5: OpenAI summarizes
  console.log(`📝 [ANALYSE DAY] Step 5: Generating summary with OpenAI...`);
  console.log(`   📝 Article ID: ${selectedArticle.id}`);
  console.log(`   📝 Article title: "${selectedArticle.title.substring(0, 60)}..."`);
  
  try {
    const summaryResult = await generateSummaryWithOpenAI(selectedArticle.id, [selectedArticle], date, winningTier, requestId);
    console.log(`   ✅ Summary generated successfully: "${summaryResult.summary.substring(0, 60)}${summaryResult.summary.length > 60 ? '...' : ''}" (${summaryResult.summary.length} chars)`);
    
    return {
      ...summaryResult,
      tieredArticles,
      winningTier,
      totalArticlesFetched: allArticles.length,
      uniqueArticlesAnalyzed: allArticles.length,
      duplicateArticleIds: [],
      // Fact checking fields - automatically verified since both approved
      perplexityVerdict: 'verified',
      perplexityApproved: true,
      geminiApproved: true,
      factCheckVerdict: 'verified'
    };
  } catch (error) {
    console.error(`💥 [ANALYSE DAY] Error generating summary:`, error);
    console.error(`   Stack:`, (error as Error).stack);
    throw error;
  }
}

/**
 * Validate a tier's articles with OpenAI to check if they contain significant events
 */
async function validateTierWithOpenAI(
  articles: ArticleData[],
  date: string,
  tier: string,
  requestId: string
): Promise<{ isSignificant: boolean; topArticleId?: string; reasoning: string }> {
  const openaiProvider = aiService.getProvider('openai');
  
  const articlesText = articles.map((a, i) => 
    `Article ${i + 1} (ID: ${a.id}):
Title: ${a.title}
Summary: ${a.summary || a.text?.slice(0, 200) || 'N/A'}`
  ).join('\n\n');
  
  const prompt = `You are analyzing ${tier} news articles for ${date}. Determine if any of these articles describe a significant event that happened on or around this date.

ARTICLES:
${articlesText}

Task:
1. Determine if any article describes a significant event (not just general analysis or trends)
2. If significant, select the most important article ID
3. Return your decision

Return JSON:
{
  "isSignificant": boolean,
  "topArticleId": "article-id or null",
  "reasoning": "brief explanation"
}`;
  
  const validationRequestId = apiMonitor.logRequest({
    service: 'openai',
    endpoint: '/chat/completions',
    method: 'POST',
    status: 'pending',
    context: 'tier-validation',
    purpose: `Validate ${tier} tier significance`,
    date: date,
    triggeredBy: `${requestId} ${tier} tier validation`
  });
  
  try {
    const validationSchema = z.object({
      isSignificant: z.boolean(),
      topArticleId: z.string().nullable(),
      reasoning: z.string()
    });
    
    const result = await openaiProvider.generateJson<{ isSignificant: boolean; topArticleId: string | null; reasoning: string }>({
      prompt,
      model: 'gpt-4o-mini',
      temperature: 0.2,
      maxTokens: 500,
      schema: validationSchema
    });
    
    apiMonitor.updateRequest(validationRequestId, {
      status: 'success'
    });
    
    return {
      isSignificant: result.isSignificant,
      topArticleId: result.topArticleId || undefined,
      reasoning: result.reasoning
    };
  } catch (error) {
    apiMonitor.updateRequest(validationRequestId, {
      status: 'error',
      error: (error as Error).message
    });
    throw error;
  }
}

/**
 * Generate summary for a selected article using OpenAI
 * Exported for use in manual article selection
 */
export async function generateSummaryWithOpenAI(
  articleId: string,
  articles: ArticleData[],
  date: string,
  tier: string,
  requestId: string
): Promise<Omit<AnalysisModeResult, 'tieredArticles' | 'winningTier' | 'totalArticlesFetched' | 'uniqueArticlesAnalyzed' | 'duplicateArticleIds'>> {
  const openaiProvider = aiService.getProvider('openai');
  
  const article = articles.find(a => a.id === articleId) || articles[0];
  const articleText = (article.text || article.summary || '').substring(0, 2000);
  
  const summaryRequestId = apiMonitor.logRequest({
    service: 'openai',
    endpoint: '/chat/completions',
    method: 'POST',
    status: 'pending',
    context: 'summary-generation',
    purpose: `Generate summary for ${tier} tier article`,
    date: date,
    triggeredBy: `${requestId} summary generation`
  });
  
  try {
    // Use generateCompletion - just get the summary text (plain text, not JSON)
    const summaryPrompt = `Create a summary for a historical timeline entry from this article.

Date: ${date}
Tier: ${tier}
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

IMPORTANT: After writing your summary, count the characters. If it's not between 100-110 characters, rewrite it until it is. Return ONLY the summary text, nothing else.`;
    
    let summaryResult = await openaiProvider.generateCompletion({
      prompt: summaryPrompt,
      model: 'gpt-4o-mini',
      maxTokens: 150,
      temperature: 0.2,
      context: 'summary-generation',
      purpose: `Generate summary for ${tier} tier article`
    });
    
    let finalSummary = summaryResult.text.trim();
    let length = finalSummary.length;
    let adjustmentRound = 0;
    const maxAdjustmentRounds = 3;
    
    console.log(`   📝 Initial summary (${length} chars): "${finalSummary.substring(0, 60)}${finalSummary.length > 60 ? '...' : ''}"`);
    
    while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
      adjustmentRound++;
      console.log(`   ⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting...`);
      
      if (length < 100) {
        const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary text (100-110 chars), nothing else.`;
        
        const adjusted = await openaiProvider.generateCompletion({
          prompt: adjustPrompt,
          model: 'gpt-4o-mini',
          maxTokens: 150,
          temperature: 0.2,
          context: 'summary-adjustment',
          purpose: `Adjust summary length (round ${adjustmentRound})`
        });
        
        finalSummary = adjusted.text.trim();
        length = finalSummary.length;
        console.log(`   📝 After adjustment round ${adjustmentRound} (${length} chars): "${finalSummary.substring(0, 60)}${finalSummary.length > 60 ? '...' : ''}"`);
      } else if (length > 110) {
        const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary text (100-110 chars), nothing else.`;
        
        const adjusted = await openaiProvider.generateCompletion({
          prompt: adjustPrompt,
          model: 'gpt-4o-mini',
          maxTokens: 150,
          temperature: 0.2,
          context: 'summary-adjustment',
          purpose: `Adjust summary length (round ${adjustmentRound})`
        });
        
        finalSummary = adjusted.text.trim();
        length = finalSummary.length;
        console.log(`   📝 After adjustment round ${adjustmentRound} (${length} chars): "${finalSummary.substring(0, 60)}${finalSummary.length > 60 ? '...' : ''}"`);
      }
    }
    
    // Final validation - ensure summary is not empty
    if (!finalSummary || finalSummary.trim().length === 0) {
      console.error(`❌ [${requestId}] Summary generation failed - returned empty string`);
      apiMonitor.updateRequest(summaryRequestId, {
        status: 'error',
        error: 'Summary generation returned empty string'
      });
      throw new Error(`Summary generation failed for ${date} - OpenAI returned empty summary`);
    }
    
    // Warn if still outside range but use it anyway
    if (length < 100 || length > 110) {
      console.warn(`⚠️ [${requestId}] Summary length ${length} chars is outside 100-110 range, but using it anyway: "${finalSummary.substring(0, 50)}..."`);
    } else {
      console.log(`✅ [${requestId}] Summary generated successfully: ${length} chars`);
    }
    
    apiMonitor.updateRequest(summaryRequestId, {
      status: 'success'
    });
    
    return {
      summary: finalSummary,
      topArticleId: articleId,
      reasoning: `Selected article from ${tier} tier for ${date}`,
      aiProvider: 'openai',
      confidenceScore: 75,
      sentimentScore: 0,
      sentimentLabel: 'neutral' as const,
      topicCategories: []
    };
  } catch (error) {
    apiMonitor.updateRequest(summaryRequestId, {
      status: 'error',
      error: (error as Error).message
    });
    throw error;
  }
}

/**
 * Select best article from multiple candidates using OpenAI
 */
async function selectBestArticleWithOpenAI(
  candidateArticles: ArticleData[],
  date: string,
  tieredArticles: TieredArticles,
  requestId: string
): Promise<string> {
  const openaiProvider = aiService.getProvider('openai');
  
  const articlesText = candidateArticles.map((article, idx) => {
    let articleTier = 'bitcoin';
    if (tieredArticles.crypto.some(a => a.id === article.id)) {
      articleTier = 'crypto';
    } else if (tieredArticles.macro.some(a => a.id === article.id)) {
      articleTier = 'macro';
    }
    
    return `Article ${idx + 1} (ID: ${article.id}):
Title: ${article.title}
Summary: ${article.summary || article.text?.substring(0, 300) || 'N/A'}
Tier: ${articleTier}`;
  }).join('\n\n');
  
  const prompt = `You are selecting the most relevant news article for a Bitcoin/crypto timeline entry for ${date}.

ARTICLES:
${articlesText}

Priority hierarchy (most to least important):
1. Bitcoin-related news (price movements, halvings, protocol updates, Bitcoin companies)
2. Web3/Crypto news (Ethereum, DeFi, NFTs, other cryptocurrencies, crypto companies)
3. Macroeconomics news (general economic events, regulations affecting crypto)

Select the article that is MOST relevant to Bitcoin and cryptocurrency history. Return ONLY the article ID.

Format: "id"`;
  
  const selectionRequestId = apiMonitor.logRequest({
    service: 'openai',
    endpoint: '/chat/completions',
    method: 'POST',
    status: 'pending',
    context: 'new-way-article-selection',
    purpose: 'Select best article from intersection',
    date: date,
    triggeredBy: `${requestId} article selection`
  });
  
  try {
    const result = await openaiProvider.generateCompletion({
      prompt,
      model: 'gpt-4o-mini',
      maxTokens: 50,
      temperature: 0.2
    });
    
    const selectedId = result.text.trim().replace(/"/g, '');
    
    apiMonitor.updateRequest(selectionRequestId, {
      status: 'success'
    });
    
    return selectedId;
  } catch (error) {
    apiMonitor.updateRequest(selectionRequestId, {
      status: 'error',
      error: (error as Error).message
    });
    throw error;
  }
}


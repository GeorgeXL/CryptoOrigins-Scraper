import OpenAI from "openai";
import { periodDetector } from './period-detector';
import { type ArticleData } from '@shared/schema';

export const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ OPENAI_API_KEY is missing. OpenAI features will fail.");
  }
  return new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY
  });
};

// Error categorization function for better monitoring
function getErrorCategory(errorMessage: string): 'validation' | 'network' | 'rate-limit' | 'parsing' | 'other' {
  const message = errorMessage.toLowerCase();
  
  if (message.includes('summary length') || message.includes('character') || message.includes('100-110')) {
    return 'validation';
  }
  if (message.includes('rate limit') || message.includes('quota') || message.includes('too many requests')) {
    return 'rate-limit';
  }
  if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
    return 'network';
  }
  if (message.includes('json') || message.includes('parse') || message.includes('invalid response')) {
    return 'parsing';
  }
  
  return 'other';
}

// Smart summary length correction functions
function expandSummary(summary: string, targetLength: number): string {
  const currentLength = summary.length;
  const needed = targetLength - currentLength;
  
  // First remove any ending punctuation
  let cleanSummary = summary.replace(/[.!,;:\-]\s*$/, '').trim();
  
  if (needed <= 0) return cleanSummary;
  
  // Try to expand by adding descriptive words or details
  const expandedSummary = cleanSummary
    .replace(/(\d+)%/g, '$1 percent')  // Convert % to percent
    .replace(/\b(says|said)\b/g, 'announces')  // More descriptive verbs
    .replace(/\b(big|large)\b/g, 'significant')  // More descriptive adjectives
    .replace(/\b(cuts|cut)\b/g, 'reduces')  // More descriptive verbs
    .replace(/\$(\d+)B/g, '$$$1 billion')  // Expand abbreviated amounts
    .replace(/\$(\d+)M/g, '$$$1 million');
    
  // If still too short, try adding contextual words
  if (expandedSummary.length < targetLength) {
    const remaining = targetLength - expandedSummary.length;
    if (remaining <= 10) {
      // Add minimal context words
      const enhanced = expandedSummary
        .replace(/\b(announces)\b/g, 'officially announces')
        .replace(/\b(reports)\b/g, 'officially reports')
        .replace(/\b(policy)\b/g, 'new policy');
      return enhanced.replace(/[.!,;:\-]\s*$/, '').trim();
    }
  }
  
  return (expandedSummary.length <= 120 ? expandedSummary : cleanSummary).replace(/[.!,;:\-]\s*$/, '').trim();
}

function trimSummary(summary: string, maxLength: number): string {
  if (summary.length <= maxLength) {
    // Remove ending punctuation even if length is OK
    return summary.replace(/[.!,;:\-]\s*$/, '').trim();
  }
  
  // Try intelligent trimming
  let trimmed = summary
    .replace(/\b(officially|reportedly|apparently)\s+/g, '')  // Remove adverbs
    .replace(/\s+(that|which)\s+/g, ' ')  // Remove relative pronouns
    .replace(/\s+in\s+order\s+to\s+/g, ' to ')  // Simplify phrases
    .replace(/\s+due\s+to\s+/g, ' from ')  // Simplify phrases
    .replace(/\s+as\s+a\s+result\s+of\s+/g, ' from ')  // Simplify phrases
    .replace(/\s{2,}/g, ' ')  // Remove extra spaces
    .trim();
    
  // If still too long, trim from the end preserving important parts
  if (trimmed.length > maxLength) {
    // Try to keep the main action and subject intact
    const words = trimmed.split(' ');
    while (words.length > 0 && words.join(' ').length > maxLength) {
      words.pop();
    }
    trimmed = words.join(' ');
  }
  
  // ALWAYS remove forbidden ending punctuation
  trimmed = trimmed.replace(/[.!,;:\-]\s*$/, '').trim();
  
  return trimmed.length >= 100 ? trimmed : summary;
}

// Duplicate article detection function
function detectDuplicateArticles(articles: ArticleData[]): string[] {
  const duplicateIds: string[] = [];
  const seen = new Map<string, string>();

  for (const article of articles) {
    // Create similarity key based on title and content
    const titleWords = article.title.toLowerCase().split(' ').filter(word => word.length > 3);
    const contentPreview = article.text ? article.text.slice(0, 200).toLowerCase() : '';
    
    // Check for similar titles (70% word overlap)
    for (const [existingKey, existingId] of Array.from(seen.entries())) {
      const [existingTitle] = existingKey.split('|');
      const existingWords = existingTitle.split(' ');
      
      const overlap = titleWords.filter(word => existingWords.includes(word)).length;
      const similarity = overlap / Math.max(titleWords.length, existingWords.length);
      
      if (similarity > 0.7) {
        duplicateIds.push(article.id);
        break;
      }
    }
    
    if (!duplicateIds.includes(article.id)) {
      const key = `${titleWords.join(' ')}|${contentPreview}`;
      seen.set(key, article.id);
    }
  }

  return duplicateIds;
}


export interface NewsAnalysisResult {
  topArticleId: string;
  summary: string;
  reasoning: string;
  confidenceScore: number;
  aiProvider: string;
  sentimentScore: number; // -1 to 1 (bearish to bullish)
  sentimentLabel: 'bullish' | 'bearish' | 'neutral';
  topicCategories: string[]; // ['regulation', 'adoption', 'price', 'technology', 'mining', 'institutional']
  duplicateArticleIds: string[]; // IDs of duplicate articles found
  totalArticlesFetched: number;
  uniqueArticlesAnalyzed: number;
}

// Early Bitcoin analysis for pre-public awareness dates
async function generateEarlyBitcoinAnalysis(articles: ArticleData[], date: string): Promise<NewsAnalysisResult> {
  const analysisDate = new Date(date);
  // Removed hardcoded Genesis block handling to allow proper sequential tier analysis
  
  // For other early Bitcoin dates, analyze actual articles using AI
  if (articles.length === 0) {
    return {
      topArticleId: 'none',
      summary: 'Bitcoin network operational but no significant news events found for this date.',
      reasoning: `Early Bitcoin period (${date}): Bitcoin network was operational but unknown to the general public. No relevant news articles were found for this specific date.`,
      confidenceScore: 25,
      aiProvider: 'openai',
      sentimentScore: 0,
      sentimentLabel: 'neutral',
      topicCategories: ['economic', 'technology'],
      duplicateArticleIds: [],
      totalArticlesFetched: 0,
      uniqueArticlesAnalyzed: 0
    };
  }
  
  // Use OpenAI to analyze the actual articles for early Bitcoin period
  console.log(`🤖 Using OpenAI to analyze ${articles.length} articles for early Bitcoin period: ${date}`);
  
  try {
    // Detect and remove duplicate articles
    const duplicateArticleIds = detectDuplicateArticles(articles);
    const uniqueArticles = articles.filter(article => !duplicateArticleIds.includes(article.id));
    
    // Create a period-specific system prompt for early Bitcoin era
    const systemPrompt = `You are analyzing news from the early Bitcoin period (${date}). Bitcoin was operational and this period contains critical Bitcoin development history.

MANDATORY PRIORITY HIERARCHY (strictly ordered):
1. BITCOIN PROTOCOL RELEASES & UPDATES (highest priority - always select if present)
2. SATOSHI COMMUNICATIONS & BITCOIN DEVELOPMENT (second highest priority)
3. Early cryptocurrency or digital currency developments 
4. Macroeconomic events (lowest priority - only if no Bitcoin content exists)

CRITICAL INSTRUCTION: If any article discusses Bitcoin protocol versions, releases, updates, or Satoshi communications, that article MUST be selected as the most significant, regardless of other news events.

TASK: Analyze ${uniqueArticles.length} articles and identify the most significant event, with Bitcoin developments taking absolute priority.

OUTPUT: Respond with a JSON object containing these exact fields:
- topArticleId: string (article ID)
- summary: string (CRITICAL: Must be EXACTLY 100-110 characters including all spaces and punctuation. Count carefully! Example lengths: 100="Federal Reserve cuts rates to 0.25% amid market volatility concerns.", 110="European Central Bank implements €750 billion quantitative easing program to combat coronavirus impacts.")
- reasoning: string (why this article was selected and its relevance to Bitcoin's eventual purpose)
- confidenceScore: number (0-100)
- sentimentScore: number (-1 to 1, based on the news event)
- sentimentLabel: string ('bullish'|'bearish'|'neutral')
- topicCategories: string[] (from: regulation, adoption, price, technology, mining, institutional, economic, political)

QUALITY: Focus on factual events that occurred on this date. Use active voice. Always prioritize Bitcoin developments over financial news.`;

    // Create user prompt with articles
    const userPrompt = `# Early Bitcoin Period Analysis for ${date}

Analyze these ${uniqueArticles.length} articles and select the most significant news event:

${formatArticlesForPrompt(uniqueArticles, date)}

## Requirements:
- PRIORITIZE BITCOIN: If any article covers Bitcoin releases, updates, or Satoshi communications, select that as most significant
- If no Bitcoin content exists, then select the most significant macroeconomic event
- Write a factual summary (MUST be EXACTLY 100-110 characters including spaces/punctuation - count every character!)
- Use active voice: "Satoshi releases Bitcoin v0.1.5" or "Company announces X"
- Bitcoin protocol developments are THE most important news for early Bitcoin history`;

    // Monitor API request with detailed context
    const { apiMonitor } = await import('./api-monitor');
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'early-bitcoin-analysis',
      purpose: 'Analyze early Bitcoin period articles for historical significance',
      triggeredBy: `Early Bitcoin period analysis for ${date}`,
      date: date,
      requestData: { 
        model: 'gpt-4o-mini', 
        tokens: 1500, 
        purpose: 'early-bitcoin-analysis',
        articlesCount: articles.length,
        period: 'pre-public-bitcoin'
      }
    });
    
    // Single attempt only - no retries to enforce API limit
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
    });

    const responseContent = response.choices[0].message.content;
    if (!responseContent) {
      throw new Error('Empty response from OpenAI');
    }

    const result = JSON.parse(responseContent);
    console.log(`✅ Early Bitcoin analysis successful: ${result.summary?.length || 0} characters`);
    
    // Update request as successful
    apiMonitor.updateRequest(requestId, {
      status: 'success',
      duration: Date.now() - startTime,
      responseSize: result?.tokens_used || 0,
      requestData: { 
        model: 'gpt-4o-mini', 
        tokens: 1500, 
        purpose: 'early-bitcoin-analysis',
        articlesCount: articles.length,
        period: 'pre-public-bitcoin',
        result: {
          summaryLength: result.summary?.length || 0,
          confidenceScore: result.confidenceScore || 0,
          sentimentLabel: result.sentimentLabel || 'neutral'
        }
      }
    });
    
    // Validate the result structure
    if (!result.topArticleId || !result.summary || !result.reasoning) {
      throw new Error('Invalid OpenAI response structure');
    }

    return {
      topArticleId: result.topArticleId,
      summary: result.summary,
      reasoning: result.reasoning,
      confidenceScore: Math.min(100, Math.max(0, result.confidenceScore || 75)),
      aiProvider: 'openai',
      sentimentScore: Math.min(1, Math.max(-1, result.sentimentScore || 0)),
      sentimentLabel: result.sentimentLabel || 'neutral',
      topicCategories: result.topicCategories || ['economic'],
      duplicateArticleIds,
      totalArticlesFetched: articles.length,
      uniqueArticlesAnalyzed: uniqueArticles.length
    };

  } catch (error) {
    // Log error without monitoring variables that aren't in scope
    
    console.error(`Failed to analyze early Bitcoin period articles: ${error}`);
    
    // Fallback to analyzing the most relevant article based on title
    const fallbackArticle = articles.find(article => {
      const title = article.title.toLowerCase();
      return title.includes('financial') || title.includes('economic') || 
             title.includes('bank') || title.includes('crisis') || 
             title.includes('monetary') || title.includes('debt');
    }) || articles[0];
    
    return {
      topArticleId: fallbackArticle?.id || 'none',
      summary: fallbackArticle ? 
        createValidLengthSummary(`Major economic news: ${fallbackArticle.title}`, 100, 110) : 
        'Bitcoin network was operational but comprehensive analysis failed for this date. Limited data available.',
      reasoning: `Early Bitcoin period (${date}): Analysis focused on macroeconomic context. ${fallbackArticle ? 'Selected article represents significant financial/economic event from this period.' : 'No articles available for analysis.'}`,
      confidenceScore: 50,
      aiProvider: 'openai',
      sentimentScore: 0,
      sentimentLabel: 'neutral',
      topicCategories: ['economic'],
      duplicateArticleIds: [],
      totalArticlesFetched: articles.length,
      uniqueArticlesAnalyzed: articles.length
    };
  }
}

export async function analyzeNewsArticles(
  articles: ArticleData[], 
  date: string,
  historicalContext?: string
): Promise<NewsAnalysisResult> {
  try {
    console.log(`🔍 Starting period-aware analysis of ${articles.length} articles for ${date}`);
    
    // Special handling for very early Bitcoin dates (before public awareness)
    const analysisDate = new Date(date);
    const isPreBitcoinNetwork = analysisDate.getTime() < new Date('2009-01-03').getTime(); // Before network launch
    const isPreBitcoinPublic = analysisDate.getTime() < new Date('2010-05-01').getTime(); // Before pizza transaction
    
    // Skip analysis for dates before Bitcoin network launch
    if (isPreBitcoinNetwork) {
      throw new Error(`Analysis not available for ${date} - Bitcoin network launched on January 3, 2009`);
    }
    
    console.log(`🔍 Date comparison debug: ${date} - isPreBitcoinNetwork: ${isPreBitcoinNetwork}, isPreBitcoinPublic: ${isPreBitcoinPublic}`);
    
    // Check if Bitcoin articles have meaningful content (prefer summary over text)
    const hasSubstantialBitcoinContent = articles.some(article => {
      const getBestContent = (article: any) => {
        // Prefer EXA summary if available, fallback to text
        if (article.summary && article.summary.length > 50) {
          return article.summary;
        }
        return article.text || '';
      };
      
      const content = `${article.title || ''} ${getBestContent(article)}`.toLowerCase();
      const hasBitcoinTerms = content.includes('bitcoin') || content.includes('btc') || content.includes('cryptocurrency');
      const hasSubstantialText = getBestContent(article).length > 100;
      return hasBitcoinTerms && hasSubstantialText;
    });
    
    // Use early Bitcoin analysis for pre-public dates OR when Bitcoin content is insufficient
    if (isPreBitcoinPublic || (!hasSubstantialBitcoinContent && analysisDate.getTime() < new Date('2011-01-01').getTime())) {
      console.log(`🕰️ Early Bitcoin period analysis: ${date} - prePublic: ${isPreBitcoinPublic}, substantialContent: ${hasSubstantialBitcoinContent}`);
      return await generateEarlyBitcoinAnalysis(articles, date);
    }
    
    // Period Detection & Context
    const periodContext = periodDetector.getPeriodContext(date);
    const targetYear = new Date(date).getFullYear();
    
    console.log(`📅 Analysis period: ${periodContext.period.name} (${periodContext.period.id})`);
    console.log(`🎯 Period keywords: ${periodContext.period.keywords.boost.slice(0, 3).join(', ')}`);
    
    // Detect and remove duplicate articles
    const duplicateArticleIds = detectDuplicateArticles(articles);
    const uniqueArticles = articles.filter(article => !duplicateArticleIds.includes(article.id));
    
    console.log(`Found ${duplicateArticleIds.length} duplicate articles, analyzing ${uniqueArticles.length} unique articles`);
    
    // Get historical events for date awareness
    const { bitcoinHistory } = await import('./bitcoin-history');
    const historicalContext = bitcoinHistory.generateHistoricalContext(date);
    
    // Log historical context detection for anniversaries
    if (historicalContext.hasEvent) {
      console.log(`🎉 Historical anniversary detected for ${date}: ${historicalContext.event?.title}`);
    }
    
    // Build concise, focused system prompt
    const systemPrompt = generateSystemPrompt(periodContext, date, uniqueArticles.length, historicalContext, uniqueArticles);

    // Sort articles by date proximity to target date, then by relevance score
    const targetDate = new Date(date);
    const sortedArticles = articles.sort((a, b) => {
      const aDate = new Date(a.publishedDate);
      const bDate = new Date(b.publishedDate);
      const aDaysFromTarget = Math.abs((aDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
      const bDaysFromTarget = Math.abs((bDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Primary sort: prefer articles published on or closest to target date
      if (aDaysFromTarget !== bDaysFromTarget) {
        return aDaysFromTarget - bDaysFromTarget;
      }
      
      // Secondary sort: relevance score
      return (b.score || 0) - (a.score || 0);
    });

    const articlesText = sortedArticles.map((article, index) => {
      const publishedDate = new Date(article.publishedDate);
      const daysFromTarget = Math.abs((publishedDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
      const dateProximity = daysFromTarget === 0 ? 'SAME DAY' : `${Math.round(daysFromTarget)} day(s) from target`;
      
      return `Article ${index + 1} (ID: ${article.id}):
Title: ${article.title}
URL: ${article.url}
Date: ${article.publishedDate} (${dateProximity})
${article.author ? `Author: ${article.author}` : ''}
Content: ${article.summary ? `[EXA Summary] ${article.summary}` : (article.text ? article.text.slice(0, 3000) + (article.text.length > 3000 ? '...' : '') : 'No content available')}
${article.score ? `Relevance Score: ${article.score}` : ''}
---`;
    }).join('\n\n');

    const userPrompt = generateUserPrompt(articles, date, periodContext, duplicateArticleIds, uniqueArticles);

    // Monitor API request with detailed context
    const { apiMonitor } = await import('./api-monitor');
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'news-analysis',
      purpose: 'Analyze news articles and select most significant Bitcoin-related event',
      triggeredBy: `News analysis for ${date} (${uniqueArticles.length} articles)`,
      date: date,
      requestData: { 
        model: 'gpt-4o-mini', 
        tokens: 1500, 
        purpose: 'news-analysis',
        articlesCount: uniqueArticles.length,
        period: periodContext.period.name,
        hasBitcoinContent: articles.some(article => {
          const content = `${article.title || ''} ${article.summary || article.text || ''}`.toLowerCase();
          return content.includes('bitcoin') || content.includes('btc') || content.includes('cryptocurrency');
        })
      }
    });

    // Single attempt only - no retries to enforce API limit
    console.log('📞 Making OpenAI API call with gpt-4o-mini...');
    
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
    });

    // Validate we got a response
    if (!response || !response.choices || !response.choices[0]) {
      throw new Error('Invalid OpenAI response structure');
    }
    
    const rawResponse = response.choices[0].message.content || '{}';
    console.log('🔍 Raw OpenAI Response:', rawResponse.slice(0, 500));
    
    let result;
    try {
      result = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error('❌ JSON Parse Error:', parseError);
      console.log('🔍 Full Raw Response:', rawResponse);
      throw new Error(`Failed to parse OpenAI JSON response: ${parseError}`);
    }
    
    // Update request as successful now that we have the result
    apiMonitor.updateRequest(requestId, {
      status: 'success',
      duration: Date.now() - startTime,
      responseSize: response.usage?.total_tokens || 0,
      requestData: { 
        model: 'gpt-4o-mini', 
        tokens: 1500, 
        purpose: 'news-analysis',
        articlesCount: uniqueArticles.length,
        period: periodContext.period.name,
        hasBitcoinContent: articles.some(article => {
          const content = `${article.title || ''} ${article.summary || article.text || ''}`.toLowerCase();
          return content.includes('bitcoin') || content.includes('btc') || content.includes('cryptocurrency');
        }),
        result: {
          summaryLength: result?.summary?.length || 0,
          confidenceScore: result?.confidenceScore || 0,
          sentimentLabel: result?.sentimentLabel || 'neutral',
          topArticleId: result?.topArticleId || null
        }
      }
    });
    
    // Debug: Log the OpenAI response to see what's missing
    console.log('🔍 OpenAI Response Debug:', {
      topArticleId: !!result.topArticleId,
      summary: !!result.summary,
      reasoning: !!result.reasoning,
      keys: Object.keys(result)
    });
    
    // Validate response - topArticleId can be null/false for early Bitcoin dates
    if (!result.summary || !result.reasoning) {
      // Check if this is due to poor quality articles (LinkedIn pages, etc.)
      const hasLinkedInPages = uniqueArticles.some(article => article.url.includes('linkedin.com'));
      const hasLowQualityContent = uniqueArticles.every(article => {
        const bestContent = article.summary || article.text || '';
        return !bestContent || bestContent.length < 100 || bestContent.includes('No content available');
      });
      
      if (hasLinkedInPages || hasLowQualityContent) {
        console.log('⚠️ Poor quality articles detected, applying fallback analysis');
        return {
          topArticleId: uniqueArticles[0]?.id || 'none',
          summary: 'No significant Bitcoin-related news or events occurred during this period. Analysis attempted but found only social media.',
          reasoning: 'Analysis attempted on low-quality sources (social media pages, company profiles) with minimal Bitcoin-specific news content.',
          confidenceScore: 20,
          aiProvider: 'openai-fallback',
          sentimentScore: 0,
          sentimentLabel: 'neutral',
          topicCategories: [],
          duplicateArticleIds: [],
          totalArticlesFetched: articles.length,
          uniqueArticlesAnalyzed: uniqueArticles.length
        };
      }
      
      throw new Error('Invalid response from OpenAI: missing required fields (summary or reasoning)');
    }
    
    // For early Bitcoin dates, topArticleId might be null/false - that's acceptable
    if (result.topArticleId === undefined) {
      console.warn('⚠️ OpenAI response missing topArticleId field - setting to null for early Bitcoin date');
      result.topArticleId = null;
    }
    
    // Validate and auto-correct summary length (must be exactly 100-110 characters)
    if (result.summary.length < 100 || result.summary.length > 110) {
      console.warn(`❌ Summary length error: ${result.summary.length} characters (required: exactly 100-110)`);
      
      let correctedSummary = result.summary;
      
      // Attempt automatic correction for summaries that are close
      if (result.summary.length >= 100 && result.summary.length <= 130) {
        console.log('🔧 Attempting to auto-correct summary length...');
        
        if (result.summary.length < 100) {
          // Too short - try to expand intelligently
          correctedSummary = expandSummary(result.summary, 100);
          console.log(`🔧 Expanded summary from ${result.summary.length} to ${correctedSummary.length} characters`);
        } else if (result.summary.length > 110) {
          // Too long - try to trim intelligently
          correctedSummary = trimSummary(result.summary, 110);
          console.log(`🔧 Trimmed summary from ${result.summary.length} to ${correctedSummary.length} characters`);
        }
        
        // Check if correction was successful
        if (correctedSummary.length >= 100 && correctedSummary.length <= 110) {
          console.log(`✅ Auto-correction successful: ${correctedSummary.length} characters`);
          result.summary = correctedSummary;
        } else {
          // Auto-correction failed - STRICT ENFORCEMENT: throw error
          throw new Error(`❌ STRICT VALIDATION FAILED: Summary length ${correctedSummary.length} characters after auto-correction. Required: exactly 100-110 characters. This is non-negotiable.`);
        }
      } else {
        // Summary is significantly off target - STRICT ENFORCEMENT: throw error
        throw new Error(`❌ STRICT VALIDATION FAILED: Summary length ${result.summary.length} characters is significantly off target (outside 85-125 character auto-correction range). Required: exactly 100-110 characters. This requirement is non-negotiable.`);
      }
    } else {
      console.log(`✅ Summary length valid: ${result.summary.length} characters`);
    }
    
    // Validate that topArticleId corresponds to an accessible article
    let validatedTopArticleId = result.topArticleId;
    if (validatedTopArticleId && !articles.find(article => article.id === validatedTopArticleId)) {
      console.warn(`⚠️ AI selected inaccessible topArticleId: ${validatedTopArticleId}, setting to null`);
      validatedTopArticleId = null;
    }

    return {
      topArticleId: validatedTopArticleId,
      summary: result.summary,
      reasoning: result.reasoning,
      confidenceScore: Math.min(100, Math.max(0, result.confidenceScore || 0)),
      aiProvider: 'openai',
      sentimentScore: Math.min(1, Math.max(-1, result.sentimentScore || 0)),
      sentimentLabel: result.sentimentLabel || 'neutral',
      topicCategories: result.topicCategories || [],
      duplicateArticleIds: result.duplicateArticleIds || [],
      totalArticlesFetched: result.totalArticlesFetched || articles.length,
      uniqueArticlesAnalyzed: result.uniqueArticlesAnalyzed || articles.length
    };

  } catch (error) {
    console.error('OpenAI analysis error:', error);
    throw new Error(`Failed to analyze articles with OpenAI: ${(error as Error).message}`);
  }
}

function createValidLengthSummary(baseSummary: string, minLength: number, maxLength: number): string {
  let summary = baseSummary.trim();
  
  // If too long, trim to max length
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength - 3) + '...';
  }
  
  // If too short, add meaningful context instead of generic padding
  if (summary.length < minLength) {
    const shortfall = minLength - summary.length;
    
    if (shortfall > 30) {
      summary += ' amid ongoing market developments and institutional adoption trends';
    } else if (shortfall > 15) {
      summary += ' affecting cryptocurrency markets';
    } else if (shortfall > 8) {
      summary += ' impacting Bitcoin';
    } else {
      summary += ' today';
    }
    
    // Final trim to ensure we don't exceed max length
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength);
    }
  }
  
  return summary;
}

function getHistoricalPeriod(year: number): string {
  if (year <= 2010) return "Early Bitcoin Era";
  if (year <= 2013) return "First Bubble & Mt. Gox Era";
  if (year <= 2015) return "Bear Market & Recovery";
  if (year <= 2017) return "Altcoin Era";
  if (year <= 2018) return "ICO Boom & Bust";
  if (year <= 2020) return "Crypto Winter & Recovery";
  if (year <= 2022) return "Institutional Adoption";
  if (year <= 2023) return "DeFi/NFT Era";
  return "ETF Era";
}

export async function testOpenAIConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini", // Using gpt-4o-mini for enhanced Bitcoin news analysis
      messages: [{ role: "user" as const, content: "Test connection. Respond with 'OK'." }],
      max_completion_tokens: 10,
    });
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: (error as Error).message || 'Unknown error' 
    };
  }
}

// Export a simple service object for use in URL scraping
export const openaiService = {
  createCompletion: async (messages: Array<{ role: string; content: string }>) => {
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini", // Using gpt-4o-mini for enhanced Bitcoin news analysis
      messages: messages as any,
      response_format: { type: "json_object" },
      // GPT-5 nano only supports default temperature (1)
      max_completion_tokens: 3000, // Optimized for reliable JSON parsing
    });
    
    return response.choices[0].message.content || '{}';
  }
};

// Prompt generation methods for improved OpenAI integration
function generateSystemPrompt(periodContext: any, date: string, uniqueArticlesCount: number, historicalContext: any, articles: any[] = []): string {
  const period = periodContext.period;
  const year = new Date(date).getFullYear();
  
  // Detect if we're analyzing financial fallback articles (no Bitcoin content)
  const hasBitcoinContent = articles.some(article => {
    const content = `${article.title || ''} ${article.summary || article.text || ''}`.toLowerCase();
    return content.includes('bitcoin') || content.includes('btc') || content.includes('cryptocurrency') || content.includes('crypto');
  });
  
  const isFinancialFallback = !hasBitcoinContent && articles.length > 0;
  
  let prompt;
  
  if (isFinancialFallback) {
    prompt = `You are a financial analyst specializing in macroeconomic context analysis for Bitcoin and cryptocurrency markets.

CONTEXT: ${period.name} - ${period.description}
DATE: ${date}
YEAR: ${year}

IMPORTANT: No substantive Bitcoin news was found. Your task is to identify the most significant macroeconomic or financial event and explain its relevance to Bitcoin's ecosystem.

TASK: Analyze ${uniqueArticlesCount} financial/economic articles and connect them to Bitcoin's value proposition.

⚠️  CRITICAL REQUIREMENT: The summary field MUST be between 100-110 characters including spaces. Count every character carefully!

Before finalizing your summary:
1. Write the summary first
2. Count EVERY character including spaces and punctuation
3. Adjust to be exactly 100-110 characters
4. Double-check the count
5. NEVER end with a period or punctuation
6. NO dashes (-), semicolons (;), or colons (:) anywhere

OUTPUT: Respond with a JSON object containing these exact fields:
- topArticleId: string (most significant financial article ID)
- summary: string (MUST BE EXACTLY 100-110 CHARACTERS! Connect the economic event to Bitcoin's relevance. NEVER end with period.)
- reasoning: string (explain how this event creates conditions for Bitcoin adoption or highlights its value)
- confidenceScore: number (0-100)
- sentimentScore: number (-1 to 1)
- sentimentLabel: string ('bullish'|'bearish'|'neutral')
- topicCategories: string[] (use: economic, institutional, regulatory, monetary-policy)

QUALITY: Frame economic events in context of Bitcoin as alternative monetary system.

SUMMARY EXAMPLES (count every character including spaces):
- (109 chars): "Federal Reserve cuts rates to near zero highlighting Bitcoin appeal as hedge against monetary policies"
- (107 chars): "European debt crisis intensifies with Greek bailout demonstrating need for decentralized alternatives"
- (108 chars): "Bank of Japan launches massive stimulus program fueling interest in non government digital currencies"`;
  } else {
    prompt = `You are a Bitcoin news analyst specializing in ${period.name}.

CONTEXT: ${period.description}
PRIORITY: Focus on ${period.keywords.boost.slice(0, 3).join(', ')}
DATE: ${date}
YEAR: ${year}

TASK: Analyze ${uniqueArticlesCount} articles and select the most significant Bitcoin-related event.

⚠️  CRITICAL REQUIREMENT: The summary field MUST be between 100-110 characters including spaces. Count every character!

Before finalizing your summary:
1. Write the summary first
2. Count EVERY character including spaces and punctuation
3. Adjust to be exactly 100-110 characters
4. Double-check the count
5. NEVER end with a period or punctuation
6. NO dashes (-), semicolons (;), or colons (:) anywhere

OUTPUT: Respond with a JSON object containing these exact fields:
- topArticleId: string (article ID or 'none')
- summary: string (MUST BE EXACTLY 100-110 CHARACTERS INCLUDING ALL SPACES! Count each character: factual Bitcoin event. NEVER end with period.)
- reasoning: string (why this article was selected)
- confidenceScore: number (0-100)
- sentimentScore: number (-1 to 1)
- sentimentLabel: string ('bullish'|'bearish'|'neutral')
- topicCategories: string[] (from: regulation, adoption, price, technology, mining, institutional)

QUALITY: Focus on factual events, not speculation. Use active voice.

SUMMARY EXAMPLES (count every character including spaces):
- (108 chars): "BitGo launches Wrapped Bitcoin WBTC on Ethereum enabling Bitcoin holders to participate in DeFi applications"
- (106 chars): "Tesla announces $1.5 billion Bitcoin purchase signaling major institutional adoption of cryptocurrency"

NO BITCOIN NEWS SCENARIO: If no Bitcoin-related events occurred, create 100-110 character summary:
"Bitcoin markets remained quiet today with no major developments announcements or institutional moves affecting" (110 chars)`;
  }

  // Add historical context if available
  if (historicalContext.hasEvent) {
    prompt += `\n\nHISTORICAL EVENT: ${date} marks ${historicalContext.event.title}. Prioritize this milestone.`;
  }

  return prompt;
}

function generateUserPrompt(
  articles: any[], 
  date: string, 
  periodContext: any,
  duplicateArticleIds: string[],
  uniqueArticles: any[]
): string {
  const hasHighQualityContent = articles.some(a => a.text && a.text.length > 500);
  const hasMultipleSources = new Set(articles.map(a => new URL(a.url).hostname)).size > 3;
  
  // Detect if we're analyzing financial fallback articles (no Bitcoin content)
  const hasBitcoinContent = uniqueArticles.some(article => {
    const content = `${article.title || ''} ${article.summary || article.text || ''}`.toLowerCase();
    return content.includes('bitcoin') || content.includes('btc') || content.includes('cryptocurrency') || content.includes('crypto');
  });
  
  const isFinancialFallback = !hasBitcoinContent && uniqueArticles.length > 0;
  
  let prompt;
  
  if (isFinancialFallback) {
    prompt = `# Macroeconomic Analysis Task for ${date}

Analyze these ${uniqueArticles.length} financial/economic articles for macroeconomic significance:

${formatArticlesForPrompt(uniqueArticles, date)}

## Requirements:
- Select the most significant economic/financial event that affects the broader financial environment
- ⚠️ CRITICAL: Write a factual summary that is EXACTLY 100-110 characters INCLUDING ALL SPACES (count every character! Write first, then count, then adjust!)
- NEVER end the summary with a period or punctuation
- NO dashes (-), semicolons (;), or colons (:) anywhere
- Explain how this economic context relates to the financial landscape Bitcoin operates within  
- Use active voice: "Federal Reserve announces X" not "Article discusses X"
- Include specific details: rates, amounts, policy changes, market impacts
- Respond in JSON format

**CHARACTER COUNT EXAMPLE (105 chars):** "Federal Reserve cuts interest rates to historic lows amid financial crisis creating Bitcoin environment"`;
  } else {
    prompt = `# Analysis Task for ${date}

Analyze these ${uniqueArticles.length} unique articles and select the most significant Bitcoin-related event:

${formatArticlesForPrompt(uniqueArticles, date)}

## Requirements:
- Select the article with the most significant Bitcoin-related event
- ⚠️ CRITICAL: Write a factual summary that is EXACTLY 100-110 characters INCLUDING ALL SPACES (count every character! Write first, then count, then adjust!)
- Use active voice: "Company announces X" not "Article discusses X"
- Include specific details: numbers, names, concrete developments
- NO dashes (-), semicolons (;), or colons (:) anywhere
- Respond in JSON format

**CHARACTER COUNT EXAMPLE (108 chars):** "BitGo launches Wrapped Bitcoin WBTC on Ethereum enabling Bitcoin holders to participate in DeFi applications"

**NO BITCOIN NEWS TEMPLATE (102 chars):** "Bitcoin markets remained quiet today with no major developments announcements or institutional moves"`;
  }

  // Add adaptive guidance based on content quality
  if (!hasHighQualityContent) {
    prompt += "\n\nNOTE: Limited content available. Focus on article titles and available text.";
  }
  
  if (!hasMultipleSources) {
    prompt += "\n\nNOTE: Limited source diversity. Prioritize content relevance over source variety.";
  }
  
  // Add period-specific guidance
  if (periodContext.isHistorical) {
    prompt += `\n\nHISTORICAL CONTEXT: This is ${periodContext.period.name}. Focus on events significant for ${new Date(date).getFullYear()}.`;
  }
  
  return prompt;
}

// Tier validation interface
export interface TierValidationResult {
  isSignificant: boolean;
  reasoning: string;
  tier: string;
  topArticleId?: string; // ID of the most relevant article (when isSignificant is true)
}

/**
 * Validates whether articles from a specific tier are significant enough for that tier
 * Returns true if content is significant, false if should escalate to next tier
 */
export async function validateTierSignificance(
  articles: ArticleData[], 
  tier: 'bitcoin' | 'crypto' | 'macro',
  date: string
): Promise<TierValidationResult> {
  if (articles.length === 0) {
    return {
      isSignificant: false,
      reasoning: 'No articles found for this tier',
      tier
    };
  }

  // Macro tier always accepts content (final fallback)
  if (tier === 'macro') {
    return {
      isSignificant: true,
      reasoning: 'Macroeconomic tier serves as final fallback and always accepts content',
      tier
    };
  }

  const uniqueArticles = articles.filter((article, index, arr) => 
    arr.findIndex(a => a.url === article.url) === index
  ).slice(0, 10); // Limit to 10 articles for validation

  // Create tier-specific validation prompts
  let validationPrompt = '';
  let tierName = '';
  let significanceThreshold = '';

  switch (tier) {
    case 'bitcoin':
      tierName = 'Bitcoin';
      significanceThreshold = 'Bitcoin-related topics that would interest the Bitcoin community';
      validationPrompt = `You are validating Bitcoin-focused articles for Bitcoin enthusiasts and historians.

QUESTION: Do any of these ${uniqueArticles.length} articles discuss Bitcoin NEWS EVENTS that would interest the Bitcoin community?

FOCUS ON NEWS EVENTS ONLY - REJECT NON-NEWS CONTENT:
❌ REJECT: Wikipedia entries, "What is Bitcoin" explanations, basic concept tutorials
❌ REJECT: "How Bitcoin works", "What is halving", "Bitcoin basics" educational articles  
❌ REJECT: General explainers, summaries, or introductory content about Bitcoin concepts
❌ REJECT: Academic papers explaining fundamental Bitcoin concepts
❌ REJECT: Tutorial articles teaching Bitcoin basics to beginners
❌ REJECT: Historical essays about money, banking, currency, or financial systems
❌ REJECT: "History of money", "Evolution of currency", essays about monetary theory
❌ REJECT: General economic philosophy, financial theory, or monetary history articles
❌ REJECT: Opinion essays about traditional banking, Federal Reserve, or economic policy
❌ REJECT: Predictions, speculation, forecasts ("Bitcoin will hit $100K", "analyst predicts")
❌ REJECT: Opinion pieces, analysis articles, "what to expect" content
❌ REJECT: Weekly/monthly roundups, summary blogs, periodic newsletters
❌ REJECT: "5 reasons Bitcoin will...", "Why Bitcoin could...", "What this means for Bitcoin"

BITCOIN NEWS EVENTS INCLUDE:
• Protocol development, releases, updates, technical improvements (NEWS about development)
• Bitcoin network events (halvings, difficulty adjustments, upgrades) - ACTUAL EVENTS, not explanations
• Mining developments, hardware launches, pool news - BREAKING NEWS
• Exchange launches, closures, hacks, regulatory issues - ACTUAL INCIDENTS  
• Institutional adoption, corporate treasury moves, ETF news - ANNOUNCEMENTS
• Wallet developments, security incidents, recovery stories - REAL EVENTS
• Community discussions, developer debates, governance topics - CURRENT DISCUSSIONS
• Regulatory developments, legal cases, policy changes affecting Bitcoin - ACTUAL RULINGS
• Market milestones, price movements with clear Bitcoin catalysts - MARKET EVENTS
• Lightning Network and Layer 2 developments - ACTUAL LAUNCHES/UPDATES
• Bitcoin-related scams, thefts, security warnings - REAL INCIDENTS
• Cultural moments, memes, community events around Bitcoin - ACTUAL EVENTS

VALIDATION APPROACH:
✅ INCLUDE: Breaking news, announcements, incidents, events, developments
✅ INCLUDE: Articles reporting actual happenings in the Bitcoin ecosystem  
❌ EXCLUDE: Educational articles, Wikipedia entries, basic Bitcoin explainers
❌ EXCLUDE: Historical essays about money, economic theory, or financial systems
❌ EXCLUDE: "What is..." or "How to..." tutorial-style content
❌ EXCLUDE: Essays discussing traditional banking, monetary policy, or economic history
❌ EXCLUDE: Generic crypto/altcoin news with only passing Bitcoin mention
❌ EXCLUDE: Purely macroeconomic news without Bitcoin connection
❌ EXCLUDE: Opinion pieces about financial systems that only mention Bitcoin tangentially

${formatArticlesForPrompt(uniqueArticles, date)}

RESPOND WITH: A simple JSON object with exactly these fields:
{
  "isSignificant": true/false,
  "reasoning": "Brief explanation focusing on Bitcoin-specific content found or absence thereof",
  "topArticleId": "article-id-of-most-relevant-bitcoin-article" (only required if isSignificant is true)
}

SELECTION CRITERIA: If multiple Bitcoin articles exist, choose the one with the most direct Bitcoin relevance - protocol updates, official announcements, or major network events take priority over general market news.

Be inclusive - if Bitcoin enthusiasts would find value in the article, return true.`;
      break;

    case 'crypto':
      tierName = 'Crypto/Web3';
      significanceThreshold = 'cryptocurrency or web3-related topics that would interest the crypto community';
      validationPrompt = `You are validating crypto/web3-focused articles for cryptocurrency enthusiasts and the broader digital asset community.

QUESTION: Do any of these ${uniqueArticles.length} articles discuss cryptocurrency or web3 NEWS EVENTS that would interest the crypto community?

FOCUS ON NEWS EVENTS ONLY - REJECT NON-NEWS CONTENT:
❌ REJECT: "What is Ethereum" explanations, "How DeFi works" tutorials
❌ REJECT: Basic altcoin concept explainers, web3 introductory articles
❌ REJECT: Wikipedia entries about cryptocurrencies or blockchain concepts
❌ REJECT: General educational content about DeFi, NFTs, or web3 basics
❌ REJECT: "Crypto 101" tutorial-style articles
❌ REJECT: Predictions, speculation, forecasts ("ETH will reach $10K", "analyst predicts")
❌ REJECT: Opinion pieces, analysis articles, "what to expect" content
❌ REJECT: Weekly/monthly crypto roundups, summary blogs, periodic newsletters
❌ REJECT: "Top 5 altcoins", "Why DeFi will...", "Crypto market outlook"

CRYPTO/WEB3 NEWS EVENTS INCLUDE:
• Altcoin launches, updates, protocol changes (Ethereum, Solana, etc.) - ACTUAL LAUNCHES
• DeFi protocols, yield farming, liquidity mining, DEX developments - REAL LAUNCHES
• NFT projects, marketplaces, digital art, gaming integrations - ACTUAL LAUNCHES
• Web3 infrastructure, dApps, developer tools, frameworks - NEWS RELEASES
• Smart contract developments, audits, vulnerabilities - ACTUAL DISCOVERIES
• Staking protocols, validator networks, consensus mechanisms - REAL UPDATES
• Cross-chain bridges, interoperability solutions - ACTUAL LAUNCHES
• Crypto exchange developments, new listings, trading features - ANNOUNCEMENTS
• Institutional crypto adoption (beyond Bitcoin-specific) - REAL ADOPTIONS
• Cryptocurrency regulations, legal developments affecting altcoins - ACTUAL RULINGS
• Token economics, tokenomics, governance tokens, DAOs - REAL PROPOSALS
• Blockchain gaming, metaverse projects, virtual worlds - ACTUAL LAUNCHES
• Crypto lending, borrowing, CeFi platform developments - REAL DEVELOPMENTS
• Security incidents, hacks, exploits in DeFi/crypto space - ACTUAL INCIDENTS
• Crypto payments, merchant adoption, payment processors - REAL INTEGRATIONS
• Blockchain infrastructure, scaling solutions, Layer 2s (non-Bitcoin) - ACTUAL LAUNCHES
• Crypto venture funding, startup launches, partnerships - REAL ANNOUNCEMENTS

VALIDATION APPROACH:
✅ INCLUDE: Breaking news, announcements, launches, incidents, developments
✅ INCLUDE: Articles reporting actual happenings in the crypto/web3 ecosystem
❌ EXCLUDE: Educational articles, Wikipedia entries, basic crypto/web3 explainers
❌ EXCLUDE: "What is..." or "How to..." tutorial-style content
❌ EXCLUDE: Pure Bitcoin-only content (belongs in Bitcoin tier)
❌ EXCLUDE: General tech news without crypto/blockchain connection

${formatArticlesForPrompt(uniqueArticles, date)}

RESPOND WITH: A simple JSON object with exactly these fields:
{
  "isSignificant": true/false, 
  "reasoning": "Brief explanation focusing on crypto/web3-specific content found or absence thereof",
  "topArticleId": "article-id-of-most-relevant-crypto-article" (only required if isSignificant is true)
}

SELECTION CRITERIA: If multiple crypto/web3 articles exist, prioritize protocol updates, major DeFi launches, regulatory changes, or significant technical developments over general market movements.

Be inclusive - if crypto enthusiasts would find value in the article, return true.`;
      break;
  }

  try {
    // Monitor API request with detailed context
    const { apiMonitor } = await import('./api-monitor');
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: `tier-validation-${tier}`,
      purpose: `Validate ${tierName} tier significance for Bitcoin community`,
      triggeredBy: `Tier validation for ${tier} tier (${uniqueArticles.length} articles)`,
      date: date,
      requestData: { 
        model: 'gpt-4o-mini', 
        tokens: 200, 
        purpose: 'tier-validation',
        tier: tier,
        articlesCount: uniqueArticles.length,
        significanceThreshold: significanceThreshold
      }
    });

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are a ${tierName} news significance validator. Return only valid JSON.` 
        },
        { role: 'user', content: validationPrompt }
      ],
      max_completion_tokens: 200
      // GPT-5 nano only supports default temperature (1)
    });

    const responseContent = response.choices[0]?.message?.content?.trim();
    if (!responseContent) {
      throw new Error('Empty response from OpenAI');
    }

    // Fix JSON parsing issue - remove any markdown code block markers
    const cleanedContent = responseContent.replace(/```json\n?|```\n?/g, '').trim();
    
    const result = JSON.parse(cleanedContent);
    
    if (typeof result.isSignificant !== 'boolean' || typeof result.reasoning !== 'string') {
      throw new Error('Invalid response structure');
    }

    // Validate topArticleId is present when isSignificant is true
    if (result.isSignificant && !result.topArticleId) {
      console.warn(`⚠️ ${tier} tier validation returned significant but no topArticleId - using first article`);
      result.topArticleId = uniqueArticles[0]?.id;
    }

    // Update request as successful
    apiMonitor.updateRequest(requestId, {
      status: 'success',
      duration: Date.now() - startTime,
      responseSize: response.usage?.total_tokens || 0,
      requestData: { 
        model: 'gpt-4o-mini', 
        tokens: 200, 
        purpose: 'tier-validation',
        tier: tier,
        articlesCount: uniqueArticles.length,
        significanceThreshold: significanceThreshold,
        result: {
          isSignificant: result.isSignificant,
          reasoning: result.reasoning,
          topArticleId: result.topArticleId
        }
      }
    });

    return {
      isSignificant: result.isSignificant,
      reasoning: result.reasoning,
      tier,
      topArticleId: result.topArticleId
    };

  } catch (error) {
    console.error(`❌ Error validating ${tier} tier significance:`, error);
    
    // Log error without monitoring variables that aren't in scope
    console.error(`Error in tier validation: ${(error as Error).message}`);
    
    // Fallback: be permissive with errors to avoid stopping the pipeline
    return {
      isSignificant: true,
      reasoning: `Validation error occurred, allowing tier to proceed: ${error}`,
      tier
    };
  }
}

function formatArticlesForPrompt(articles: any[], date: string): string {
  const targetDate = new Date(date);
  
  return articles.map((article, index) => {
    const publishedDate = new Date(article.publishedDate);
    const daysFromTarget = Math.abs((publishedDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    const dateProximity = daysFromTarget === 0 ? 'SAME DAY' : `${Math.round(daysFromTarget)} day(s) from target`;
    
    return `Article ${index + 1} (ID: ${article.id}):
Title: ${article.title}
URL: ${article.url}
Date: ${article.publishedDate} (${dateProximity})
${article.author ? `Author: ${article.author}` : ''}
Content: ${article.summary ? `[EXA Summary] ${article.summary}` : (article.text ? article.text.slice(0, 2000) + (article.text.length > 2000 ? '...' : '') : 'No content available')}
${article.score ? `Relevance Score: ${article.score}` : ''}
---`;
  }).join('\n\n');
}

// Event Cockpit AI Enhancement Functions
export async function evaluateEventSummary(summary: string, date: string, group: string): Promise<{ needsEnhancement: boolean; reasoning: string; }> {
  try {
    console.log(`🤖 Evaluating summary quality for ${date}: "${summary}"`);
    
    const prompt = `You are an expert Bitcoin historian evaluating summary quality.

Evaluate this Bitcoin event summary:
Date: ${date}
Group: ${group}
Summary: "${summary}"

Does this summary need improvement? Consider:
1. Is it exactly 100-110 characters? (Current: ${summary.length})
2. Contains NO DATES (no years, months, days, "On [date]", "In [year]")?
3. Is it factual and specific?
4. Uses active voice and present tense?
5. No forbidden punctuation (: ; - .) at the end?
6. Describes what happened, not what articles discuss?
7. Clear and professional tone?

Respond with JSON:
{
  "needsEnhancement": boolean,
  "reasoning": "Brief explanation of decision"
}`;

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 200
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      // Clean up response - remove markdown code blocks if present
      const cleanContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleanContent);
      console.log(`📊 Evaluation result: ${result.needsEnhancement ? 'Needs enhancement' : 'Already good'} - ${result.reasoning}`);
      return result;
    } catch (parseError) {
      console.error('Failed to parse evaluation response:', content);
      // Fallback: if length is wrong, definitely needs enhancement
      return {
        needsEnhancement: summary.length < 100 || summary.length > 110,
        reasoning: 'Failed to parse AI response, using length check'
      };
    }
  } catch (error) {
    console.error('Error evaluating summary:', error);
    // Conservative fallback
    return {
      needsEnhancement: summary.length < 100 || summary.length > 110,
      reasoning: 'Error occurred, using basic length validation'
    };
  }
}

export async function enhanceEventSummary(originalSummary: string, date: string, group: string): Promise<{ summary: string; reasoning: string; }> {
  try {
    console.log(`✨ Enhancing summary for ${date}: "${originalSummary}"`);
    
    const prompt = `You are an expert Bitcoin historian. Improve this event summary:

Date: ${date}
Group: ${group}
Original: "${originalSummary}"

Create an improved summary that:
1. Is EXACTLY 100-110 characters (strictly enforced)
2. Contains NO DATES anywhere (no years, months, days, "On [date]", "In [year]")
3. Uses active voice and present tense
4. Describes what actually happened (not what articles discuss)
5. Is factual and specific
6. Has NO ending punctuation (: ; - .)
7. Uses professional, conversational tone
8. Focuses on the concrete event/action

FORBIDDEN:
- ANY DATES: "On October 12", "In 2009", "2024", months, years, etc.
- Ending punctuation: . : ; -
- Passive voice: "was announced" → use "announces"
- Past tense: "reached" → use "reaches"

Respond with JSON:
{
  "summary": "your enhanced summary here",
  "reasoning": "brief explanation of improvements made"
}`;

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      // Clean up response - remove markdown code blocks if present
      const cleanContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleanContent);
      const enhancedSummary = result.summary;
      
      // Clean and validate the summary
      let cleanedSummary = enhancedSummary.trim();
      
      // Remove ANY dates first
      cleanedSummary = cleanedSummary.replace(/\b(On|In)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s*\d{4}\b/g, '');
      cleanedSummary = cleanedSummary.replace(/\b(On|In)\s+\d{4}\b/g, '');
      cleanedSummary = cleanedSummary.replace(/\b\d{4}\b/g, '').trim();
      
      // Remove forbidden ending punctuation
      cleanedSummary = cleanedSummary.replace(/[.!,;:\-]\s*$/, '').trim();
      
      // Clean up extra spaces
      cleanedSummary = cleanedSummary.replace(/\s+/g, ' ').trim();
      
      // Validate length and adjust if needed
      if (cleanedSummary.length < 100 || cleanedSummary.length > 110) {
        console.log(`⚠️ Summary length ${cleanedSummary.length} not in range, adjusting...`);
        
        if (cleanedSummary.length < 100) {
          cleanedSummary = expandSummary(cleanedSummary, 105);
        } else if (cleanedSummary.length > 110) {
          cleanedSummary = trimSummary(cleanedSummary, 110);
        }
        
        console.log(`🔧 Adjusted summary (${cleanedSummary.length} chars): "${cleanedSummary}"`);
        return {
          summary: cleanedSummary,
          reasoning: result.reasoning + ' (length auto-adjusted)'
        };
      }
      
      console.log(`✅ Enhanced summary (${cleanedSummary.length} chars): "${cleanedSummary}"`);
      return {
        summary: cleanedSummary,
        reasoning: result.reasoning
      };
      
    } catch (parseError) {
      console.error('Failed to parse enhancement response:', content);
      throw new Error('Failed to parse AI response');
    }
  } catch (error) {
    console.error('Error enhancing summary:', error);
    throw error;
  }
}

// AI-driven comparison of article sets from two dates
export interface ArticleComparisonResult {
  winner: 'original' | 'corrected' | 'neither';
  reasoning: string;
  originalTier: string | null; // Which tier had best coverage for original date
  correctedTier: string | null; // Which tier had best coverage for corrected date
}

export async function compareArticleSets(
  originalDate: string,
  originalArticles: { bitcoin: ArticleData[], crypto: ArticleData[], macro: ArticleData[] },
  correctedDate: string,
  correctedArticles: { bitcoin: ArticleData[], crypto: ArticleData[], macro: ArticleData[] }
): Promise<ArticleComparisonResult> {
  console.log(`🔍 Comparing articles: ${originalDate} vs ${correctedDate}`);
  console.log(`Original articles - Bitcoin: ${originalArticles.bitcoin.length}, Crypto: ${originalArticles.crypto.length}, Macro: ${originalArticles.macro.length}`);
  console.log(`Corrected articles - Bitcoin: ${correctedArticles.bitcoin.length}, Crypto: ${correctedArticles.crypto.length}, Macro: ${correctedArticles.macro.length}`);

  // Helper function to format articles for the prompt
  const formatArticlesForPrompt = (tieredArticles: { bitcoin: ArticleData[], crypto: ArticleData[], macro: ArticleData[] }, date: string) => {
    const sections = [];
    
    if (tieredArticles.bitcoin.length > 0) {
      sections.push(`**Bitcoin Tier (${tieredArticles.bitcoin.length} articles):**`);
      tieredArticles.bitcoin.slice(0, 5).forEach(article => {
        sections.push(`- "${article.title}"`);
        sections.push(`  Source: ${article.url}`);
      });
    }
    
    if (tieredArticles.crypto.length > 0) {
      sections.push(`\n**Crypto/Web3 Tier (${tieredArticles.crypto.length} articles):**`);
      tieredArticles.crypto.slice(0, 5).forEach(article => {
        sections.push(`- "${article.title}"`);
        sections.push(`  Source: ${article.url}`);
      });
    }
    
    if (tieredArticles.macro.length > 0) {
      sections.push(`\n**Macroeconomic Tier (${tieredArticles.macro.length} articles):**`);
      tieredArticles.macro.slice(0, 5).forEach(article => {
        sections.push(`- "${article.title}"`);
        sections.push(`  Source: ${article.url}`);
      });
    }
    
    return sections.join('\n');
  };

  const prompt = `You are a Bitcoin news analyst evaluating whether to REPLACE a date in our historical database.

**CONTEXT:**
We have a Bitcoin event currently stored on ${originalDate}, but fact-checking suggests it may have actually occurred on ${correctedDate}. Your job is to determine if the corrected date has better news coverage quality.

**ORIGINAL DATE: ${originalDate}**
${formatArticlesForPrompt(originalArticles, originalDate)}

**CORRECTED DATE: ${correctedDate}**
${formatArticlesForPrompt(correctedArticles, correctedDate)}

**YOUR TASK:**
Should we REPLACE ${originalDate} with ${correctedDate} based on news coverage quality?

**EVALUATION FRAMEWORK:**

**1. Tier Hierarchy Analysis (Most Important):**
   - Bitcoin tier > Crypto tier > Macro tier
   - If corrected date has HIGHER tier → Strong case to replace
   - If original date has HIGHER tier → Strong case to keep original
   - If SAME tier → Proceed to next criteria

**2. Article Count Analysis:**
   - Within same tier, more articles = better coverage
   - Significant difference (3+ articles) weighs heavily
   - Example: 5 Bitcoin articles beats 2 Bitcoin articles

**3. Article Quality Analysis:**
   - Direct event coverage > Price reactions
   - Primary sources > Secondary reporting
   - Major publications > Minor sources
   - Comprehensive coverage > Brief mentions

**4. Coverage Depth:**
   - Multiple angles/perspectives on same event
   - Detailed explanations vs brief headlines
   - Supporting context and background

**DECISION RULES:**
- If corrected date clearly has BETTER tier → "corrected" wins (recommend REPLACE)
- If original date has BETTER tier → "original" wins (DON'T replace)
- If SAME tier AND corrected has more/better articles → "corrected" wins
- If SAME tier AND original has more/better articles → "original" wins
- If BOTH dates have poor/no coverage → "neither" (mark as PROBLEM)

Return JSON only:
{
  "winner": "original" | "corrected" | "neither",
  "reasoning": "Detailed explanation analyzing tier, count, quality, and depth. Be specific about why one date's coverage is superior.",
  "originalTier": "bitcoin" | "crypto" | "macro" | null,
  "correctedTier": "bitcoin" | "crypto" | "macro" | null
}

Remember: Your recommendation directly impacts which date we keep in our historical database. Be thorough and precise.`;

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI for article comparison');
    }

    const cleanContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(cleanContent);
    
    console.log(`🏆 Comparison result: ${result.winner} wins`);
    console.log(`📝 Reasoning: ${result.reasoning}`);
    
    return result as ArticleComparisonResult;
    
  } catch (error) {
    console.error('Error comparing article sets:', error);
    throw error;
  }
}

// Summarize a single article with strict 100-110 character requirement
export async function summarizeArticleWithOpenAI(
  articleTitle: string,
  articleSummary: string
): Promise<string> {
  console.log(`📝 Summarizing article: "${articleTitle}"`);

  const { apiMonitor } = await import('./api-monitor');

  const prompt = `You are a Bitcoin news analyst creating concise historical summaries.

**ARTICLE:**
Title: ${articleTitle}
Content: ${articleSummary}

**YOUR TASK:**
Create a SINGLE SENTENCE summary that is EXACTLY 100-110 characters long (including spaces and punctuation).

**CRITICAL REQUIREMENTS:**
1. Length: MUST be between 100-110 characters (strict requirement)
2. Style: Professional, informative, present tense
3. No dates: Never include dates or time references
4. Active voice: Make it engaging and clear
5. Complete sentence: Proper capitalization but NO PERIOD at the end
6. Do NOT end with a period (.) - the sentence should end without punctuation

**OUTPUT FORMAT:**
Return ONLY the summary text - no JSON, no formatting, no explanations. Just the summary itself.

EXAMPLE GOOD SUMMARIES (note: NO period at the end):
- "Bitcoin price surges past $20,000 milestone as institutional investors drive unprecedented demand" (102 chars)
- "Major exchange announces support for Lightning Network, enabling faster and cheaper transactions" (101 chars)

Your summary (100-110 characters, NO period at end):`;

  try {
    // Track initial summarization attempt
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'article-summarization',
      purpose: 'Generate 100-110 character summary',
      triggeredBy: `Summarize: ${articleTitle.substring(0, 50)}...`,
      requestData: { 
        model: 'gpt-4o-mini',
        attempt: 1,
        purpose: 'article-summarization'
      }
    });

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 100
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (!summary) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        errorCategory: 'other',
        duration: Date.now() - startTime
      });
      throw new Error('No summary generated by OpenAI');
    }

    // Validate length - must be 100-110 characters
    let finalSummary = summary;
    let attempts = 0;
    const maxAttempts = 3;

    // Update initial request status
    if (finalSummary.length >= 100 && finalSummary.length <= 110) {
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: finalSummary.length
      });
      console.log(`✅ Summary generated: ${finalSummary.length} chars`);
      return finalSummary;
    } else {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        errorCategory: 'validation',
        duration: Date.now() - startTime,
        requestData: { 
          length: finalSummary.length,
          reason: 'Length validation failed'
        }
      });
    }

    while ((finalSummary.length < 100 || finalSummary.length > 110) && attempts < maxAttempts) {
      attempts++;
      console.warn(`⚠️ Attempt ${attempts}: Summary length ${finalSummary.length} chars - retrying...`);
      
      const retryPrompt = `Create a summary of EXACTLY 100-110 characters for: "${articleTitle}"

Previous attempt was ${finalSummary.length} characters. Make it ${finalSummary.length < 100 ? 'longer' : 'shorter'}.

CRITICAL: 
- Output must be 100-110 characters. Count carefully.
- Do NOT end with a period (.)
- End the sentence without punctuation

Return ONLY the summary text:`;

      // Track retry attempt
      const retryStartTime = Date.now();
      const retryRequestId = apiMonitor.logRequest({
        service: 'openai',
        endpoint: '/chat/completions',
        method: 'POST',
        status: 'pending',
        context: 'article-summarization-retry',
        purpose: `Retry #${attempts} - adjust summary length`,
        triggeredBy: `Summarize retry: ${articleTitle.substring(0, 50)}...`,
        requestData: { 
          model: 'gpt-4o-mini',
          attempt: attempts + 1,
          previousLength: finalSummary.length,
          purpose: 'article-summarization-retry'
        }
      });

      const retryResponse = await getOpenAIClient().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: retryPrompt }],
        temperature: 0.3,
        max_tokens: 100
      });

      const retriedSummary = retryResponse.choices[0]?.message?.content?.trim();
      if (retriedSummary) {
        finalSummary = retriedSummary;
        
        if (finalSummary.length >= 100 && finalSummary.length <= 110) {
          apiMonitor.updateRequest(retryRequestId, {
            status: 'success',
            duration: Date.now() - retryStartTime,
            responseSize: finalSummary.length
          });
          console.log(`✅ Retry ${attempts} successful: ${finalSummary.length} chars`);
          return finalSummary;
        } else {
          apiMonitor.updateRequest(retryRequestId, {
            status: 'error',
            errorCategory: 'validation',
            duration: Date.now() - retryStartTime,
            requestData: { 
              length: finalSummary.length,
              reason: 'Length validation failed'
            }
          });
        }
      }
    }

    // If we still don't have a valid summary after retries, throw error
    if (finalSummary.length < 100 || finalSummary.length > 110) {
      throw new Error(`Failed to generate summary within 100-110 character constraint after ${maxAttempts} attempts (got ${finalSummary.length} chars)`);
    }

    console.log(`✅ Summary generated: ${finalSummary.length} chars`);
    return finalSummary;

  } catch (error) {
    console.error('Error summarizing article:', error);
    throw error;
  }
}

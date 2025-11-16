import { formatDate } from "date-fns";

interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface PerplexityResponse {
  id: string;
  model: string;
  object: string;
  created: number;
  citations: string[];
  choices: Array<{
    index: number;
    finish_reason: string;
    message: {
      role: string;
      content: string;
    };
    delta: {
      role: string;
      content: string;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface PerplexityFactCheckResult {
  verdict: 'verified' | 'contradicted' | 'uncertain';
  confidence: number;
  reasoning: string;
  correctDate?: string | null;
  citations: string[];
}

interface PerplexitySummaryComparisonResult {
  winner: 'original' | 'corrected' | 'neither';
  confidence: number;
  reasoning: string;
  citations: string[];
}

interface ArticleData {
  id: string;
  title: string;
  url: string;
  publishedDate: string;
  author?: string;
  summary?: string;
}

interface TieredArticles {
  bitcoin: ArticleData[];
  crypto: ArticleData[];
  macro: ArticleData[];
}

/**
 * Call Perplexity API for grounded fact-checking
 */
async function callPerplexity(messages: PerplexityMessage[], requestContext?: { date?: string; purpose?: string }): Promise<PerplexityResponse> {
  const { apiMonitor } = await import('./api-monitor');
  const startTime = Date.now();
  
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY environment variable is not set');
  }

  // Extract the user prompt for monitoring
  const userMessage = messages.find(m => m.role === 'user')?.content || '';
  
  // Log API request
  const requestId = apiMonitor.logRequest({
    service: 'perplexity',
    method: 'POST',
    endpoint: '/chat/completions',
    status: 'pending',
    purpose: requestContext?.purpose || 'fact-check',
    date: requestContext?.date,
    requestData: {
      model: 'sonar',
      messageCount: messages.length,
      userPrompt: userMessage.substring(0, 200) + (userMessage.length > 200 ? '...' : ''), // First 200 chars
      temperature: 0.2
    }
  });

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages,
        temperature: 0.2,
        top_p: 0.9,
        return_images: false,
        return_related_questions: false,
        stream: false,
      }),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      
      // Update API monitor with error
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration,
        error: `${response.status} - ${errorText}`
      });
      
      throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Update API monitor with success
    apiMonitor.updateRequest(requestId, {
      status: 'success',
      duration,
      responseSize: JSON.stringify(data).length
    });

    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    apiMonitor.updateRequest(requestId, {
      status: 'error',
      duration,
      error: (error as Error).message
    });
    throw error;
  }
}

/**
 * Format articles for fact-checking prompt
 */
function formatArticlesForPrompt(tieredArticles: TieredArticles): string {
  let articlesText = '';
  
  // Bitcoin tier
  if (tieredArticles.bitcoin && tieredArticles.bitcoin.length > 0) {
    articlesText += '\n=== BITCOIN TIER ARTICLES ===\n';
    tieredArticles.bitcoin.forEach((article, idx) => {
      articlesText += `\nArticle ${idx + 1}:\n`;
      articlesText += `Title: ${article.title}\n`;
      articlesText += `URL: ${article.url}\n`;
      articlesText += `Published: ${article.publishedDate}\n`;
      if (article.summary) {
        articlesText += `Summary: ${article.summary}\n`;
      }
    });
  }

  // Crypto tier
  if (tieredArticles.crypto && tieredArticles.crypto.length > 0) {
    articlesText += '\n=== CRYPTO/WEB3 TIER ARTICLES ===\n';
    tieredArticles.crypto.forEach((article, idx) => {
      articlesText += `\nArticle ${idx + 1}:\n`;
      articlesText += `Title: ${article.title}\n`;
      articlesText += `URL: ${article.url}\n`;
      articlesText += `Published: ${article.publishedDate}\n`;
      if (article.summary) {
        articlesText += `Summary: ${article.summary}\n`;
      }
    });
  }

  // Macro tier
  if (tieredArticles.macro && tieredArticles.macro.length > 0) {
    articlesText += '\n=== MACROECONOMIC TIER ARTICLES ===\n';
    tieredArticles.macro.forEach((article, idx) => {
      articlesText += `\nArticle ${idx + 1}:\n`;
      articlesText += `Title: ${article.title}\n`;
      articlesText += `URL: ${article.url}\n`;
      articlesText += `Published: ${article.publishedDate}\n`;
      if (article.summary) {
        articlesText += `Summary: ${article.summary}\n`;
      }
    });
  }

  return articlesText || '\n(No articles available)\n';
}

/**
 * Perform Perplexity-based fact-check on a historical event
 */
export async function perplexityFactCheck(
  date: string,
  summary: string,
  tieredArticles: TieredArticles
): Promise<PerplexityFactCheckResult> {
  try {
    // Format the articles we already have cached
    const articlesContext = formatArticlesForPrompt(tieredArticles);

    // Create the fact-checking prompt
    const systemPrompt = `You are a precise historical fact-checker specializing in Bitcoin, cryptocurrency, and macroeconomic events. 
Your task is to verify whether the described event actually happened on the specified date.

Use your knowledge and real-time web search to:
1. Verify the event occurred
2. Confirm the exact date
3. Check if it's related to Bitcoin/crypto/macroeconomics (prefer Bitcoin > Crypto > Macro)
4. Ensure it's not a duplicate of events from the past 30 days

Return a JSON object with:
{
  "verdict": "verified" | "contradicted" | "uncertain",
  "confidence": 0-100,
  "reasoning": "detailed explanation",
  "correctDate": "YYYY-MM-DD or null if date is correct or unknown"
}

IMPORTANT:
- "verified" means the event happened on this exact date
- "contradicted" means the event happened on a different date OR didn't happen at all
- "uncertain" means you cannot definitively verify or contradict
- If the event happened on a different date, provide the correct date in "correctDate"
- Confidence should reflect how certain you are based on evidence found`;

    const userPrompt = `Date: ${date}
Event Summary: ${summary}

Cached Articles Available:
${articlesContext}

Please verify:
1. Did this event actually happen on ${date}?
2. If not, when did it happen (if at all)?
3. Is this the most relevant Bitcoin/crypto/macro news for this date?
4. Is this distinct from events in the past 30 days?

Respond ONLY with valid JSON.`;

    const messages: PerplexityMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callPerplexity(messages, { date, purpose: 'perplexity-fact-check' });
    
    // Extract the response content
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in Perplexity response');
    }

    // Parse the JSON response
    let result;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      throw new Error(`Failed to parse Perplexity response as JSON: ${content}`);
    }

    // Validate and return the result
    return {
      verdict: result.verdict || 'uncertain',
      confidence: Number(result.confidence) || 50,
      reasoning: result.reasoning || 'Unable to parse reasoning',
      correctDate: result.correctDate || null,
      citations: response.citations || []
    };

  } catch (error) {
    console.error('Perplexity fact-check error:', error);
    throw error;
  }
}

/**
 * Batch fact-check multiple events
 */
export async function perplexityBatchFactCheck(
  events: Array<{ date: string; summary: string; tieredArticles: TieredArticles }>
): Promise<Array<PerplexityFactCheckResult & { date: string }>> {
  const results = [];
  
  for (const event of events) {
    try {
      const result = await perplexityFactCheck(event.date, event.summary, event.tieredArticles);
      results.push({
        date: event.date,
        ...result
      });
      
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Failed to fact-check ${event.date}:`, error);
      results.push({
        date: event.date,
        verdict: 'uncertain' as const,
        confidence: 0,
        reasoning: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        correctDate: null,
        citations: []
      });
    }
  }
  
  return results;
}

/**
 * Result type for date verification
 */
export interface PerplexityDateVerificationResult {
  verifiedDate: string | null; // The actual date the event occurred (YYYY-MM-DD format)
  confidence: number; // 0-100
  reasoning: string; // Detailed explanation
  eventType: 'bitcoin' | 'crypto' | 'macro' | 'none'; // What type of event was found
  citations: string[]; // Source URLs
}

/**
 * Verify what event actually happened on a specific date using Perplexity
 * This is used when OpenAI says "don't replace" - we need to verify if the original date is factually correct
 */
export async function verifyDateWithPerplexity(
  date: string,
  tieredArticles: TieredArticles
): Promise<PerplexityDateVerificationResult> {
  try {
    // Format the cached articles as context
    const articlesContext = formatArticlesForPrompt(tieredArticles);
    
    // Determine what tier of articles we have (for prioritization hint)
    const hasBitcoin = tieredArticles.bitcoin && tieredArticles.bitcoin.length > 0;
    const hasCrypto = tieredArticles.crypto && tieredArticles.crypto.length > 0;
    const hasMacro = tieredArticles.macro && tieredArticles.macro.length > 0;
    
    let tierContext = '';
    if (hasBitcoin) {
      tierContext = 'We have Bitcoin-specific articles';
    } else if (hasCrypto) {
      tierContext = 'We have cryptocurrency/Web3 articles';
    } else if (hasMacro) {
      tierContext = 'We have macroeconomic/financial articles';
    } else {
      tierContext = 'We have limited article coverage';
    }

    const systemPrompt = `You are a Bitcoin historical fact-checker with access to real-time web search.
Your task is to verify what event actually happened on a specific date.

PRIORITY HIERARCHY:
1. Bitcoin-specific news (highest priority)
2. Cryptocurrency/Web3 news (medium priority)
3. Macroeconomic/financial news (lowest priority)

When multiple events occurred on the same date, always prioritize Bitcoin news.

Return a JSON object:
{
  "verifiedDate": "YYYY-MM-DD or null if no event found",
  "confidence": 0-100,
  "reasoning": "detailed explanation with citations",
  "eventType": "bitcoin" | "crypto" | "macro" | "none"
}`;

    const userPrompt = `Date to verify: ${date}
    
${tierContext}.

Cached articles from our database:
${articlesContext}

QUESTION: Based on these articles and your web search, what event actually happened on ${date}?

Please verify:
1. Did the event described in these articles actually happen on ${date}?
2. If you find contradictory evidence, what is the correct date?
3. What type of event is this? (Bitcoin > Crypto > Macro priority)
4. How confident are you based on the evidence?

Respond ONLY with valid JSON.`;

    const messages: PerplexityMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callPerplexity(messages, { date, purpose: 'date-verification' });
    
    // Extract the response content
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in Perplexity response');
    }

    // Parse the JSON response
    let result;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      throw new Error(`Failed to parse Perplexity date verification response as JSON: ${content}`);
    }

    return {
      verifiedDate: result.verifiedDate || null,
      confidence: Number(result.confidence) || 50,
      reasoning: result.reasoning || 'Unable to parse reasoning',
      eventType: result.eventType || 'none',
      citations: response.citations || []
    };

  } catch (error) {
    console.error('Perplexity date verification error:', error);
    throw error;
  }
}

/**
 * Compare two summaries and determine which is more accurate for the event
 */
export async function compareSummariesWithPerplexity(
  originalDate: string,
  originalSummary: string,
  correctedDate: string,
  correctedSummary: string,
  cachedArticles: TieredArticles
): Promise<PerplexitySummaryComparisonResult> {
  try {
    console.log(`\n🔍 Comparing summaries for ${originalDate} vs ${correctedDate}`);
    
    // Build articles context for reference
    const buildArticlesContext = (articles: ArticleData[], tier: string) => {
      if (articles.length === 0) return '';
      return articles.map((a, i) => 
        `${tier.toUpperCase()} Article ${i + 1}:
Title: ${a.title}
URL: ${a.url}
Published: ${a.publishedDate}
Summary: ${a.summary || 'N/A'}`
      ).join('\n\n');
    };

    const articlesContext = [
      buildArticlesContext(cachedArticles.bitcoin, 'bitcoin'),
      buildArticlesContext(cachedArticles.crypto, 'crypto'),
      buildArticlesContext(cachedArticles.macro, 'macro')
    ].filter(Boolean).join('\n\n---\n\n');

    const systemPrompt = `You are a Bitcoin historian comparing two event summaries to determine which is more accurate.

PRIORITY HIERARCHY:
1. Bitcoin news (most important)
2. Crypto/Web3 news (medium importance)
3. Macroeconomic news (least important)

Your task: Compare these two summaries and determine which is MORE ACCURATE for describing what actually happened.

Respond ONLY with valid JSON:
{
  "winner": "original" | "corrected" | "neither",
  "confidence": 0-100,
  "reasoning": "detailed explanation with specific evidence",
  "citations": ["url1", "url2"]
}`;

    const userPrompt = `ORIGINAL DATE: ${originalDate}
Summary: "${originalSummary}"

CORRECTED DATE: ${correctedDate}
Summary: "${correctedSummary}"

Cached articles for reference:
${articlesContext}

QUESTION: Which summary is MORE ACCURATE for the event that actually happened?

Consider:
1. Factual accuracy based on your knowledge and web search
2. Does one summary describe a more significant event (Bitcoin > Crypto > Macro)?
3. Is one summary clearly wrong or misleading?
4. If both are equally valid, choose "neither"

Respond ONLY with valid JSON.`;

    const messages: PerplexityMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callPerplexity(messages, { 
      date: `${originalDate} vs ${correctedDate}`, 
      purpose: 'summary-comparison' 
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in Perplexity response');
    }

    // Parse the JSON response
    let result;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      throw new Error(`Failed to parse Perplexity comparison response as JSON: ${content}`);
    }

    console.log(`✅ Comparison complete: winner = ${result.winner}, confidence = ${result.confidence}`);

    return {
      winner: result.winner || 'neither',
      confidence: Number(result.confidence) || 50,
      reasoning: result.reasoning || 'Unable to parse reasoning',
      citations: result.citations || response.citations || []
    };

  } catch (error) {
    console.error('Perplexity summary comparison error:', error);
    throw error;
  }
}

/**
 * Validate if an article describes an actual event that happened on a specific date
 * (vs just a general overview published on that date)
 */
export async function validateArticleIsDateSpecificEvent(
  article: ArticleData,
  targetDate: string
): Promise<{ isValid: boolean; reasoning: string; confidence: number }> {
  try {
    const systemPrompt = `You are a precise historical fact-checker. Your task is to determine if an article describes a SPECIFIC EVENT that actually happened on a given date, or if it's just a general overview/analysis article that happens to be published on that date.

CRITICAL DISTINCTION:
- ✅ VALID: Article describes a specific event that occurred on the target date (e.g., "Bitcoin price surged 10% today", "Company X announced Y today", "Regulation Z was passed today")
- ❌ INVALID: Article is a general overview, analysis, or listicle published on that date but not about a specific event (e.g., "Here are six projects looking to...", "Overview of trends in...", "Analysis of the market...")

Return JSON:
{
  "isValid": true | false,
  "reasoning": "detailed explanation",
  "confidence": 0-100
}`;

    const userPrompt = `Target Date: ${targetDate}

Article to validate:
Title: ${article.title}
URL: ${article.url}
Published: ${article.publishedDate}
Summary: ${article.summary || 'N/A'}
${article.text ? `\nText excerpt: ${article.text.substring(0, 500)}...` : ''}

QUESTION: Does this article describe a SPECIFIC EVENT that actually happened on ${targetDate}, or is it just a general overview/analysis article published on that date?

Use your web search to verify:
1. Does the article describe something that happened on ${targetDate}?
2. Or is it just published on ${targetDate} but discusses general topics/trends?

Respond ONLY with valid JSON.`;

    const messages: PerplexityMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callPerplexity(messages, { 
      date: targetDate, 
      purpose: 'validate-article-date-specificity' 
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in Perplexity response');
    }

    // Parse the JSON response
    let result;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      throw new Error(`Failed to parse Perplexity validation response as JSON: ${content}`);
    }

    return {
      isValid: result.isValid === true,
      reasoning: result.reasoning || 'Unable to parse reasoning',
      confidence: Number(result.confidence) || 50
    };

  } catch (error) {
    console.error('Perplexity article validation error:', error);
    // On error, default to invalid to be safe
    return {
      isValid: false,
      reasoning: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      confidence: 0
    };
  }
}

/**
 * Find best replacement article from cached articles, excluding already-used article
 */
export async function findReplacementArticleWithPerplexity(
  date: string,
  excludeArticleId: string,
  cachedArticles: TieredArticles
): Promise<{ articleId: string; tier: 'bitcoin' | 'crypto' | 'macro'; article: ArticleData }> {
  try {
    console.log(`\n🔍 Finding replacement article for ${date}, excluding ${excludeArticleId}`);
    
    // Filter out the excluded article from all tiers
    const availableArticles = {
      bitcoin: cachedArticles.bitcoin.filter(a => a.id !== excludeArticleId),
      crypto: cachedArticles.crypto.filter(a => a.id !== excludeArticleId),
      macro: cachedArticles.macro.filter(a => a.id !== excludeArticleId)
    };

    // Build articles context
    const buildArticlesContext = (articles: ArticleData[], tier: string) => {
      if (articles.length === 0) return '';
      return articles.map((a, i) => 
        `ID: ${a.id}
Tier: ${tier.toUpperCase()}
Title: ${a.title}
URL: ${a.url}
Published: ${a.publishedDate}
Summary: ${a.summary || 'N/A'}`
      ).join('\n\n');
    };

    const articlesContext = [
      buildArticlesContext(availableArticles.bitcoin, 'bitcoin'),
      buildArticlesContext(availableArticles.crypto, 'crypto'),
      buildArticlesContext(availableArticles.macro, 'macro')
    ].filter(Boolean).join('\n\n---\n\n');

    if (!articlesContext) {
      throw new Error('No available articles after excluding already-used article');
    }

    const systemPrompt = `You are a Bitcoin news analyst selecting the BEST article for a specific date.

PRIORITY HIERARCHY (STRICT):
1. Bitcoin news (HIGHEST priority - always prefer if available and relevant)
2. Crypto/Web3 news (MEDIUM priority - only if no relevant Bitcoin news)
3. Macroeconomic news (LOWEST priority - only if no relevant Bitcoin/Crypto news)

Your task: Select the BEST article from the available options.

Respond ONLY with valid JSON:
{
  "articleId": "the ID of the selected article",
  "reasoning": "why this article is the best choice considering tier hierarchy and relevance"
}`;

    const userPrompt = `Date: ${date}

Available articles (excluding already-used article ${excludeArticleId}):
${articlesContext}

QUESTION: Which article is the BEST choice for ${date}?

Selection criteria:
1. HIGHEST PRIORITY: Bitcoin news (if available and relevant)
2. MEDIUM PRIORITY: Crypto/Web3 news (only if no Bitcoin news)
3. LOWEST PRIORITY: Macroeconomic news (last resort)
4. Within same tier, choose most significant/relevant event

Respond ONLY with valid JSON containing articleId and reasoning.`;

    const messages: PerplexityMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callPerplexity(messages, { 
      date, 
      purpose: 'article-replacement' 
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in Perplexity response');
    }

    // Parse the JSON response
    let result;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      throw new Error(`Failed to parse Perplexity article replacement response as JSON: ${content}`);
    }

    const selectedId = result.articleId;
    if (!selectedId) {
      throw new Error('No articleId in Perplexity response');
    }

    // Find the selected article
    let selectedArticle: ArticleData | undefined;
    let tier: 'bitcoin' | 'crypto' | 'macro' | undefined;

    if (availableArticles.bitcoin.find(a => a.id === selectedId)) {
      selectedArticle = availableArticles.bitcoin.find(a => a.id === selectedId);
      tier = 'bitcoin';
    } else if (availableArticles.crypto.find(a => a.id === selectedId)) {
      selectedArticle = availableArticles.crypto.find(a => a.id === selectedId);
      tier = 'crypto';
    } else if (availableArticles.macro.find(a => a.id === selectedId)) {
      selectedArticle = availableArticles.macro.find(a => a.id === selectedId);
      tier = 'macro';
    }

    if (!selectedArticle || !tier) {
      throw new Error(`Selected article ID ${selectedId} not found in available articles`);
    }

    console.log(`✅ Replacement article selected: ${selectedId} from ${tier} tier`);
    console.log(`   Reasoning: ${result.reasoning}`);

    return {
      articleId: selectedId,
      tier,
      article: selectedArticle
    };

  } catch (error) {
    console.error('Perplexity article replacement error:', error);
    throw error;
  }
}


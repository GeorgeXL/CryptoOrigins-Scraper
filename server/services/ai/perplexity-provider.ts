
import { IAiProvider, CompletionOptions, CompletionResult, JsonCompletionOptions } from "./types";
import { apiMonitor } from "../api-monitor";
import { ArticleData } from "@shared/schema";
import { z } from "zod";

// Define Perplexity API types locally since we don't have a dedicated SDK
interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class PerplexityProvider implements IAiProvider {
  private apiKey: string;
  private defaultModel = "sonar";
  private baseUrl = "https://api.perplexity.ai/chat/completions";

  constructor(apiKey?: string) {
    const key = apiKey || process.env.PERPLEXITY_API_KEY;
    if (!key) {
      throw new Error("PERPLEXITY_API_KEY environment variable is required");
    }
    this.apiKey = key;
  }

  getName(): string {
    return "perplexity";
  }

  async complete(prompt: string, options?: Partial<CompletionOptions>): Promise<string> {
    const result = await this.generateCompletion({
      prompt,
      ...options,
      model: options?.model || this.defaultModel,
    });
    return result.text;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.generateCompletion({
        prompt: "ping",
        maxTokens: 5
      });
      return true;
    } catch (error) {
      console.error("Perplexity health check failed:", error);
      return false;
    }
  }

  async generateCompletion(options: CompletionOptions): Promise<CompletionResult> {
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'perplexity',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'completion',
      requestData: { model: options.model || this.defaultModel }
    });

    try {
      const messages: PerplexityMessage[] = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: options.prompt });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model || this.defaultModel,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens,
          return_citations: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content || "";
      
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: data.usage?.total_tokens
      });

      return {
        text,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        modelUsed: data.model,
      };
    } catch (error) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async generateJson<T>(options: JsonCompletionOptions<T>): Promise<T> {
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'perplexity',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'json-completion',
      requestData: { model: options.model || this.defaultModel }
    });

    try {
      // Perplexity doesn't support response_format: json_object well yet on all models
      // So we enforce it via prompt injection
      const prompt = `${options.prompt}\n\nRespond ONLY with valid JSON.`;
      
      const messages: PerplexityMessage[] = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model || this.defaultModel,
          messages,
          temperature: options.temperature ?? 0.1, // Lower temp for JSON
          max_tokens: options.maxTokens,
          return_citations: false, // Disable citations for JSON generation - we're analyzing provided text, not searching web
        }),
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content || "{}";
      
      // Clean up markdown code blocks
      const cleanContent = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleanContent);

      if (options.schema) {
        return options.schema.parse(result);
      }
      
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: data.usage?.total_tokens,
        responseData: {
          rawContent: cleanContent.substring(0, 500), // First 500 chars
          parsed: result,
          tokens: data.usage?.total_tokens
        }
      });

      return result as T;
    } catch (error) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async compareSummaries(originalDate: string, originalSummary: string, newDate: string, newSummary: string, articles: any): Promise<{ winner: 'original' | 'new'; reasoning: string; }> {
    // Handle TieredArticles object - flatten to array
    let articleList: any[] = [];
    if (articles) {
      if (Array.isArray(articles)) {
        articleList = articles;
      } else if (typeof articles === 'object') {
        // It's a TieredArticles object
        const tiered = articles as { bitcoin?: any[]; crypto?: any[]; macro?: any[] };
        articleList = [
          ...(tiered.bitcoin || []),
          ...(tiered.crypto || []),
          ...(tiered.macro || [])
        ];
      }
    }

    const articleTitles = articleList
      .slice(0, 10) // Limit to first 10 articles
      .map((a: any) => `- ${a.title || a.id || 'Unknown'}`)
      .join('\n');

    const prompt = `You are a Bitcoin news analyst. Compare two news summaries and decide which one is a better fit for the date ${newDate}.

    **Original Summary (from date ${originalDate}):**
    "${originalSummary}"

    **New Summary (from date ${newDate}):**
    "${newSummary}"

    **Context from ${newDate} articles:**
    ${articleTitles || 'No articles available'}

    **Task:**
    1.  Determine which summary is more relevant and significant for the date ${newDate}.
    2.  The "original" summary might be better if it was mistakenly assigned to the wrong date.
    3.  The "new" summary is likely better if it's already about ${newDate}.
    4.  Provide reasoning.

    Return JSON: {"winner": "original" or "new", "reasoning": "Your explanation"}`;
    
    return this.generateJson({
      prompt,
      model: this.defaultModel, // Use default model instead of hardcoded
      schema: z.object({
        winner: z.enum(['original', 'new']),
        reasoning: z.string(),
      }),
    });
  }

  async validateArticleIsDateSpecificEvent(article: ArticleData, date: string): Promise<{ isValid: boolean; reasoning: string; confidence: number; }> {
    const prompt = `You are a fact-checker. Verify if an article is about a specific event that happened on a specific date, not a general overview or analysis.

    **Date to Verify:** ${date}
    **Article Title:** ${article.title}
    **Article Text:**
    "${(article.text || article.summary || '').substring(0, 1500)}"

    **Task:**
    1.  Read the article text to find mentions of a specific event.
    2.  Check if the event described occurred ON or was announced on ${date}.
    3.  If the article is a general analysis, a market recap, or discusses a trend without a specific event on that date, it is NOT valid.
    4.  Provide a confidence score (0-100) for your decision.

    Return JSON: {"isValid": boolean, "reasoning": "Explanation", "confidence": number}`;

    return this.generateJson({
      prompt,
      model: this.defaultModel, // Use default model instead of hardcoded
      schema: z.object({
        isValid: z.boolean(),
        reasoning: z.string(),
        confidence: z.number(),
      }),
    });
  }

  async verifyEventDate(summary: string, date: string): Promise<{ approved: boolean; reasoning: string }> {
    console.log(`🔵 Perplexity verifyEventDate called for date: ${date}`);
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'perplexity',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'final-analysis-verification',
      date: date,
      purpose: 'Verify event date',
      requestData: { model: this.defaultModel }
    });
    console.log(`📊 Perplexity API Monitor request logged with ID: ${requestId}`);

    try {
      const prompt = `You are a fact-checker verifying if a news summary describes an event that actually happened on a specific date.

Date: ${date}
Summary: "${summary}"

Task:
1. Verify if the event described in the summary actually occurred on ${date}
2. Check if the summary describes a specific event (not a general trend or analysis)
3. Return "approved: true" if the event happened on that date, "approved: false" otherwise
4. Provide brief reasoning for your decision

Return JSON: {"approved": boolean, "reasoning": string}`;

      const systemPrompt = "You are a fact-checker for historical news events. Be precise and verify that events actually occurred on the specified date.";

      const result = await this.generateJson<{ approved: boolean; reasoning: string }>({
        prompt,
        systemPrompt,
        model: this.defaultModel, // Use default model instead of invalid model name
        schema: z.object({
          approved: z.boolean(),
          reasoning: z.string(),
        }),
        maxTokens: 500,
        temperature: 0.2,
      });

      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: JSON.stringify(result).length
      });

      return result;
    } catch (error) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Comprehensive fact-check that returns verdict, citations, correct date, and confidence
   */
  async factCheckEvent(summary: string, date: string): Promise<{
    verdict: 'verified' | 'contradicted' | 'uncertain';
    confidence: number;
    reasoning: string;
    correctDateText: string | null;
    citations: string[];
  }> {
    console.log(`🔵 Perplexity factCheckEvent called for date: ${date}`);
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'perplexity',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'fact-check-comprehensive',
      date: date,
      purpose: 'Comprehensive fact-check with citations',
      requestData: { model: this.defaultModel }
    });

    try {
      const prompt = `You are a fact-checker verifying if a news summary describes an event that actually happened on a specific date.

Date: ${date}
Summary: "${summary}"

Task:
1. Search the web to verify if the event described in the summary actually occurred on ${date}
2. Check if the summary describes a specific event (not a general trend or analysis)
3. Determine verdict:
   - "verified": The event happened on ${date}
   - "contradicted": The event did NOT happen on ${date} (or happened on a different date)
   - "uncertain": Cannot determine with confidence
4. Provide confidence score (0-100)
5. Provide detailed reasoning with citations
6. Do NOT try to find the correct date - just verify if this event happened on ${date}

Return JSON: {
  "verdict": "verified" | "contradicted" | "uncertain",
  "confidence": number (0-100),
  "reasoning": "string",
  "correctDateText": null,
  "citations": ["url1", "url2", ...]
}`;

      const systemPrompt = "You are a fact-checker for historical news events. Use web search to verify events and provide citations. Be precise about dates.";

      const messages: PerplexityMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${prompt}\n\nRespond ONLY with valid JSON.` }
      ];

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages,
          temperature: 0.2,
          max_tokens: 1000,
          return_citations: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content || "{}";
      
      // Extract citations from Perplexity response
      const citations: string[] = [];
      if (data.citations && Array.isArray(data.citations)) {
        citations.push(...data.citations);
      }
      // Also check if citations are in the response metadata
      if (data.choices?.[0]?.message?.citations) {
        citations.push(...data.choices[0].message.citations);
      }

      // Clean up markdown code blocks
      const cleanContent = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleanContent);

      // Validate and parse result
      const schema = z.object({
        verdict: z.enum(['verified', 'contradicted', 'uncertain']),
        confidence: z.number().min(0).max(100),
        reasoning: z.string(),
        correctDateText: z.string().nullable(),
        citations: z.array(z.string()).optional(),
      });

      const validated = schema.parse({
        ...result,
        citations: citations.length > 0 ? citations : (result.citations || []),
      });

      // Parse and validate correctDateText - extract actual date if it's a text description
      if (validated.correctDateText) {
        // Try to extract a date from text like "mid-December 2024" or "2024-12-15"
        const dateMatch = validated.correctDateText.match(/\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          validated.correctDateText = dateMatch[0];
        } else {
          // If no valid date format found, set to null (cleaner will handle finding new event)
          console.log(`⚠️ Could not parse date from correctDateText: "${validated.correctDateText}", setting to null`);
          validated.correctDateText = null;
        }
      }

      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: data.usage?.total_tokens
      });

      return validated;
    } catch (error) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Battle feature: Select relevant article IDs from a list of articles for a given date
   * Returns array of article IDs that are relevant to the date
   */
  async selectRelevantArticles(
    articles: Array<{ id: string; title: string; summary?: string }>,
    date: string
  ): Promise<{
    articleIds: string[];
    status: 'success' | 'no_matches' | 'error';
    error?: string;
  }> {
    if (!articles || articles.length === 0) {
      return { articleIds: [], status: 'no_matches' };
    }

    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'perplexity',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: 'battle-article-selection',
      purpose: 'Select relevant articles for battle',
    });

    try {
      // Build articles list for prompt - include URL for matching
      const articlesList = articles.map((article, index) => {
        const articleWithUrl = article as any;
        return `ID: ${article.id}
Title: ${article.title}
URL: ${articleWithUrl.url || 'N/A'}`;
      }).join('\n\n');

      const prompt = `You are analyzing news articles for ${date}. Review the following articles and identify which ones describe events that actually occurred on or around this date.

ARTICLES:
${articlesList}

CRITICAL: Return ONLY the exact article IDs as shown above (the "ID:" field), NOT URLs or titles. Use the exact ID values provided. If you must use URLs, ensure they match exactly with the URLs shown above.

Return ONLY a JSON array of article IDs that are relevant to ${date}. If no articles are relevant, return an empty array [].

Format: ["id1", "id2", ...]`;

      const messages: PerplexityMessage[] = [
        {
          role: 'system',
          content: 'You are a fact-checker that identifies news articles relevant to specific dates. Return only valid JSON arrays of article IDs.'
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages,
          temperature: 0.2,
          max_tokens: 500,
          return_citations: false, // Disable citations for battle feature to reduce cost
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Perplexity API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '[]';

      // Clean up markdown code blocks
      let cleanContent = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      
      // Extract JSON array
      const jsonMatch = cleanContent.match(/\[.*\]/s);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
      }

      // Try to parse JSON, with error handling for malformed JSON
      let articleIds: string[] = [];
      try {
        articleIds = JSON.parse(cleanContent);
      } catch (parseError: any) {
        console.warn(`🟣 [Perplexity] JSON parse error: ${parseError.message}`);
        console.warn(`🟣 [Perplexity] Attempting to repair JSON...`);
        
        // Try to repair common JSON issues
        try {
          // Fix unterminated strings by closing them
          let repaired = cleanContent;
          
          // Count quotes to find unterminated strings
          const quoteCount = (repaired.match(/"/g) || []).length;
          if (quoteCount % 2 !== 0) {
            // Odd number of quotes - likely unterminated string
            // Find the last unclosed quote and close it
            const lastQuoteIndex = repaired.lastIndexOf('"');
            if (lastQuoteIndex !== -1) {
              // Check if it's inside a string (not escaped)
              const beforeQuote = repaired.substring(0, lastQuoteIndex);
              const escapedQuotes = (beforeQuote.match(/\\"/g) || []).length;
              const actualQuotes = (beforeQuote.match(/"/g) || []).length - escapedQuotes;
              
              if (actualQuotes % 2 !== 0) {
                // This quote starts a string that wasn't closed
                // Try to find where the string should end and close it
                const afterQuote = repaired.substring(lastQuoteIndex + 1);
                const nextComma = afterQuote.indexOf(',');
                const nextBracket = afterQuote.indexOf(']');
                
                if (nextComma !== -1 && (nextBracket === -1 || nextComma < nextBracket)) {
                  // Insert closing quote before comma
                  repaired = repaired.substring(0, lastQuoteIndex + 1 + nextComma) + '"' + repaired.substring(lastQuoteIndex + 1 + nextComma);
                } else if (nextBracket !== -1) {
                  // Insert closing quote before closing bracket
                  repaired = repaired.substring(0, lastQuoteIndex + 1 + nextBracket) + '"' + repaired.substring(lastQuoteIndex + 1 + nextBracket);
                } else {
                  // Just close at the end
                  repaired = repaired + '"';
                }
              }
            }
          }
          
          // Try parsing the repaired JSON
          articleIds = JSON.parse(repaired);
          console.log(`🟣 [Perplexity] Successfully repaired and parsed JSON`);
        } catch (repairError) {
          // If repair fails, try to extract article IDs using regex as fallback
          console.warn(`🟣 [Perplexity] JSON repair failed, trying regex extraction...`);
          
          // Extract potential IDs using regex (look for quoted strings that look like IDs)
          const idMatches = cleanContent.match(/"([^"]{10,})"/g) || [];
          const extractedIds = idMatches
            .map(match => match.replace(/"/g, ''))
            .filter(id => id.length > 10); // Filter to reasonable ID lengths
          
          if (extractedIds.length > 0) {
            console.log(`🟣 [Perplexity] Extracted ${extractedIds.length} IDs using regex fallback`);
            articleIds = extractedIds;
          } else {
            // Last resort: try to extract from the raw text
            const urlMatches = cleanContent.match(/https?:\/\/[^\s"']+/g) || [];
            if (urlMatches.length > 0) {
              console.log(`🟣 [Perplexity] Found ${urlMatches.length} URLs, will try to match to article IDs`);
              articleIds = urlMatches;
            } else {
              console.error(`🟣 [Perplexity] Could not extract article IDs from malformed JSON`);
              apiMonitor.updateRequest(requestId, {
                status: 'error',
                duration: Date.now() - startTime,
                error: `JSON parse error: ${parseError.message}. Could not repair or extract IDs.`,
                responseData: {
                  rawResponse: cleanContent.substring(0, 1000),
                  parseError: parseError.message
                }
              });
              return { articleIds: [], status: 'error', error: `JSON parse error: ${parseError.message}` };
            }
          }
        }
      }
      
      // Validate it's an array of strings
      if (!Array.isArray(articleIds)) {
        console.warn('Perplexity returned non-array, returning empty array');
        return [];
      }

      // Try to match by ID first, then by URL if ID doesn't match
      const normalizeUrl = (url: string) => {
        try {
          const urlObj = new URL(url);
          return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.toLowerCase().replace(/\/$/, '');
        } catch {
          return url.toLowerCase().replace(/\/$/, '');
        }
      };
      
      const validIds = articleIds.filter(id => {
        if (typeof id !== 'string') return false;
        
        // Direct ID match
        const directMatch = articles.some(a => a.id === id);
        if (directMatch) return true;
        
        // URL match (in case Perplexity returned URLs instead of IDs)
        const normalizedId = normalizeUrl(id);
        
        const urlMatch = articles.some(a => {
          const articleWithUrl = a as any;
          if (!articleWithUrl.url) return false;
          
          // Exact URL match
          if (articleWithUrl.url === id) return true;
          
          // Normalized URL match (handles query params, trailing slashes)
          const normalizedArticleUrl = normalizeUrl(articleWithUrl.url);
          if (normalizedArticleUrl === normalizedId) return true;
          
          // Partial match (check if the returned URL contains the article URL or vice versa)
          if (id.includes(articleWithUrl.url) || articleWithUrl.url.includes(id)) return true;
          
          return false;
        });
        
        if (urlMatch) {
          // Find the actual ID for this URL
          const matchedArticle = articles.find(a => {
            const articleWithUrl = a as any;
            if (!articleWithUrl.url) return false;
            
            if (articleWithUrl.url === id) return true;
            
            const normalizedArticleUrl = normalizeUrl(articleWithUrl.url);
            const normalizedId = normalizeUrl(id);
            if (normalizedArticleUrl === normalizedId) return true;
            
            if (id.includes(articleWithUrl.url) || articleWithUrl.url.includes(id)) return true;
            
            return false;
          });
          if (matchedArticle) {
            console.log(`🟣 [Perplexity] Matched URL to ID: ${id.substring(0, 60)}... -> ${matchedArticle.id}`);
            return true;
          }
        }
        
        return false;
      }).map(id => {
        // If it's a URL, convert to actual article ID
        const matchedArticle = articles.find(a => {
          const articleWithUrl = a as any;
          if (!articleWithUrl.url) return false;
          
          if (articleWithUrl.url === id) return true;
          
          const normalizedArticleUrl = normalizeUrl(articleWithUrl.url);
          const normalizedId = normalizeUrl(id);
          if (normalizedArticleUrl === normalizedId) return true;
          
          if (id.includes(articleWithUrl.url) || articleWithUrl.url.includes(id)) return true;
          
          return false;
        });
        return matchedArticle ? matchedArticle.id : id;
      });
      
      if (articleIds.length > 0 && validIds.length === 0) {
        console.warn(`🟣 [Perplexity] WARNING: Perplexity returned ${articleIds.length} IDs but none matched!`);
        console.warn(`🟣 [Perplexity] Sample returned IDs: ${articleIds.slice(0, 3).join(', ')}`);
        console.warn(`🟣 [Perplexity] Sample input article IDs: ${articles.slice(0, 3).map(a => a.id).join(', ')}`);
      }

      // Determine status: success if we have matches, no_matches if AI returned empty array
      const status = validIds.length > 0 ? 'success' : (articleIds.length === 0 ? 'no_matches' : 'success');

      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: data.usage?.total_tokens,
        responseData: {
          rawResponse: cleanContent.substring(0, 1000), // First 1000 chars of raw response
          parsedArticleIds: articleIds,
          validArticleIds: validIds,
          status: status,
          totalArticlesAnalyzed: articles.length,
          matchedCount: validIds.length,
          tokens: data.usage?.total_tokens
        }
      });

      return {
        articleIds: validIds,
        status: status
      };
    } catch (error) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      console.error('Error selecting relevant articles with Perplexity:', error);
      return {
        articleIds: [],
        status: 'error',
        error: (error as Error).message
      };
    }
  }
}


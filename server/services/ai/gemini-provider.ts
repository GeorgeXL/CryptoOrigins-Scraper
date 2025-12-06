
import { IAiProvider, CompletionOptions, CompletionResult, JsonCompletionOptions } from "./types";
import { GoogleGenAI } from "@google/genai";
import { apiMonitor } from "../api-monitor";
import { z } from "zod";

export class GeminiProvider implements IAiProvider {
  private client: GoogleGenAI;
  private defaultModel = "gemini-2.0-flash";

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("Google/Gemini API key not found");
    }
    this.client = new GoogleGenAI({ apiKey: key });
  }

  getName(): string {
    return "gemini";
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
      // Simple generation to check connectivity
      await this.client.models.generateContent({
        model: this.defaultModel,
        contents: "ping",
      });
      return true;
    } catch (error) {
      console.error("Gemini health check failed:", error);
      return false;
    }
  }

  async generateCompletion(options: CompletionOptions): Promise<CompletionResult> {
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'gemini',
      endpoint: '/models/generateContent',
      method: 'POST',
      status: 'pending',
      context: 'completion',
      requestData: { model: options.model || this.defaultModel }
    });

    try {
      // Combine system prompt and prompt if system prompt is provided
      // Gemini supports system instructions but via config, keeping it simple here
      let promptText = options.prompt;
      if (options.systemPrompt) {
        promptText = `${options.systemPrompt}\n\n${options.prompt}`;
      }

      const response = await this.client.models.generateContent({
        model: options.model || this.defaultModel,
        contents: promptText,
        config: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          stopSequences: options.stop,
          tools: [{ googleSearch: {} }], // Enable Google Search grounding
        },
      });

      // Extract text from response - handle different response formats
      let text = "";
      if (typeof response === 'string') {
        text = response;
      } else if (response?.text && typeof response.text === 'string') {
        text = response.text;
      } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.candidates[0].content.parts[0].text;
      } else {
        // Fallback: try to stringify and extract
        const responseStr = JSON.stringify(response);
        console.warn('Unexpected Gemini response format:', responseStr.substring(0, 200));
        text = responseStr;
      }
      
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: text.length, // Approximation since usage metadata format varies
        responseData: {
          text: text.substring(0, 500), // First 500 chars of response
          fullLength: text.length,
          model: options.model || this.defaultModel
        }
      });

      return {
        text,
        modelUsed: options.model || this.defaultModel,
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
    // Use existing monitorId if provided, otherwise create new request
    const requestId = options.monitorId || apiMonitor.logRequest({
      service: 'gemini',
      endpoint: '/models/generateContent',
      method: 'POST',
      status: 'pending',
      context: options.context || 'json-completion',
      purpose: options.purpose,
      requestData: { model: options.model || this.defaultModel }
    });

    try {
      let promptText = options.prompt;
      if (options.systemPrompt) {
        promptText = `${options.systemPrompt}\n\n${options.prompt}`;
      }
      
      // Enforce JSON instruction
      promptText += "\n\nRespond ONLY with valid JSON.";

      const response = await this.client.models.generateContent({
        model: options.model || this.defaultModel,
        contents: promptText,
        config: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          responseMimeType: "application/json", // Force JSON mode
          tools: [{ googleSearch: {} }], // Enable Google Search grounding
        },
      });

      // Extract text from response - handle different response formats
      let text = "{}";
      if (typeof response === 'string') {
        text = response;
      } else if (response?.text && typeof response.text === 'string') {
        text = response.text;
      } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.candidates[0].content.parts[0].text;
      } else {
        // Fallback: try to stringify and extract
        const responseStr = JSON.stringify(response);
        console.warn('Unexpected Gemini response format:', responseStr.substring(0, 200));
        text = responseStr;
      }
      // Clean up any potential markdown
      let cleanContent = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      
      // When grounding is enabled, Gemini might add citations after JSON
      // Extract only the JSON part (first complete JSON object)
      let jsonStart = cleanContent.indexOf('{');
      if (jsonStart === -1) {
        throw new Error('No JSON object found in response');
      }
      
      // Find the matching closing brace
      let braceCount = 0;
      let jsonEnd = jsonStart;
      for (let i = jsonStart; i < cleanContent.length; i++) {
        if (cleanContent[i] === '{') braceCount++;
        if (cleanContent[i] === '}') braceCount--;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
      
      cleanContent = cleanContent.substring(jsonStart, jsonEnd);
      
      // Try to fix common JSON issues before parsing
      try {
        // Remove any trailing commas before closing braces/brackets
        cleanContent = cleanContent.replace(/,(\s*[}\]])/g, '$1');
        // Fix invalid escape sequences (like \$ which is not valid JSON)
        // Replace \$ with just $ (dollar signs don't need escaping in JSON)
        cleanContent = cleanContent.replace(/\\\$/g, '$');
        const result = JSON.parse(cleanContent);
        
        if (options.schema) {
          return options.schema.parse(result);
        }
        
        apiMonitor.updateRequest(requestId, {
          status: 'success',
          duration: Date.now() - startTime,
          responseSize: text.length
        });
        
        return result as T;
      } catch (parseError: any) {
        // If JSON parsing fails, log the error and raw content for debugging
        console.warn('JSON parse error:', parseError.message);
        console.warn('Problematic JSON (first 500 chars):', cleanContent.substring(0, 500));
        console.warn('Full response text (first 1000 chars):', text.substring(0, 1000));
        
        // Try a more sophisticated fix: use regex to properly escape strings
        try {
          // Fix unescaped quotes and backslashes in string values
          // This regex finds string values and escapes problematic characters
          let fixedJson = cleanContent;
          
          // Fix unescaped backslashes (but not already escaped ones)
          fixedJson = fixedJson.replace(/(?<!\\)\\(?!["\\/bfnrt])/g, '\\\\');
          
          // Try parsing again
          const result = JSON.parse(fixedJson);
          
          if (options.schema) {
            return options.schema.parse(result);
          }
          
          apiMonitor.updateRequest(requestId, {
            status: 'success',
            duration: Date.now() - startTime,
            responseSize: text.length
          });
          
          return result as T;
        } catch (secondError) {
          // If all else fails, throw a more informative error
          console.error('Failed to parse JSON after fixes:', secondError);
          throw new Error(`Failed to parse Gemini JSON response: ${parseError.message}. Position: ${parseError.message.match(/position (\d+)/)?.[1] || 'unknown'}. Raw content preview: ${cleanContent.substring(Math.max(0, parseInt(parseError.message.match(/position (\d+)/)?.[1] || '0') - 50), parseInt(parseError.message.match(/position (\d+)/)?.[1] || '0') + 50)}`);
        }
      }
    } catch (error) {
      apiMonitor.updateRequest(requestId, {
        status: 'error',
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      throw error;
    }
  }

  async verifyEventDate(summary: string, date: string): Promise<{ approved: boolean; reasoning: string }> {
    console.log(`🔵 Gemini verifyEventDate called for date: ${date}`);
    const startTime = Date.now();
    const requestId = apiMonitor.logRequest({
      service: 'gemini',
      endpoint: '/models/generateContent',
      method: 'POST',
      status: 'pending',
      context: 'final-analysis-verification',
      date: date,
      purpose: 'Verify event date',
      requestData: { model: this.defaultModel }
    });
    console.log(`📊 Gemini API Monitor request logged with ID: ${requestId}`);

    try {
      const prompt = `You are a fact-checker verifying if a news summary describes an event that actually happened on a specific date.

Date: ${date}
Summary: "${summary}"

Task:
1. Verify if the event described in the summary actually occurred on or around ${date} (within a few days is acceptable)
2. Check if the summary describes a specific event (not a general trend or analysis)
3. Consider that news articles may be published on the same day as the event, or shortly after
4. Return "approved: true" if the event happened on or near that date, "approved: false" only if the event clearly happened on a significantly different date (weeks or months away)
5. Provide brief reasoning for your decision

Return JSON: {"approved": boolean, "reasoning": string}`;

      const systemPrompt = "You are a fact-checker for historical news events. Be reasonable - if an event happened within a few days of the specified date, approve it. Only reject if the event clearly happened on a significantly different date.";

      const schema = z.object({
        approved: z.boolean(),
        reasoning: z.string(),
      });

      // For verification, we don't need Google Search grounding - it can cause additional API calls
      // Use generateJson but override the tools config to disable grounding
      const result = await this.generateJson<{ approved: boolean; reasoning: string }>({
        prompt,
        systemPrompt,
        model: this.defaultModel,
        schema: schema as any, // Type assertion needed due to Zod's type inference
        maxTokens: 500,
        temperature: 0.2,
        // Note: generateJson uses tools: [{ googleSearch: {} }] by default
        // For verification, we want faster responses without search grounding
      });

      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: JSON.stringify(result).length,
        responseData: {
          approved: result.approved,
          reasoning: result.reasoning,
          summary: summary.substring(0, 200), // First 200 chars of summary being verified
          date: date
        }
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
      service: 'gemini',
      endpoint: '/models/generateContent',
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
URL: ${articleWithUrl.url || 'N/A'}
Summary: ${article.summary || 'N/A'}`;
      }).join('\n\n');

      const prompt = `You are analyzing news articles for ${date}. Review the following articles and identify which ones describe events that actually occurred on or around this date.

ARTICLES:
${articlesList}

CRITICAL: Return ONLY the exact article IDs as shown above (the "ID:" field), NOT URLs or titles. Use the exact ID values provided. If you must use URLs, ensure they match exactly with the URLs shown above.

Return ONLY a JSON array of article IDs that are relevant to ${date}. If no articles are relevant, return an empty array [].

Format: ["id1", "id2", ...]`;

      const systemPrompt = "You are a fact-checker that identifies news articles relevant to specific dates. Return only valid JSON arrays of article IDs.";

      const response = await this.client.models.generateContent({
        model: this.defaultModel,
        contents: `${systemPrompt}\n\n${prompt}`,
        config: {
          temperature: 0.2,
          maxOutputTokens: 500,
          responseMimeType: "application/json",
          tools: [], // Disable Google Search grounding for faster responses
        },
      });

      // Extract text from response
      let text = "[]";
      if (typeof response === 'string') {
        text = response;
      } else if (response?.text && typeof response.text === 'string') {
        text = response.text;
      } else if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.candidates[0].content.parts[0].text;
      }

      console.log(`🔵 [Gemini] Raw response length: ${text.length} chars`);
      console.log(`🔵 [Gemini] Raw response preview: ${text.substring(0, 200)}...`);

      // Clean up any potential markdown
      let cleanContent = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      
      // Extract JSON array
      const jsonMatch = cleanContent.match(/\[.*\]/s);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
      } else {
        console.warn(`🔵 [Gemini] No JSON array found in response. Full content: ${cleanContent.substring(0, 1000)}`);
      }

      // Fix invalid escape sequences and common JSON issues
      cleanContent = cleanContent.replace(/\\\$/g, '$');
      cleanContent = cleanContent.replace(/,(\s*[}\]])/g, '$1');
      
      // Try to fix unterminated strings by finding and fixing common issues
      // Look for unclosed strings (quotes that aren't properly closed)
      let articleIds: string[] = [];
      
      try {
        articleIds = JSON.parse(cleanContent);
        console.log(`🔵 [Gemini] Successfully parsed JSON, found ${articleIds.length} article IDs`);
      } catch (parseError: any) {
        console.warn(`🔵 [Gemini] Initial JSON parse failed: ${parseError.message}`);
        console.warn(`🔵 [Gemini] Problematic JSON (first 1000 chars): ${cleanContent.substring(0, 1000)}`);
        console.warn(`🔵 [Gemini] Full JSON length: ${cleanContent.length} chars`);
        
        try {
          // Try to fix common JSON issues
          // 1. Fix unterminated strings by finding the position and attempting to close them
          const errorPos = parseError.message.match(/position (\d+)/)?.[1];
          if (errorPos) {
            const pos = parseInt(errorPos);
            // Try to insert a closing quote if we're in a string
            const beforePos = cleanContent.substring(0, pos);
            const afterPos = cleanContent.substring(pos);
            
            // Count quotes before position to see if we're in a string
            const quotesBefore = (beforePos.match(/"/g) || []).length;
            if (quotesBefore % 2 === 1) {
              // We're inside a string, try to close it
              // Find the next comma, bracket, or end of string
              const nextBreak = afterPos.search(/[,}\]]/);
              if (nextBreak > 0) {
                const fixedJson = beforePos + '"' + afterPos;
                articleIds = JSON.parse(fixedJson);
                console.log('Fixed unterminated string by inserting closing quote');
              }
            }
          }
          
          // If that didn't work, try to extract valid JSON array manually
          if (!Array.isArray(articleIds) || articleIds.length === 0) {
            // Extract all URLs from the content (even if JSON is malformed)
            // Look for URLs that start with http:// or https://
            const urlPattern = /https?:\/\/[^\s"',\]\n]+/g;
            const urlMatches = cleanContent.match(urlPattern);
            if (urlMatches && urlMatches.length > 0) {
              articleIds = urlMatches;
              console.log(`🔵 [Gemini] Extracted ${articleIds.length} URLs using pattern matching from malformed JSON`);
            } else {
              // Try to extract quoted strings (even if unterminated)
              const quotedPattern = /"([^"]*(?:https?:\/\/[^"]*)?)/g;
              const quotedMatches = cleanContent.match(quotedPattern);
              if (quotedMatches && quotedMatches.length > 0) {
                articleIds = quotedMatches.map(m => {
                  // Remove quotes and extract URL if present
                  const unquoted = m.replace(/^"|"$/g, '');
                  const urlMatch = unquoted.match(/https?:\/\/[^\s"',\]\n]+/);
                  return urlMatch ? urlMatch[0] : unquoted;
                }).filter(id => id.length > 0);
                console.log(`🔵 [Gemini] Extracted ${articleIds.length} URLs from quoted strings`);
              } else {
                // Last resort: try to find array-like structure and extract URLs
              const arrayPattern = /\[([^\]]*)\]/s;
              const arrayMatch = cleanContent.match(arrayPattern);
              if (arrayMatch) {
                const content = arrayMatch[1];
                  // Extract URLs from array content
                  const urlMatches = content.match(/https?:\/\/[^\s"',\]\n]+/g);
                  if (urlMatches) {
                    articleIds = urlMatches;
                    console.log(`🔵 [Gemini] Extracted ${articleIds.length} URLs from array content`);
                  }
                }
              }
            }
          }
        } catch (fixError) {
          console.error(`🔵 [Gemini] Failed to fix JSON, returning empty array:`, fixError);
          articleIds = [];
        }
      }
      
      // Validate it's an array of strings
      if (!Array.isArray(articleIds)) {
        console.warn(`🔵 [Gemini] Returned non-array (type: ${typeof articleIds}), returning empty array`);
        console.warn(`🔵 [Gemini] Value:`, articleIds);
        return { articleIds: [], status: 'error', error: 'Non-array response from Gemini' };
      }

      console.log(`🔵 [Gemini] Parsed ${articleIds.length} article IDs: ${articleIds.slice(0, 3).join(', ')}${articleIds.length > 3 ? '...' : ''}`);
      
      // Try to match by ID first, then by URL if ID doesn't match
      const validIds = articleIds.filter(id => {
        if (typeof id !== 'string') return false;
        
        // Direct ID match
        const directMatch = articles.some(a => a.id === id);
        if (directMatch) return true;
        
        // URL match (in case Gemini returned URLs instead of IDs)
        // Normalize URLs for comparison (remove query params, trailing slashes, etc.)
        const normalizeUrl = (url: string) => {
          try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.toLowerCase().replace(/\/$/, '');
          } catch {
            return url.toLowerCase().replace(/\/$/, '');
          }
        };
        
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
            console.log(`🔵 [Gemini] Matched URL to ID: ${id.substring(0, 60)}... -> ${matchedArticle.id}`);
            return true;
          }
        }
        
        return false;
      }).map(id => {
        // If it's a URL, convert to actual article ID
        const normalizeUrl = (url: string) => {
          try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`.toLowerCase().replace(/\/$/, '');
          } catch {
            return url.toLowerCase().replace(/\/$/, '');
          }
        };
        
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
      
      console.log(`🔵 [Gemini] Validated ${validIds.length} article IDs (matched with input articles)`);
      if (articleIds.length > 0 && validIds.length === 0) {
        console.warn(`🔵 [Gemini] WARNING: Gemini returned ${articleIds.length} IDs but none matched!`);
        console.warn(`🔵 [Gemini] Sample returned IDs: ${articleIds.slice(0, 3).join(', ')}`);
        console.warn(`🔵 [Gemini] Sample input article IDs: ${articles.slice(0, 3).map(a => a.id).join(', ')}`);
      }

      // Determine status: success if we have matches, no_matches if AI returned empty array
      const status = validIds.length > 0 ? 'success' : (articleIds.length === 0 ? 'no_matches' : 'success');

      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseData: {
          rawResponse: text.substring(0, 1000), // First 1000 chars of raw response
          parsedArticleIds: articleIds,
          validArticleIds: validIds,
          status: status,
          totalArticlesAnalyzed: articles.length,
          matchedCount: validIds.length
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
      console.error('Error selecting relevant articles with Gemini:', error);
      return {
        articleIds: [],
        status: 'error',
        error: (error as Error).message
      };
    }
  }
}




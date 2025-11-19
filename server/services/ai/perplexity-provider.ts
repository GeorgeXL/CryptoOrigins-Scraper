
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
        responseSize: data.usage?.total_tokens
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
    const prompt = `You are a Bitcoin news analyst. Compare two news summaries and decide which one is a better fit for the date ${newDate}.

    **Original Summary (from date ${originalDate}):**
    "${originalSummary}"

    **New Summary (from date ${newDate}):**
    "${newSummary}"

    **Context from ${newDate} articles:**
    ${articles.map((a: any) => `- ${a.title}`).join('\n')}

    **Task:**
    1.  Determine which summary is more relevant and significant for the date ${newDate}.
    2.  The "original" summary might be better if it was mistakenly assigned to the wrong date.
    3.  The "new" summary is likely better if it's already about ${newDate}.
    4.  Provide reasoning.

    Return JSON: {"winner": "original" or "new", "reasoning": "Your explanation"}`;
    
    return this.generateJson({
      prompt,
      model: 'sonar-small-32k-online',
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
      model: 'sonar-small-32k-online',
      schema: z.object({
        isValid: z.boolean(),
        reasoning: z.string(),
        confidence: z.number(),
      }),
    });
  }
}


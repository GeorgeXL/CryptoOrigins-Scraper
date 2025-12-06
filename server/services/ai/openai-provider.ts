
import { IAiProvider, CompletionOptions, CompletionResult, JsonCompletionOptions } from "./types";
import OpenAI from "openai";
import { z } from "zod";
import { apiMonitor } from "../api-monitor";

export class OpenAIProvider implements IAiProvider {
  private client: OpenAI;
  private defaultModel = "gpt-5-mini";

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  getName(): string {
    return "openai";
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
      await this.client.models.list();
      return true;
    } catch (error) {
      console.error("OpenAI health check failed:", error);
      return false;
    }
  }

  async generateCompletion(options: CompletionOptions): Promise<CompletionResult> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;
    const isGpt5 = model.startsWith('gpt-5');
    
    const requestId = apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: options.context || 'completion',
      purpose: options.purpose,
      requestData: { model }
    });

    try {
      const requestParams: any = {
        model,
        messages: [
          ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
          { role: "user" as const, content: options.prompt },
        ],
        stop: options.stop,
      };

      // GPT-5 models use max_completion_tokens instead of max_tokens
      // and don't support temperature parameter
      if (isGpt5) {
        requestParams.max_completion_tokens = options.maxTokens ? Math.max(options.maxTokens, 1000) : 1000;
      } else {
        requestParams.temperature = options.temperature ?? 0.7;
        requestParams.max_tokens = options.maxTokens;
      }

      const response = await this.client.chat.completions.create(requestParams);

      const text = response.choices[0]?.message?.content || "";
      
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: response.usage?.total_tokens,
        responseData: {
          text: text,
          model: response.model,
          tokens: {
            prompt: response.usage?.prompt_tokens,
            completion: response.usage?.completion_tokens,
            total: response.usage?.total_tokens
          }
        }
      });

      return {
        text,
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
        modelUsed: response.model,
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
    const model = options.model || this.defaultModel;
    const isGpt5 = model.startsWith('gpt-5');
    
    // Use existing monitorId if provided, otherwise create new request
    const requestId = options.monitorId || apiMonitor.logRequest({
      service: 'openai',
      endpoint: '/chat/completions',
      method: 'POST',
      status: 'pending',
      context: options.context || 'json-completion',
      purpose: options.purpose,
      requestData: { model }
    });

    try {
      const requestParams: any = {
        model,
        messages: [
          ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
          { role: "user" as const, content: options.prompt },
        ],
        response_format: { type: "json_object" },
      };

      // GPT-5 models use max_completion_tokens instead of max_tokens
      // and don't support temperature parameter
      if (isGpt5) {
        requestParams.max_completion_tokens = options.maxTokens ? Math.max(options.maxTokens, 1000) : 1000;
      } else {
        requestParams.temperature = options.temperature ?? 0.3;
        requestParams.max_tokens = options.maxTokens;
      }

      const response = await this.client.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content || "{}";
      
      // Clean up markdown code blocks if present
      const cleanContent = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const result = JSON.parse(cleanContent);

      if (options.schema) {
        return options.schema.parse(result);
      }
      
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: response.usage?.total_tokens,
        responseData: {
          content: cleanContent,
          parsed: result,
          tokens: {
            prompt: response.usage?.prompt_tokens,
            completion: response.usage?.completion_tokens,
            total: response.usage?.total_tokens
          }
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

  async evaluateEventSummary(summary: string, date: string, group: string): Promise<{ needsEnhancement: boolean; reasoning: string; }> {
    const prompt = `Evaluate the quality of a news summary for a historical timeline.

    Date: ${date}
    Group: ${group}
    Summary: "${summary}"

    Criteria for a high-quality summary:
    1.  **Concise and Specific:** Is it a single, impactful sentence?
    2.  **Date-Specific:** Does it describe a specific event that happened on that day, not a general trend?
    3.  **Neutral Tone:** Is it factual and avoids overly emotional or biased language?
    4.  **Clarity:** Is it easy to understand for someone unfamiliar with the topic?

    Task:
    - Determine if the summary needs enhancement based on the criteria.
    - Provide a brief reasoning for your decision.

    Return a JSON object with "needsEnhancement" (boolean) and "reasoning" (string).`;

    return this.generateJson({
      prompt,
      systemPrompt: "You are a quality control analyst for a historical news timeline.",
      model: 'gpt-5-mini',
      schema: z.object({
        needsEnhancement: z.boolean(),
        reasoning: z.string(),
      }),
    });
  }

  async enhanceEventSummary(summary: string, date: string, group: string): Promise<{ summary: string; reasoning: string; }> {
    const prompt = `Enhance this news summary to be a single, concise, and impactful sentence for a historical timeline.

    Date: ${date}
    Group: ${group}
    Original Summary: "${summary}"

    Enhancement Rules:
    1.  Rewrite as one clear and specific sentence.
    2.  Focus on the most important event or outcome.
    3.  Maintain a neutral, factual tone.
    4.  Ensure it's understandable to a general audience.

    Return a JSON object with the improved "summary" and a brief "reasoning" for the changes.`;
    
    return this.generateJson({
      prompt,
      systemPrompt: "You are an expert editor specializing in historical news summaries.",
      model: 'gpt-5-mini',
      schema: z.object({
        summary: z.string(),
        reasoning: z.string(),
      }),
    });
  }

  async doubleCheckSummary(summary: string): Promise<{ isValid: boolean; issues: string[]; reasoning: string }> {
    const prompt = `Review this summary for quality:

Summary: "${summary}"

Check the following:
1. Is it written in active voice? (e.g., "Bitcoin reaches $1000" not "Bitcoin reached $1000")
2. Is it a complete, clear sentence with proper structure?
3. Are there any quality issues? (placeholder text, weird formatting, unclear meaning, etc.)
4. Does it make sense and read well?

Return a JSON object with:
- "isValid": boolean (true if summary is well-written with no issues, false otherwise)
- "issues": array of strings (list any issues found, empty array if none)
- "reasoning": string (brief explanation of your assessment)`;

    return this.generateJson({
      prompt,
      systemPrompt: "You are a quality control reviewer for historical news summaries. Be thorough but fair.",
      model: 'gpt-4o-mini',
      schema: z.object({
        isValid: z.boolean(),
        issues: z.array(z.string()),
        reasoning: z.string(),
      }),
    });
  }

  /**
   * Generate embeddings for text(s) using OpenAI's text-embedding-3-small model
   * @param texts - Single text string or array of text strings
   * @returns Array of embedding vectors (number[][])
   */
  async embed(texts: string | string[]): Promise<number[][]> {
    const inputTexts = Array.isArray(texts) ? texts : [texts];
    
    try {
      const response = await this.client.embeddings.create({
        model: "text-embedding-3-small",
        input: inputTexts,
      });
      
      // Track API usage
      apiMonitor.logRequest({
        service: 'openai',
        endpoint: '/embeddings',
        method: 'POST',
        status: 'success',
        context: `${inputTexts.length} text(s)`,
      });
      
      return response.data.map(item => item.embedding);
    } catch (error) {
      console.error('OpenAI embedding error:', error);
      throw error;
    }
  }
}


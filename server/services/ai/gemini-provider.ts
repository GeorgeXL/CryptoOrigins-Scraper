
import { IAiProvider, CompletionOptions, CompletionResult, JsonCompletionOptions } from "./types";
import { GoogleGenAI } from "@google/genai";
import { apiMonitor } from "../api-monitor";
import { z } from "zod";

export class GeminiProvider implements IAiProvider {
  private client: GoogleGenAI;
  private defaultModel = "gemini-2.0-flash-exp";

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
        },
      });

      const text = response.text() || "";
      
      apiMonitor.updateRequest(requestId, {
        status: 'success',
        duration: Date.now() - startTime,
        responseSize: text.length // Approximation since usage metadata format varies
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
    const requestId = apiMonitor.logRequest({
      service: 'gemini',
      endpoint: '/models/generateContent',
      method: 'POST',
      status: 'pending',
      context: 'json-completion',
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
        },
      });

      const text = response.text() || "{}";
      // Clean up any potential markdown
      const cleanContent = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
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
1. Verify if the event described in the summary actually occurred on ${date}
2. Check if the summary describes a specific event (not a general trend or analysis)
3. Return "approved: true" if the event happened on that date, "approved: false" otherwise
4. Provide brief reasoning for your decision

Return JSON: {"approved": boolean, "reasoning": string}`;

      const systemPrompt = "You are a fact-checker for historical news events. Be precise and verify that events actually occurred on the specified date.";

      const result = await this.generateJson<{ approved: boolean; reasoning: string }>({
        prompt,
        systemPrompt,
        model: this.defaultModel,
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
}




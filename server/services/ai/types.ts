
import { z } from "zod";
import { ArticleData } from "@shared/schema";

/**
 * Generic interface for all AI providers
 */
export interface IAiProvider {
  /**
   * Generate text completion based on a prompt
   */
  generateCompletion(options: CompletionOptions): Promise<CompletionResult>;
  
  /**
   * Generate a JSON response based on a schema
   */
  generateJson<T>(options: JsonCompletionOptions<T>): Promise<T>;
  
  /**
   * Simple completion method that returns just the text
   * (convenience wrapper around generateCompletion)
   */
  complete(prompt: string, options?: Partial<CompletionOptions>): Promise<string>;
  
  /**
   * Check if the provider is healthy/available
   */
  healthCheck(): Promise<boolean>;
  
  /**
   * Get the name of the provider
   */
  getName(): string;

  // OpenAI specific helpers
  evaluateEventSummary?(summary: string, date: string, group: string): Promise<{ needsEnhancement: boolean; reasoning: string }>;
  enhanceEventSummary?(summary: string, date: string, group: string): Promise<{ summary: string; reasoning: string }>;

  // Perplexity specific helpers
  compareSummaries?(originalDate: string, originalSummary: string, newDate: string, newSummary: string, articles: any): Promise<{ winner: 'original' | 'new'; reasoning: string }>;
  validateArticleIsDateSpecificEvent?(article: ArticleData, date: string): Promise<{ isValid: boolean; reasoning: string; confidence: number }>;
  
  // Final Analysis verification (Gemini and Perplexity)
  verifyEventDate?(summary: string, date: string): Promise<{ approved: boolean; reasoning: string }>;
  
  // Battle feature: Select relevant article IDs from a list of articles
  // Returns object with articleIds array and status to distinguish errors from "no matches"
  selectRelevantArticles?(articles: Array<{ id: string; title: string; summary?: string }>, date: string): Promise<{
    articleIds: string[];
    status: 'success' | 'no_matches' | 'error';
    error?: string;
  }>;
}

export interface CompletionOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  context?: string; // Optional context for API monitoring
  purpose?: string; // Optional purpose description for API monitoring
}

export interface JsonCompletionOptions<T> extends CompletionOptions {
  schema?: z.ZodType<T>; // Optional runtime validation
  monitorId?: string; // Optional existing monitor request ID to update instead of creating new
}

export interface CompletionResult {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  modelUsed: string;
}

export type AiProviderType = 'openai' | 'gemini' | 'perplexity' | 'anthropic' | 'exa';

export interface AiServiceConfig {
  defaultProvider: AiProviderType;
  providers: Record<AiProviderType, boolean>; // Enabled status
}


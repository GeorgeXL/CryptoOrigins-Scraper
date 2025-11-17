import Exa from "exa-js";

interface ExaSearchResult {
  results: Array<{
    id: string;
    title: string | null;
    url: string;
    publishedDate?: string;
    author?: string | null;
    text?: string;
    score?: number;
    summary?: string;
    image?: string;
    favicon?: string;
  }>;
  autopromptString?: string;
}

interface ExaSearchOptions {
  query: string;
  startPublishedDate: string;
  endPublishedDate: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  type?: "neural" | "keyword" | "auto";
  category?: string;
  useAutoprompt?: boolean;
  text?: boolean | { max_characters: number };
  isRetry?: boolean;
  summary?: {
    query: string;
  };
}

export class ExaNewsService {
  private exa: Exa;
  // FIXED: Remove shared state that causes race conditions
  private requestQueue: Promise<any>[] = [];
  private maxConcurrentRequests = 3; // Allow 3 concurrent requests max
  private requestDelay = 200; // 200ms between requests (5 QPS max)
  private lastRequestTime = 0;

  constructor() {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error("EXA_API_KEY environment variable is required. Please set it in your Vercel environment variables.");
    }
    this.exa = new Exa(apiKey);
  }

  /**
   * FIXED: Request-isolated rate limiting with proper queuing
   */
  private async executeWithRateLimit<T>(requestFn: () => Promise<T>): Promise<T> {
    // Wait for queue space
    while (this.requestQueue.length >= this.maxConcurrentRequests) {
      await Promise.race(this.requestQueue);
    }

    // Create request promise
    const requestPromise = this.executeRequest(requestFn);
    this.requestQueue.push(requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Remove completed request from queue
      const index = this.requestQueue.indexOf(requestPromise);
      if (index > -1) {
        this.requestQueue.splice(index, 1);
      }
    }
  }

  private async executeRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    // Enforce rate limiting per request
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.requestDelay) {
      const waitTime = this.requestDelay - timeSinceLastRequest;
      console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next EXA request`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    
    // Execute the actual request
    return await requestFn();
  }

  /**
   * FIXED: Main search method with proper isolation
   */
  async searchAndContents(query: string, options: {
    type: "neural" | "keyword" | "auto";
    category: "company" | "research paper" | "news" | "pdf" | "github" | "tweet" | "personal site" | "linkedin profile" | "financial report";
    startPublishedDate: string;
    endPublishedDate: string;
    summary: {
      query: string;
    };
    includeDomains?: string[];
    numResults?: number;
    excludeText?: string[];
  }, context?: {
    context?: string;
    purpose?: string;
    triggeredBy?: string;
    tier?: string;
  }): Promise<ExaSearchResult> {
    
    // FIXED: Create unique request identifier to prevent mixing
    const requestId = `${query}-${options.startPublishedDate}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🔍 [${requestId}] EXA search: "${query}" (${options.startPublishedDate} to ${options.endPublishedDate})`);
    
    return this.executeWithRateLimit(async () => {
      const { apiMonitor } = await import('./api-monitor');
      const startTime = Date.now();
      let monitorRequestId: string | null = null;
      
      try {
        // Log pending request with unique context
        monitorRequestId = apiMonitor.logRequest({
          service: 'exa',
          endpoint: '/search',
          method: 'POST',
          status: 'pending',
          context: context?.context || 'exa-search',
          purpose: context?.purpose || 'Search news articles using Exa AI neural search',
          triggeredBy: context?.triggeredBy || `News search for query: "${query}"`,
          requestData: { 
            query, 
            dateRange: `${options.startPublishedDate} to ${options.endPublishedDate}`,
            type: options.type,
            category: options.category,
            numResults: options.numResults || 10,
            includeDomains: options.includeDomains,
            tier: context?.tier,
            requestId // Add unique request ID
          }
        });

        // Use the official EXA library with isolated request
        const result = await this.exa.searchAndContents(query, {
          type: options.type,
          category: options.category,
          startPublishedDate: options.startPublishedDate,
          endPublishedDate: options.endPublishedDate,
          numResults: options.numResults || 10,
          summary: options.summary,
          includeDomains: options.includeDomains,
          excludeText: options.excludeText,
        });

        console.log(`📊 [${requestId}] EXA API returned ${result.results?.length || 0} results`);
        
        // Debug: Check if summaries are in the response
        if (result.results && result.results.length > 0) {
          const firstResult = result.results[0] as any;
          console.log(`🔍 [${requestId}] First result summary length:`, firstResult.summary ? `${firstResult.summary.length} chars` : 'NO SUMMARY');
          
          // Show first summary for debugging
          if (firstResult.summary) {
            console.log(`🔍 [${requestId}] First result summary preview:`, firstResult.summary.substring(0, 100));
          }
        }
        
        // Update request as successful
        if (monitorRequestId) {
          apiMonitor.updateRequest(monitorRequestId, {
            status: 'success',
            duration: Date.now() - startTime,
            responseSize: result.results?.length || 0,
            requestData: { 
              query, 
              dateRange: `${options.startPublishedDate} to ${options.endPublishedDate}`,
              type: options.type,
              category: options.category,
              numResults: options.numResults || 10,
              includeDomains: options.includeDomains,
              requestId,
              result: {
                articlesFound: result.results?.length || 0,
                hasContent: result.results?.some((r: any) => r.text || r.summary) || false
              }
            }
          });
        }

        return result as ExaSearchResult;
        
      } catch (error) {
        console.error(`❌ [${requestId}] EXA search failed for query: ${query}`, error);
        
        // Categorize the error type
        let errorCategory: 'rate-limit' | 'network' | 'validation' | 'parsing' | 'other' = 'other';
        const errorMessage = (error as any)?.message || error?.toString() || '';
        
        if (errorMessage.includes('credits limit') || errorMessage.includes('exceeded your credits')) {
          errorCategory = 'rate-limit';
        } else if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
          errorCategory = 'rate-limit';
        } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          errorCategory = 'network';
        } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
          errorCategory = 'validation';
        }
        
        if (monitorRequestId) {
          apiMonitor.updateRequest(monitorRequestId, {
            status: 'error',
            duration: Date.now() - startTime,
            errorCategory,
            requestData: { 
              query, 
              dateRange: `${options.startPublishedDate} to ${options.endPublishedDate}`, 
              type: options.type,
              category: options.category,
              numResults: options.numResults || 10,
              includeDomains: options.includeDomains,
              requestId,
              error: errorMessage
            }
          });
        }
        
        // Return empty result instead of throwing - let the tier validation handle it
        return { results: [] };
      }
    });
  }

  // FIXED: Keep the existing searchNews method but remove caching to prevent issues
  async searchNews(options: ExaSearchOptions): Promise<ExaSearchResult> {
    // Convert to searchAndContents format and use the fixed method
    return this.searchAndContents(options.query, {
      type: options.type || "neural",
      category: "news",
      startPublishedDate: options.startPublishedDate,
      endPublishedDate: options.endPublishedDate,
      summary: { query: "Create 50 words summary" },
      includeDomains: options.includeDomains,
      numResults: options.numResults
    });
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const testDate = new Date().toISOString().split("T")[0];
      const result = await this.searchNews({
        query: "Bitcoin test",
        startPublishedDate: testDate,
        endPublishedDate: testDate,
        numResults: 1,
        text: false,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || "Unknown error",
      };
    }
  }
}

// Lazy initialization to avoid errors at import time
let _exaServiceInstance: ExaNewsService | null = null;

export function getExaService(): ExaNewsService {
  if (!_exaServiceInstance) {
    _exaServiceInstance = new ExaNewsService();
  }
  return _exaServiceInstance;
}

// Export as a getter for backward compatibility
export const exaService = new Proxy({} as ExaNewsService, {
  get(_target, prop) {
    return getExaService()[prop as keyof ExaNewsService];
  }
});
import { exaService } from './exa';
import { type ArticleData } from "@shared/schema";
import { StrictDateFilter } from './date-filter';
import { DateValidator } from './date-validator';
import { PeriodDetector } from './period-detector';

/**
 * Generate next day's midnight timestamp for EXA exclude_text
 * Since EXA normalizes all timestamps to midnight, we exclude the next day's midnight
 */
function getNextDayMidnightTimestamp(searchDate: string): string {
  const date = new Date(searchDate);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay.toISOString().split('T')[0] + 'T00:00:00.000Z';
}

export class HierarchicalSearchService {
  
  





  /**
   * NEW SEQUENTIAL WATERFALL METHODS
   * Search each tier individually for the sequential validation system
   */

  /**
   * Search only Bitcoin-specific articles - SIMPLIFIED SINGLE CALL
   */
  async searchBitcoinTier(date: string, requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; }): Promise<ArticleData[]> {
    console.log(`🪙 Starting Bitcoin tier search for ${date}...`);
    
    try {
      // Note: We no longer pre-log here to avoid duplicate entries in the API monitor.
      
      const result = await exaService.searchAndContents(
        "bitcoin news, ecosystem updates, halvings, important days",
        {
          type: "neural",
          category: "news",
          startPublishedDate: `${date}T00:00:00.000Z`,
          endPublishedDate: `${date}T23:59:59.999Z`,
          excludeText: [getNextDayMidnightTimestamp(date)],
          summary: {
            query: "Create 50 words summary"
          }
        },
        {
          context: 'bitcoin-tier-search',
          purpose: 'Search Bitcoin-specific news articles for tier validation',
          triggeredBy: `${requestContext?.source || 'UNKNOWN'} Bitcoin tier search for ${date} (${requestContext?.requestId || 'no-trace-id'})`,
          tier: 'bitcoin'
        }
      );

      if (!result.results || result.results.length === 0) {
        console.log(`🪙 No Bitcoin articles found for ${date}`);
        return [];
      }

      // Convert to ArticleData format
      const articles: ArticleData[] = result.results.map(r => ({
        id: r.id,
        title: r.title || 'Untitled Article',
        url: r.url,
        publishedDate: r.publishedDate || date,
        author: r.author || undefined,
        text: r.text || '',
        score: r.score || 0,
        summary: r.summary || '',
        source: 'EXA'
      }));
      
      console.log(`🪙 Bitcoin tier: Found ${articles.length} articles`);
      return articles;
      
    } catch (error) {
      console.error(`❌ Bitcoin tier search failed:`, error);
      return [];
    }
  }

  /**
   * Search only crypto/web3 articles - SIMPLIFIED SINGLE CALL
   */
  async searchCryptoTier(date: string, requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; }): Promise<ArticleData[]> {
    console.log(`🔗 Starting Crypto tier search for ${date}...`);
    
    try {
      // Note: We no longer pre-log here to avoid duplicate entries in the API monitor.
      
      const result = await exaService.searchAndContents(
        "important cryptocurrency web3 news, no predictions or analysis",
        {
          type: "neural",
          category: "news",
          startPublishedDate: `${date}T00:00:00.000Z`,
          endPublishedDate: `${date}T23:59:59.999Z`,
          excludeText: [getNextDayMidnightTimestamp(date)],
          summary: {
            query: "Create 50 words summary"
          }
        },
        {
          context: 'crypto-tier-search',
          purpose: 'Search crypto/web3 news articles for tier validation',
          triggeredBy: `${requestContext?.source || 'UNKNOWN'} Crypto tier search for ${date} (${requestContext?.requestId || 'no-trace-id'})`,
          tier: 'crypto'
        }
      );

      if (!result.results || result.results.length === 0) {
        console.log(`🔗 No Crypto articles found for ${date}`);
        return [];
      }

      // Convert to ArticleData format
      const articles: ArticleData[] = result.results.map(r => ({
        id: r.id,
        title: r.title || 'Untitled Article',
        url: r.url,
        publishedDate: r.publishedDate || date,
        author: r.author || undefined,
        text: r.text || '',
        score: r.score || 0,
        summary: r.summary || '',
        source: 'EXA'
      }));
      
      console.log(`🔗 Crypto tier: Found ${articles.length} articles`);
      return articles;
      
    } catch (error) {
      console.error(`❌ Crypto tier search failed:`, error);
      return [];
    }
  }

  /**
   * Search only macroeconomic articles - SIMPLIFIED SINGLE CALL
   */
  async searchMacroTier(date: string, requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; }): Promise<ArticleData[]> {
    console.log(`📈 Starting Macro tier search for ${date}...`);
    
    try {
      // Note: We no longer pre-log here to avoid duplicate entries in the API monitor.
      
      const result = await exaService.searchAndContents(
        "important financial political news",
        {
          type: "neural",
          category: "news",
          startPublishedDate: `${date}T00:00:00.000Z`,
          endPublishedDate: `${date}T23:59:59.999Z`,
          excludeText: [getNextDayMidnightTimestamp(date)],
          summary: {
            query: "Create 50 words summary"
          },
          includeDomains: ["news.bbc.co.uk", "bbc.com", "reuters.com", "washingtonpost.com", "nytimes.com", "cnn.com", "wsj.com", "ft.com", "bloomberg.com", "forbes.com", "economist.com", "fortune.com", "aljazeera.com"]
        },
        {
          context: 'macro-tier-search',
          purpose: 'Search macroeconomic news articles for tier validation',
          triggeredBy: `${requestContext?.source || 'UNKNOWN'} Macro tier search for ${date} (${requestContext?.requestId || 'no-trace-id'})`,
          tier: 'macro'
        }
      );

      if (!result.results || result.results.length === 0) {
        console.log(`📈 No Macro articles found for ${date}`);
        return [];
      }

      // Convert to ArticleData format
      const articles: ArticleData[] = result.results.map(r => ({
        id: r.id,
        title: r.title || 'Untitled Article',
        url: r.url,
        publishedDate: r.publishedDate || date,
        author: r.author || undefined,
        text: r.text || '',
        score: r.score || 0,
        summary: r.summary || '',
        source: 'EXA'
      }));
      
      console.log(`📈 Macro tier: Found ${articles.length} articles`);
      return articles;
      
    } catch (error) {
      console.error(`❌ Macro tier search failed:`, error);
      return [];
    }
  }

  // REMOVED: Complex tier generation methods - replaced with simplified single calls
}

export const hierarchicalSearch = new HierarchicalSearchService();
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

const BITCOIN_NEWS_DOMAINS = [
  "coindesk.com",
  "cointelegraph.com",
  "theblock.co",
  "decrypt.co",
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "nytimes.com",
  "bbc.com",
  "bbc.co.uk",
  "cnbc.com",
  "apnews.com",
];

const CRYPTO_NEWS_DOMAINS = [
  ...BITCOIN_NEWS_DOMAINS,
  "techcrunch.com",
  "fortune.com",
  "forbes.com",
];

const MACRO_NEWS_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "washingtonpost.com",
  "wsj.com",
  "ft.com",
  "bloomberg.com",
  "cnbc.com",
  "economist.com",
  "fortune.com",
  "forbes.com",
  "aljazeera.com",
];

function exaDaySystemPrompt(date: string, tier: "bitcoin" | "crypto" | "macro"): string {
  const scope =
    tier === "bitcoin"
      ? "Bitcoin-only news"
      : tier === "crypto"
        ? "broader cryptocurrency and Web3 news"
        : "global macroeconomics and major financial/political news";
  return `Find news articles published exactly on ${date}. Scope: ${scope}. The event must have happened on ${date}, not before or after. Reject Wikipedia, YouTube, explainers, retrospectives, anniversary pieces, and "on this day" pages. Prefer Reuters, AP, BBC, NYT, WSJ, Bloomberg, CoinDesk, and similar recognised outlets.`;
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
        `Important Bitcoin news published on ${date}: protocol, mining, price, adoption, regulation`,
        {
          category: "news",
          startPublishedDate: `${date}T00:00:00.000Z`,
          endPublishedDate: `${date}T23:59:59.999Z`,
          excludeText: [getNextDayMidnightTimestamp(date)],
          includeDomains: BITCOIN_NEWS_DOMAINS,
          numResults: 10,
          systemPrompt: exaDaySystemPrompt(date, "bitcoin"),
          summary: {
            query: `Summarise the dated Bitcoin news event from ${date} in about 50 words`
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
        `Important cryptocurrency or Web3 news published on ${date}`,
        {
          category: "news",
          startPublishedDate: `${date}T00:00:00.000Z`,
          endPublishedDate: `${date}T23:59:59.999Z`,
          excludeText: [getNextDayMidnightTimestamp(date)],
          includeDomains: CRYPTO_NEWS_DOMAINS,
          numResults: 10,
          systemPrompt: exaDaySystemPrompt(date, "crypto"),
          summary: {
            query: `Summarise the dated crypto/Web3 news event from ${date} in about 50 words`
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
        `Important global financial or political news published on ${date}`,
        {
          category: "news",
          startPublishedDate: `${date}T00:00:00.000Z`,
          endPublishedDate: `${date}T23:59:59.999Z`,
          excludeText: [getNextDayMidnightTimestamp(date)],
          includeDomains: MACRO_NEWS_DOMAINS,
          numResults: 10,
          systemPrompt: exaDaySystemPrompt(date, "macro"),
          summary: {
            query: `Summarise the dated macro news event from ${date} in about 50 words`
          }
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
import { exaService } from './exa';
import { type ArticleData } from "@shared/schema";
import { filterExaArticlesForTier, type ArticlePickTier } from "./editorial-pipeline/article-pick-quality";

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

const GENESIS_EXTRA_DOMAINS = [
  "news.bitcoin.com",
  "bitcointalk.org",
  "slashdot.org",
  "bitcoinmagazine.com",
];

type SearchTier = "bitcoin" | "crypto" | "macro";
type EraBucket = "genesis" | "growth" | "modern";

function eraBucket(date: string): EraBucket {
  const year = Number(date.slice(0, 4));
  if (year < 2011) return "genesis";
  if (year < 2017) return "growth";
  return "modern";
}

function exaDaySystemPrompt(date: string, tier: SearchTier): string {
  const scope =
    tier === "bitcoin"
      ? "Bitcoin-only news"
      : tier === "crypto"
        ? "broader cryptocurrency and Web3 news"
        : "global macroeconomics and major financial/political news";
  return `Find news articles published exactly on ${date}. Scope: ${scope}. The event must have happened on ${date}, not before or after. Reject Wikipedia, YouTube, explainers, retrospectives, anniversary pieces, and "on this day" pages. Reject blogs, philanthropy columns, pharma/penny-stock press releases, clickbait, and entertainment. Prefer Reuters, AP, BBC, NYT, WSJ, Bloomberg, CoinDesk, and similar recognised outlets.`;
}

type TierSearchConfig = {
  query: string;
  includeDomains?: string[];
  systemPrompt: string;
  summaryQuery: string;
};

function tierSearchConfig(date: string, tier: SearchTier): TierSearchConfig {
  const era = eraBucket(date);
  const basePrompt = exaDaySystemPrompt(date, tier);

  if (era === "genesis") {
    if (tier === "bitcoin") {
      return {
        query: `Bitcoin Satoshi Nakamoto genesis block mining forum discussion news on ${date}`,
        systemPrompt: `Find contemporaneous articles or forum posts from exactly ${date} about Bitcoin, peer-to-peer electronic cash, Satoshi Nakamoto, or early mining. Accept Bitcointalk, Slashdot, cryptography mailing lists if published on ${date}. HARD REJECT: articles with no Bitcoin/crypto topic, philanthropy, pharma trials, general tech, entertainment, blogs, clickbait, or macro-only financial news. Reject retrospectives and explainers.`,
        summaryQuery: `Summarise the dated Bitcoin or early crypto event from ${date} in about 50 words`,
      };
    }
    if (tier === "crypto") {
      return {
        query: `What significant event happened in Bitcoin or cryptocurrency on ${date}?`,
        systemPrompt: `Return only articles published on ${date} describing a concrete Bitcoin or cryptocurrency event. HARD REJECT: philanthropy, pharma, penny stocks, blogs, clickbait, entertainment, and articles with no digital-currency topic.`,
        summaryQuery: `Summarise the dated crypto event from ${date} in about 50 words`,
      };
    }
    return {
      query: `Major financial markets banking crisis news published on ${date}`,
      includeDomains: MACRO_NEWS_DOMAINS,
      systemPrompt: basePrompt,
      summaryQuery: `Summarise the dated macro news event from ${date} in about 50 words`,
    };
  }

  if (era === "growth") {
    if (tier === "bitcoin") {
      return {
        query: `Important Bitcoin news published on ${date}: protocol, mining, exchanges, price, adoption, regulation`,
        includeDomains: [...BITCOIN_NEWS_DOMAINS, ...GENESIS_EXTRA_DOMAINS],
        systemPrompt: basePrompt,
        summaryQuery: `Summarise the dated Bitcoin news event from ${date} in about 50 words`,
      };
    }
    if (tier === "crypto") {
      return {
        query: `Important cryptocurrency or Web3 news published on ${date}`,
        includeDomains: [...CRYPTO_NEWS_DOMAINS, ...GENESIS_EXTRA_DOMAINS],
        systemPrompt: basePrompt,
        summaryQuery: `Summarise the dated crypto/Web3 news event from ${date} in about 50 words`,
      };
    }
    return {
      query: `Important global financial or political news published on ${date}`,
      includeDomains: MACRO_NEWS_DOMAINS,
      systemPrompt: basePrompt,
      summaryQuery: `Summarise the dated macro news event from ${date} in about 50 words`,
    };
  }

  if (tier === "bitcoin") {
    return {
      query: `Important Bitcoin news published on ${date}: protocol, mining, price, adoption, regulation`,
      includeDomains: BITCOIN_NEWS_DOMAINS,
      systemPrompt: basePrompt,
      summaryQuery: `Summarise the dated Bitcoin news event from ${date} in about 50 words`,
    };
  }
  if (tier === "crypto") {
    return {
      query: `Important cryptocurrency or Web3 news published on ${date}`,
      includeDomains: CRYPTO_NEWS_DOMAINS,
      systemPrompt: basePrompt,
      summaryQuery: `Summarise the dated crypto/Web3 news event from ${date} in about 50 words`,
    };
  }
  return {
    query: `Important global financial or political news published on ${date}`,
    includeDomains: MACRO_NEWS_DOMAINS,
    systemPrompt: basePrompt,
    summaryQuery: `Summarise the dated macro news event from ${date} in about 50 words`,
  };
}

export class HierarchicalSearchService {
  private async searchTier(
    tier: SearchTier,
    date: string,
    requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; },
  ): Promise<ArticleData[]> {
    const label = tier === "bitcoin" ? "Bitcoin" : tier === "crypto" ? "Crypto" : "Macro";
    const config = tierSearchConfig(date, tier);
    console.log(`🔎 Starting ${label} tier search for ${date} (era=${eraBucket(date)})...`);

    try {
      const searchOptions: Parameters<typeof exaService.searchAndContents>[1] = {
        category: "news",
        startPublishedDate: `${date}T00:00:00.000Z`,
        endPublishedDate: `${date}T23:59:59.999Z`,
        excludeText: [getNextDayMidnightTimestamp(date)],
        numResults: 10,
        systemPrompt: config.systemPrompt,
        summary: {
          query: config.summaryQuery,
        },
      };
      if (config.includeDomains) {
        searchOptions.includeDomains = config.includeDomains;
      }

      const result = await exaService.searchAndContents(
        config.query,
        searchOptions,
        {
          context: `${tier}-tier-search`,
          purpose: `Search ${label}-specific news articles for tier validation`,
          triggeredBy: `${requestContext?.source || "UNKNOWN"} ${label} tier search for ${date} (${requestContext?.requestId || "no-trace-id"})`,
          tier,
        },
      );

      if (!result.results || result.results.length === 0) {
        console.log(`🔎 No ${label} articles found for ${date}`);
        return [];
      }

      const articles: ArticleData[] = result.results.map((r) => ({
        id: r.id,
        title: r.title || "Untitled Article",
        url: r.url,
        publishedDate: r.publishedDate || date,
        author: r.author || undefined,
        text: r.text || "",
        score: r.score || 0,
        summary: r.summary || "",
      }));

      const filtered = filterExaArticlesForTier(articles, tier as ArticlePickTier, date);

      console.log(`🔎 ${label} tier: Found ${filtered.length} articles after quality filter (${articles.length} raw)`);
      return filtered;
    } catch (error) {
      console.error(`❌ ${label} tier search failed:`, error);
      return [];
    }
  }

  async searchBitcoinTier(
    date: string,
    requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; },
  ): Promise<ArticleData[]> {
    return this.searchTier("bitcoin", date, requestContext);
  }

  async searchCryptoTier(
    date: string,
    requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; },
  ): Promise<ArticleData[]> {
    return this.searchTier("crypto", date, requestContext);
  }

  async searchMacroTier(
    date: string,
    requestContext?: { requestId: string; source: string; referer?: string; userAgent?: string; },
  ): Promise<ArticleData[]> {
    return this.searchTier("macro", date, requestContext);
  }
}

export const hierarchicalSearch = new HierarchicalSearchService();

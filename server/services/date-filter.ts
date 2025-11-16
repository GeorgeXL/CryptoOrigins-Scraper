// Strict date filtering and tier 1 outlet prioritization
import { format, parseISO, isSameDay } from 'date-fns';

interface TierConfig {
  tier: number;
  domains: string[];
  priority: number;
}

// Tier 1: Major financial and technology outlets
const TIER_1_OUTLETS = [
  'bloomberg.com',
  'reuters.com', 
  'wsj.com',
  'ft.com',
  'cnbc.com',
  'cnn.com',
  'bbc.com',
  'techcrunch.com',
  'theverge.com',
  'arstechnica.com',
  'coindesk.com',
  'cointelegraph.com',
  'theworld.org' // PRX - Public Radio Exchange, legitimate news source
];

// Tier 2: Specialized crypto outlets
const TIER_2_OUTLETS = [
  'decrypt.co',
  'theblock.co',
  'bitcoinmagazine.com',
  'coinbase.com',
  'kraken.com',
  'binance.com'
];

// Tier 3: General tech and news
const TIER_3_OUTLETS = [
  'medium.com',
  'forbes.com',
  'businessinsider.com',
  'marketwatch.com',
  'yahoo.com'
];

export class StrictDateFilter {
  
  /**
   * Apply strict date filtering - only exact day matches
   */
  static filterByExactDate(articles: any[], targetDate: string): any[] {
    const target = parseISO(targetDate);
    
    return articles.filter(article => {
      if (!article.publishedDate) return false;
      
      // Check for date range indicators in title/content
      if (this.hasDateRangeIndicators(article)) {
        console.log(`⚠️ Filtering out article with date range: ${article.title}`);
        return false;
      }
      
      try {
        const published = parseISO(article.publishedDate);
        return isSameDay(published, target);
      } catch (error) {
        console.warn(`Invalid date format for article: ${article.publishedDate}`);
        return false;
      }
    });
  }

  /**
   * Detect articles with date ranges (newsletters, weekly summaries, etc.)
   */
  static hasDateRangeIndicators(article: any): boolean {
    const text = `${article.title || ''} ${article.text || ''}`.toLowerCase();
    
    // Date range patterns that indicate multi-day coverage
    const dateRangePatterns = [
      // "Week of", "Weekly", "This week" - keep this filter
      /\b(week\s+of|weekly|this\s+week|last\s+week|next\s+week)/i,
      // Only filter obvious newsletters/digests
      /\b(newsletter|digest|weekly\s+roundup|weekly\s+wrap[\-\s]?up|weekly\s+recap)/i,
      // Clear date ranges like "May 15-21" (but be more specific)
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}[\-–—]\d{1,2}(?!\s*,?\s*\d{4})\b/i,
    ];
    
    for (let i = 0; i < dateRangePatterns.length; i++) {
      const pattern = dateRangePatterns[i];
      if (pattern.test(text)) {
        console.log(`🗓️ Date range detected in: "${article.title}" (pattern ${i + 1})`);
        console.log(`   Pattern: ${pattern}`);
        console.log(`   Text: "${text}"`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get outlet tier based on domain
   */
  static getOutletTier(url: string): number {
    const domain = this.extractDomain(url);
    
    if (TIER_1_OUTLETS.some(tier1 => domain.includes(tier1))) return 1;
    if (TIER_2_OUTLETS.some(tier2 => domain.includes(tier2))) return 2;
    if (TIER_3_OUTLETS.some(tier3 => domain.includes(tier3))) return 3;
    
    return 4; // Unknown/low-tier outlet
  }

  /**
   * Prioritize articles by outlet tier and exact date match
   */
  static prioritizeByTierAndDate(articles: any[], targetDate: string): any[] {
    // First: strict date filtering
    const exactDateArticles = this.filterByExactDate(articles, targetDate);
    
    if (exactDateArticles.length === 0) {
      console.log(`⚠️ No articles found for exact date ${targetDate}, using original results`);
      return articles;
    }

    console.log(`✅ Found ${exactDateArticles.length} articles for exact date ${targetDate}`);

    // Second: sort by tier priority
    const sortedByTier = exactDateArticles.sort((a, b) => {
      const tierA = this.getOutletTier(a.url);
      const tierB = this.getOutletTier(b.url);
      
      // Lower tier number = higher priority
      if (tierA !== tierB) {
        return tierA - tierB;
      }
      
      // Same tier: sort by score
      return (b.score || 0) - (a.score || 0);
    });

    // Log tier distribution
    const tierCounts = this.analyzeTierDistribution(sortedByTier);
    console.log(`📊 Tier distribution:`, tierCounts);

    return sortedByTier;
  }

  /**
   * Extract domain from URL
   */
  private static extractDomain(url: string): string {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      return domain.startsWith('www.') ? domain.slice(4) : domain;
    } catch {
      return url.toLowerCase();
    }
  }

  /**
   * Analyze tier distribution for logging
   */
  private static analyzeTierDistribution(articles: any[]): Record<string, number> {
    const counts = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
    
    articles.forEach(article => {
      const tier = this.getOutletTier(article.url);
      switch (tier) {
        case 1: counts.tier1++; break;
        case 2: counts.tier2++; break;
        case 3: counts.tier3++; break;
        default: counts.tier4++; break;
      }
    });

    return counts;
  }

  /**
   * Get tier 1 outlets only from articles
   */
  static getTier1Only(articles: any[]): any[] {
    return articles.filter(article => this.getOutletTier(article.url) === 1);
  }

  /**
   * Enhanced filtering with strict date + tier priority
   */
  static applyStrictFiltering(articles: any[], targetDate: string, maxResults: number = 10): any[] {
    console.log(`🔍 Applying strict filtering for ${targetDate} (${articles.length} input articles)`);
    
    // Step 1: Remove articles with date ranges (newsletters, weekly summaries)
    const singleDayArticles = articles.filter(article => !this.hasDateRangeIndicators(article));
    console.log(`📰 After removing date ranges: ${singleDayArticles.length} articles`);
    
    // Step 2: Exact date filtering
    const exactDateArticles = this.filterByExactDate(singleDayArticles, targetDate);
    console.log(`📅 Exact date matches: ${exactDateArticles.length}`);
    
    // Step 3: If we have exact matches, use them
    if (exactDateArticles.length > 0) {
      const prioritized = this.prioritizeByTierAndDate(exactDateArticles, targetDate);
      
      // Prefer tier 1 if available
      const tier1Articles = this.getTier1Only(prioritized);
      if (tier1Articles.length >= 3) {
        console.log(`🎯 Using ${tier1Articles.length} tier 1 articles`);
        return tier1Articles.slice(0, maxResults);
      }

      console.log(`📊 Using mixed tiers: ${prioritized.length} total articles`);
      return prioritized.slice(0, maxResults);
    }
    
    // Step 4: If no exact matches, try less strict filtering
    // First, try original articles with looser date matching (±1 day)
    const targetDateObj = new Date(targetDate);
    const dayBefore = new Date(targetDateObj.getTime() - 24 * 60 * 60 * 1000);
    const dayAfter = new Date(targetDateObj.getTime() + 24 * 60 * 60 * 1000);
    
    const nearbyDateArticles = singleDayArticles.filter(article => {
      if (!article.publishedDate) return false;
      try {
        const published = new Date(article.publishedDate);
        return published >= dayBefore && published <= dayAfter;
      } catch {
        return false;
      }
    });
    
    if (nearbyDateArticles.length > 0) {
      console.log(`📅 Using ${nearbyDateArticles.length} articles from nearby dates (±1 day)`);
      return this.prioritizeByTierAndDate(nearbyDateArticles, targetDate).slice(0, maxResults);
    }
    
    // Step 5: Final fallback - if still no results, return empty array
    console.log(`⚠️ No suitable articles found for ${targetDate} after strict filtering`);
    return [];
  }
}
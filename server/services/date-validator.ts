/**
 * Date validation and filtering service to prevent invalid or suspicious articles
 */

export class DateValidator {
  /**
   * Validates if a date is reasonable for news article search
   */
  static isValidSearchDate(dateString: string): boolean {
    try {
      const searchDate = new Date(dateString);
      const currentDate = new Date();
      const bitcoinStartDate = new Date('2008-10-31'); // Bitcoin announcement
      
      // Must be after Bitcoin announcement and not too far in the future
      const maxFutureDate = new Date();
      maxFutureDate.setDate(currentDate.getDate() + 7); // Allow up to 7 days in future
      
      return searchDate >= bitcoinStartDate && searchDate <= maxFutureDate;
    } catch {
      return false;
    }
  }

  /**
   * Validates if an article's publication date is realistic
   */
  static isValidArticleDate(publishedDate: string, searchDate: string): boolean {
    try {
      const articleDate = new Date(publishedDate);
      const targetDate = new Date(searchDate);
      const currentDate = new Date();
      
      // Article can't be from the future beyond current date
      if (articleDate > currentDate) {
        console.log(`⚠️ Filtering future-dated article: ${publishedDate} > ${currentDate.toISOString()}`);
        return false;
      }
      
      // Article should be within reasonable range of search date (±30 days max)
      const daysDiff = Math.abs((articleDate.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 30) {
        console.log(`⚠️ Filtering article too far from search date: ${daysDiff} days difference`);
        return false;
      }
      
      return true;
    } catch {
      console.log(`⚠️ Invalid date format in article: ${publishedDate}`);
      return false;
    }
  }

  /**
   * Filters articles to remove those with suspicious or invalid dates
   */
  static filterArticlesByDate(articles: any[], searchDate: string): any[] {
    return articles.filter(article => {
      if (!article.publishedDate) {
        console.log(`⚠️ Filtering article without publication date: ${article.title?.substring(0, 50)}...`);
        return false;
      }
      
      return this.isValidArticleDate(article.publishedDate, searchDate);
    });
  }

  /**
   * Checks if an article is actually related to Bitcoin/cryptocurrency
   */
  static isBitcoinRelevant(article: any): boolean {
    const title = article.title?.toLowerCase() || '';
    const text = article.text?.toLowerCase() || '';
    const url = article.url?.toLowerCase() || '';
    const content = `${title} ${text} ${url}`;
    
    // Bitcoin/crypto keywords
    const bitcoinKeywords = [
      'bitcoin', 'btc', 'cryptocurrency', 'crypto', 'blockchain', 'satoshi',
      'mining', 'hash', 'wallet', 'exchange', 'coinbase', 'binance',
      'digital currency', 'digital money', 'peer-to-peer', 'decentralized',
      'ledger', 'transaction', 'block', 'node', 'protocol', 'halving',
      'ethereum', 'eth', 'altcoin', 'defi', 'nft', 'web3', 'dapp',
      'stablecoin', 'usdt', 'usdc', 'tether', 'fiat', 'cbdc'
    ];
    
    const hasRelevantKeywords = bitcoinKeywords.some(keyword => 
      content.includes(keyword)
    );
    
    if (!hasRelevantKeywords) {
      console.log(`⚠️ Filtering non-Bitcoin article: "${title.substring(0, 60)}..."`);
      return false;
    }
    
    return true;
  }

  /**
   * Checks if an article appears to be from a content farm or spam source
   */
  static isLowQualitySource(article: any): boolean {
    const title = article.title?.toLowerCase() || '';
    const url = article.url?.toLowerCase() || '';
    
    // Suspicious patterns in titles
    const suspiciousPatterns = [
      /^-\s*youtube$/i, // Just "- YouTube"
      /^\s*$/, // Empty or whitespace-only titles
      /click here/i,
      /you won't believe/i,
      /shocking/i,
      /this one weird trick/i,
    ];
    
    // Suspicious URL patterns
    const suspiciousUrls = [
      /\/watch\?v=.*$/i, // YouTube videos without proper titles
      /spam|fake|scam/i,
      /\.blogspot\.|\.wordpress\./i // Generic blog platforms (often used for spam)
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(title)) {
        console.log(`⚠️ Filtering low-quality title: "${title}"`);
        return true;
      }
    }
    
    for (const pattern of suspiciousUrls) {
      if (pattern.test(url)) {
        console.log(`⚠️ Filtering suspicious URL: ${url}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Comprehensive filtering of articles for quality and date validity
   */
  static filterArticles(articles: any[], searchDate: string): any[] {
    console.log(`🔍 Validating ${articles.length} articles for date: ${searchDate}`);
    
    // First filter by date validity
    const dateValidArticles = this.filterArticlesByDate(articles, searchDate);
    console.log(`📅 After date validation: ${dateValidArticles.length} articles`);
    
    // Then filter by content quality
    const qualityArticles = dateValidArticles.filter(article => !this.isLowQualitySource(article));
    console.log(`✅ After quality filtering: ${qualityArticles.length} articles`);
    
    // Finally filter for Bitcoin relevance, but allow fallback if no Bitcoin articles found
    const bitcoinRelevantArticles = qualityArticles.filter(article => this.isBitcoinRelevant(article));
    console.log(`🪙 After Bitcoin relevance filtering: ${bitcoinRelevantArticles.length} articles`);
    
    // If no Bitcoin-relevant articles found, allow quality financial/tech articles as fallback
    if (bitcoinRelevantArticles.length === 0 && qualityArticles.length > 0) {
      const fallbackArticles = qualityArticles.filter(article => this.isFinanciallyRelevant(article));
      if (fallbackArticles.length > 0) {
        console.log(`🏦 Using ${fallbackArticles.length} financial fallback articles`);
        return fallbackArticles;
      }
    }
    
    return bitcoinRelevantArticles;
  }

  /**
   * Checks if an article is financially relevant as fallback when no Bitcoin content exists
   */
  static isFinanciallyRelevant(article: any): boolean {
    const title = article.title?.toLowerCase() || '';
    const text = article.text?.toLowerCase() || '';
    const url = article.url?.toLowerCase() || '';
    const content = `${title} ${text} ${url}`;
    
    // Financial/economic keywords for fallback
    const financialKeywords = [
      'market', 'economy', 'financial', 'investment', 'currency', 'money',
      'trading', 'stock', 'nasdaq', 'dow', 'index', 'finance', 'economic',
      'federal reserve', 'interest rate', 'inflation', 'treasury', 'bond',
      'dollar', 'euro', 'yen', 'gold', 'commodity', 'asset', 'portfolio'
    ];
    
    return financialKeywords.some(keyword => content.includes(keyword));
  }
}
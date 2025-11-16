/**
 * Cache Manager for Bitcoin News Analysis System
 * Provides in-memory caching with TTL support for API responses
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly DEFAULT_TTL = 3600000; // 1 hour in milliseconds
  
  // Different TTLs for different types of data
  private readonly TTL_CONFIG = {
    newsSearch: 3600000,      // 1 hour for news searches
    aiAnalysis: 86400000,     // 24 hours for AI analysis
    historicalEvent: 604800000, // 7 days for historical events
    apiHealth: 300000         // 5 minutes for API health checks
  };

  /**
   * Get cached data if it exists and is not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  /**
   * Set data in cache with optional TTL
   */
  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.DEFAULT_TTL
    });
  }

  /**
   * Cache news search results
   */
  cacheNewsSearch(date: string, source: string, results: any): void {
    const key = `news:${source}:${date}`;
    this.set(key, results, this.TTL_CONFIG.newsSearch);
  }

  /**
   * Get cached news search results
   */
  getCachedNewsSearch(date: string, source: string): any | null {
    const key = `news:${source}:${date}`;
    return this.get(key);
  }

  /**
   * Cache AI analysis results
   */
  cacheAIAnalysis(date: string, analysis: any): void {
    const key = `analysis:${date}`;
    this.set(key, analysis, this.TTL_CONFIG.aiAnalysis);
  }

  /**
   * Get cached AI analysis
   */
  getCachedAIAnalysis(date: string): any | null {
    const key = `analysis:${date}`;
    return this.get(key);
  }

  /**
   * Cache historical event data
   */
  cacheHistoricalEvent(date: string, event: any): void {
    const key = `history:${date}`;
    this.set(key, event, this.TTL_CONFIG.historicalEvent);
  }

  /**
   * Get cached historical event
   */
  getCachedHistoricalEvent(date: string): any | null {
    const key = `history:${date}`;
    return this.get(key);
  }

  /**
   * Clear specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries for a specific date
   */
  invalidateDate(date: string): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(date)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    entries: { key: string; age: number; ttl: number }[];
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: now - entry.timestamp,
      ttl: entry.ttl
    }));
    
    return {
      size: this.cache.size,
      entries
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }
}

// Singleton instance
export const cacheManager = new CacheManager();

// Run cleanup every 5 minutes
setInterval(() => {
  cacheManager.cleanup();
}, 300000);
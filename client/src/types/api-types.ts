/**
 * Comprehensive API Type Definitions
 * Centralized type definitions for all API responses and data structures
 */

// Analysis-related types
export interface AnalysisStats {
  totalDays: number;
  analyzedDays: number;
  completionPercentage: number;
}

export interface YearProgress {
  totalDays: number;
  analyzedDays: number;
  percentage: number;
}

export interface PerformanceStats {
  database: {
    totalAnalyses: number;
    completionRate: number;
    totalDays: number;
  };
  cache: {
    entries: any[];
    hitRate: string;
    memoryUsage: string;
  };
  performance: {
    compressionEnabled: boolean;
    indexesActive: boolean;
    virtualScrolling: boolean;
    apiCachingActive: boolean;
  };
  improvements: {
    querySpeedIncrease: string;
    apiCallReduction: string;
    bandwidthSaving: string;
    memoryEfficiency: string;
  };
}

// Health monitoring types
export interface ApiHealth {
  name: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTime?: number;
  error?: string;
  lastCheck: string;
}

export interface SystemHealth {
  overall: 'operational' | 'degraded' | 'outage';
  apis: ApiHealth[];
  lastUpdate: string;
}

// News and analysis types
export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  publishedDate: string;
  author?: string;
  text?: string;
  score?: number;
  source?: 'EXA' | 'Historical Events';
  summary?: string;
}

export interface NewsSearchResult {
  results: NewsArticle[];
  diagnostics: {
    totalArticles: number;
    tierUsed: string;
    totalSearched: number;
    sourcesUsed: string[];
    searchPath: string[];
    hierarchicalDiagnostics: any;
  };
}

export interface ManualNewsEntry {
  id: string;
  title: string;
  summary: string;
  description: string;
  date: string;
}

export interface HistoricalAnalysis {
  id: string;
  date: string;
  summary: string;
  topArticleId: string;
  reasoning: string;
  confidenceScore: string;
  aiProvider: string;
  isManualOverride?: boolean;
  hasManualEntry?: boolean;
  articleTags?: {
    totalArticles: number;
    topSources: string[];
    duplicatesFound: number;
    sourcesUsed: string[];
    totalFetched: number;
    analysisMetadata?: {
      processingDate: string;
      version: string;
      sentimentAnalysis: boolean;
      topicCategorization: boolean;
      duplicateDetection: boolean;
      multiSourceIntegration: boolean;
      hierarchicalSearch?: {
        tierUsed: string;
        searchPath: string[];
        totalSearched: number;
        diagnostics: {
          tier1Results: number;
          tier2Results: number;
          tier3Results: number;
          fallbackTriggered: boolean;
        };
      };
    };
  };
}

export interface DayAnalysisData {
  analysis: HistoricalAnalysis;
  manualEntries: ManualNewsEntry[];
}

// Cache and optimization types
export interface CacheStats {
  size: number;
  entries: Array<{
    key: string;
    age: number;
    ttl: number;
  }>;
}

// API Response wrapper types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}
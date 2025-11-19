import { Router } from "express";

import { storage } from "../storage";
import { newsAnalyzer } from "../services/news-analyzer";
import { exaService } from "../services/exa";
import { type ArticleData } from "@shared/schema";
import { periodDetector } from "../services/period-detector";
import { hierarchicalSearch } from "../services/hierarchical-search";
import { insertHistoricalNewsAnalysisSchema, insertManualNewsEntrySchema, insertEventBatchSchema, insertBatchEventSchema, type InsertHistoricalNewsAnalysis, type HistoricalNewsAnalysis, type EventBatch, type BatchEvent } from "@shared/schema";

import { cacheManager } from "../services/cache-manager";

import { healthMonitor } from "../services/health-monitor";
import { createErrorResponse } from "../utils/error-handler";
import { apiMonitor } from "../services/api-monitor";
import { qualityChecker } from "../services/quality-checker";
import { batchProcessor } from "../services/batch-processor";
import { conflictClusterer } from "../services/conflict-clusterer";
import { perplexityCleaner } from "../services/perplexity-cleaner";
import { entityExtractor } from "../services/entity-extractor";
import { sql } from "drizzle-orm";
import { aiService } from "../services/ai";

// Utility function to parse date strings from Perplexity
// Note: All 1,025 existing Perplexity dates are already in YYYY-MM-DD format
function parsePerplexityDate(dateText: string | null): string | null {
  // Handle null/undefined input
  if (!dateText) {
    return null;
  }

  // Case 1: Already in YYYY-MM-DD format (99.9% of cases)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return dateText;
  }

  // Case 2: Try to extract YYYY-MM-DD from string
  const isoMatch = dateText.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // If all else fails, return null
  console.log(`⚠️ Could not parse date from: "${dateText}"`);
  return null;
}

// Global state to control fact-checking process
let shouldStopFactCheck = false;
let isFactCheckRunning = false;
let factCheckProcessed = 0;

// Global state to control batch tagging process
let shouldStopBatchTagging = false;
let isBatchTaggingRunning = false;
let batchTaggingProcessed = 0;
let batchTaggingTotal = 0;

const router = Router();

router.get("/api/news/search", async (req, res) => {
  try {
    const { query, date, source } = req.query;
    
    if (!query || !date) {
      return res.status(400).json({ error: "Query and date are required" });
    }
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }
    
    // OPTIMIZED: Use lightweight Bitcoin-only search to avoid excessive API calls
    const bitcoinArticles = await hierarchicalSearch.searchBitcoinTier(date as string);
    
    // Add source attribution to results
    const articlesWithSource = bitcoinArticles.map((article: ArticleData) => {
      return {
        ...article,
        source: source || 'EXA'
      };
    });
    
    // Return results with source attribution and diagnostics
    res.json({
      results: articlesWithSource,
      diagnostics: {
        totalArticles: bitcoinArticles.length,
        tierUsed: 'bitcoin',
        totalSearched: bitcoinArticles.length,
        sourcesUsed: ['EXA'],
        searchPath: ['bitcoin'],
        hierarchicalDiagnostics: {
          tier1Results: bitcoinArticles.length,
          tier2Results: 0,
          tier3Results: 0,
          fallbackTriggered: false
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;

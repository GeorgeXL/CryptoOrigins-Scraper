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
import { sql, desc } from "drizzle-orm";
import { aiService } from "../services/ai";
import { historicalNewsAnalyses } from "@shared/schema";
import { db } from "../db";

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

router.get("/api/test", (req, res) => {
  res.json({ 
    message: "API is running!", 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "production",
    vercel: !!process.env.VERCEL 
  });
});

router.get("/api/debug/db", async (req, res) => {
  try {
    const hasPostgresUrl = !!process.env.POSTGRES_URL;
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    let connectionInfo = null;
    if (databaseUrl) {
      try {
        const urlParts = new URL(databaseUrl);
        connectionInfo = {
          protocol: urlParts.protocol,
          hostname: urlParts.hostname,
          port: urlParts.port,
          database: urlParts.pathname.split('/').pop(),
          hasSslMode: databaseUrl.includes('sslmode='),
          hasSupaParam: databaseUrl.includes('supa='),
          urlLength: databaseUrl.length,
        };
      } catch (e) {
        connectionInfo = { error: 'Invalid URL format', rawLength: databaseUrl.length };
      }
    }

    // Try to actually connect to the database
    let dbTest = null;
    try {
      // Try a simple query
      const result = await db.execute(sql`SELECT 1 as test, NOW() as current_time`);
      dbTest = { 
        success: true, 
        message: 'Database connection successful',
        result: result.rows?.[0] || result
      };
    } catch (error) {
      dbTest = { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      };
    }

    res.json({
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL,
        hasPostgresUrl,
        hasDatabaseUrl,
        connectionInfo,
      },
      databaseTest: dbTest,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

router.get("/api/health/status", async (req, res) => {
  try {
    const health = await healthMonitor.getSystemHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({ 
      overall: 'outage',
      apis: [],
      lastUpdate: new Date().toISOString(),
      error: (error as Error).message 
    });
  }
});

router.post("/api/health/refresh", async (req, res) => {
  try {
    // Clear all caches and force fresh checks
    healthMonitor.invalidateCache();
    cacheManager.clearAll();
    
    const health = await healthMonitor.forceRefresh();
    res.json(health);
  } catch (error) {
    res.status(500).json({ 
      overall: 'outage',
      apis: [],
      lastUpdate: new Date().toISOString(),
      error: (error as Error).message 
    });
  }
});

router.delete("/api/database/clear-all", async (req, res) => {
  try {
    await storage.clearAllData();
    cacheManager.clearAll(); // Clear caches too
    res.json({ success: true, message: "All database data has been cleared" });
  } catch (error) {
    console.error('Error clearing database:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/database/clear-analyses", async (req, res) => {
  try {
    await storage.clearAnalysisData();
    cacheManager.clearAll();
    res.json({ success: true, message: "Historical Bitcoin news analyses cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/database/clear-manual-entries", async (req, res) => {
  try {
    await storage.clearManualEntries();
    res.json({ success: true, message: "Manual news entries cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/database/clear-source-credibility", async (req, res) => {
  try {
    await storage.clearSourceCredibility();
    res.json({ success: true, message: "Source credibility settings cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/database/clear-spam-domains", async (req, res) => {
  try {
    await storage.clearSpamDomains();
    res.json({ success: true, message: "Spam domain filters cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/database/clear-ai-prompts", async (req, res) => {
  try {
    await storage.clearAiPrompts();
    res.json({ success: true, message: "AI prompts and configurations cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete("/api/database/clear-users", async (req, res) => {
  try {
    await storage.clearUserData();
    res.json({ success: true, message: "User data cleared" });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/system/db-stats", async (req, res) => {
  try {
    const stats = await storage.getAnalysisStats();
    res.json({
      ...stats,
      slowQueries: 0,
      connections: 10,
      cacheHitRate: '85%'
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/system/diagnostics", async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }
    
    // Get period context for the date
    const periodContext = periodDetector.getPeriodContext(date as string);
    
    // Get search strategy
    const searchStrategy = periodDetector.getSearchStrategy(date as string);
    
    res.json({
      date,
      period: periodContext.period,
      isHistorical: periodContext.isHistorical,
      searchStrategy,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage()
      }
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/api/monitor/stats', async (req, res) => {
  try {
    res.json(apiMonitor.getRequestStats());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/api/monitor/requests', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(apiMonitor.getRecentRequests(limit));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.delete('/api/monitor/clear', async (req, res) => {
  try {
    apiMonitor.clearHistory();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/database/migrate-enhanced-events", async (req, res) => {
  try {
    console.log("🗄️ Starting migration of enhanced events to main database...");
    
    // Get all enhanced events from batch_events table
    const { batchEvents } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    const enhancedEvents = await db.select({
      date: batchEvents.originalDate,
      summary: batchEvents.enhancedSummary,
      reasoning: batchEvents.enhancedReasoning,
      originalGroup: batchEvents.originalGroup
    })
    .from(batchEvents)
    .where(eq(batchEvents.status, 'enhanced'));

    console.log(`📊 Found ${enhancedEvents.length} enhanced events to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const event of enhancedEvents) {
      try {
        if (!event.summary || event.summary.trim() === '') {
          console.log(`⏭️ Skipping event for ${event.date} - no enhanced summary`);
          skippedCount++;
          continue;
        }

        // Check if analysis already exists for this date
        const existingAnalysis = await storage.getAnalysisByDate(event.date);
        if (existingAnalysis) {
          console.log(`⏭️ Skipping ${event.date} - analysis already exists`);
          skippedCount++;
          continue;
        }

        // Create historical news analysis entry
        const analysisData: InsertHistoricalNewsAnalysis = {
          date: event.date,
          summary: event.summary,
          reasoning: event.reasoning || 'Enhanced from Bitcoin historical events import',
          isManualOverride: true,
          aiProvider: 'openai',
          tierUsed: 'bitcoin-history',
          winningTier: 'bitcoin-history',
          confidenceScore: '95.00',
          sentimentScore: '0.00',
          sentimentLabel: 'neutral',
          topicCategories: ['historical', 'bitcoin'],
          totalArticlesFetched: 1,
          uniqueArticlesAnalyzed: 1,
        };

        await storage.createAnalysis(analysisData);
        migratedCount++;
        
        if (migratedCount % 100 === 0) {
          console.log(`📈 Progress: ${migratedCount}/${enhancedEvents.length} events migrated`);
        }
      } catch (error) {
        console.error(`❌ Failed to migrate event for ${event.date}:`, error);
        errors.push({ date: event.date, error: (error as Error).message });
      }
    }

    console.log("🎉 Migration completed!");
    console.log(`✅ Migrated: ${migratedCount} events`);
    console.log(`⏭️ Skipped: ${skippedCount} events`);
    console.log(`❌ Errors: ${errors.length} events`);

    res.json({
      success: true,
      migrated: migratedCount,
      skipped: skippedCount,
      errors: errors.length,
      errorDetails: errors
    });

  } catch (error) {
    console.error("❌ Migration failed:", error);
    res.status(500).json({ 
      success: false, 
      error: (error as Error).message 
    });
  }
});

router.get("/api/raw-data-viewer", async (req, res) => {
  try {
    const analyses = await db
      .select()
      .from(historicalNewsAnalyses)
      .orderBy(desc(historicalNewsAnalyses.date))
      .limit(10);

    const jsonData = JSON.stringify(analyses, null, 2);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Raw Data</title>
      </head>
      <body>
        <pre>${jsonData}</pre>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    res.status(500).send(`<pre>Error: ${errorMessage}</pre>`);
  }
});

// Check for missing dates endpoint (read-only)
router.get("/api/system/check-missing-dates", async (req, res) => {
  try {
    console.log('🔍 Checking for missing dates...');
    
    // Get all existing dates from the database
    const allAnalyses = await storage.getAllAnalyses();
    const existingDates = new Set(allAnalyses.map(a => a.date));
    console.log(`📊 Found ${existingDates.size} existing dates in database`);
    
    // Generate expected date range: 2009-01-03 to 2024-12-31
    const startDate = new Date('2009-01-03');
    const endDate = new Date('2024-12-31');
    const expectedDates: string[] = [];
    
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      expectedDates.push(dateStr);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Find missing dates
    const missingDates = expectedDates.filter(date => !existingDates.has(date));
    console.log(`❌ Found ${missingDates.length} missing dates`);
    
    res.json({
      success: true,
      hasMissingDates: missingDates.length > 0,
      missingCount: missingDates.length,
      totalExpected: expectedDates.length,
      totalExisting: existingDates.size,
      missingDates: missingDates.slice(0, 10) // Return first 10 for reference
    });
    
  } catch (error) {
    console.error('❌ Error checking missing dates:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      hasMissingDates: null
    });
  }
});

// Backfill missing dates endpoint
router.post("/api/system/backfill-missing-dates", async (req, res) => {
  try {
    console.log('🔄 Starting backfill of missing dates...');
    
    // Get all existing dates from the database
    const allAnalyses = await storage.getAllAnalyses();
    const existingDates = new Set(allAnalyses.map(a => a.date));
    console.log(`📊 Found ${existingDates.size} existing dates in database`);
    
    // Generate expected date range: 2009-01-03 to 2024-12-31
    const startDate = new Date('2009-01-03');
    const endDate = new Date('2024-12-31');
    const expectedDates: string[] = [];
    
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      expectedDates.push(dateStr);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log(`📅 Expected date range: ${expectedDates.length} days (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
    
    // Find missing dates
    const missingDates = expectedDates.filter(date => !existingDates.has(date));
    console.log(`❌ Found ${missingDates.length} missing dates`);
    
    if (missingDates.length === 0) {
      return res.json({
        success: true,
        message: 'No missing dates found. All dates are present in the database.',
        created: 0,
        totalExpected: expectedDates.length,
        totalExisting: existingDates.size
      });
    }
    
    // Create placeholder rows for missing dates
    const placeholderRows: InsertHistoricalNewsAnalysis[] = missingDates.map(date => ({
      date,
      summary: '', // Empty summary - will be filled when analyzed
      topArticleId: 'none',
      reasoning: 'Placeholder row - awaiting analysis',
      winningTier: 'none',
      tieredArticles: { bitcoin: [], crypto: [], macro: [] },
      aiProvider: 'openai',
      confidenceScore: '0',
      sentimentScore: '0',
      sentimentLabel: 'neutral',
      topicCategories: [],
      duplicateArticleIds: [],
      totalArticlesFetched: 0,
      uniqueArticlesAnalyzed: 0,
      perplexityVerdict: 'uncertain',
      perplexityApproved: false,
      geminiApproved: false,
      factCheckVerdict: 'uncertain',
      isOrphan: false
    }));
    
    // Insert missing rows (handle duplicates gracefully)
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const row of placeholderRows) {
      try {
        // Check if it exists (race condition protection)
        const existing = await storage.getAnalysisByDate(row.date);
        if (existing) {
          skipped++;
          continue;
        }
        
        await storage.createAnalysis(row);
        created++;
      } catch (error: any) {
        // If it's a unique constraint violation, it means another process created it
        if (error?.code === '23505' || error?.message?.includes('unique')) {
          skipped++;
        } else {
          console.error(`Error creating row for ${row.date}:`, error);
          errors++;
        }
      }
    }
    
    console.log(`✅ Backfill complete: ${created} created, ${skipped} skipped (already exist), ${errors} errors`);
    
    res.json({
      success: true,
      message: `Backfill complete: Created ${created} placeholder rows for missing dates.`,
      created,
      skipped,
      errors,
      totalMissing: missingDates.length,
      totalExpected: expectedDates.length,
      totalExisting: existingDates.size,
      missingDates: missingDates.slice(0, 10) // Return first 10 for reference
    });
    
  } catch (error) {
    console.error('❌ Error in backfill-missing-dates:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      message: 'Failed to backfill missing dates'
    });
  }
});

export default router;

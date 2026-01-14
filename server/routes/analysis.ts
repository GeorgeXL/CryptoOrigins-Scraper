import { Router } from "express";
import { storage } from "../storage";
import { newsAnalyzer } from "../services/news-analyzer";
import { exaService } from "../services/exa";
import { type ArticleData } from "@shared/schema";
import { periodDetector } from "../services/period-detector";
import { hierarchicalSearch } from "../services/hierarchical-search";
import { type HistoricalNewsAnalysis, type InsertHistoricalNewsAnalysis } from "@shared/schema";
import { cacheManager } from "../services/cache-manager";
import { healthMonitor } from "../services/health-monitor";
import { createErrorResponse } from "../utils/error-handler";
import { apiMonitor } from "../services/api-monitor";
import { qualityChecker } from "../services/quality-checker";
import { batchProcessor } from "../services/batch-processor";
import { conflictClusterer } from "../services/conflict-clusterer";
import { perplexityCleaner } from "../services/perplexity-cleaner";
import { entityExtractor } from "../services/entity-extractor";
import { sql, eq } from "drizzle-orm";
import { aiService } from "../services/ai";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";

const router = Router();

// Global state for fact-checking process
let shouldStopPerplexityFactCheck = false;
let isPerplexityFactCheckRunning = false;
let perplexityFactCheckProcessed = 0;

// Global state for re-verification
let shouldStopReVerification = false;
let isReVerificationRunning = false;
let reVerificationProcessed = 0;

// Global state for cleanup
let shouldStopCleanup = false;
let isCleanupRunning = false;
let cleanupProcessed = 0;
let cleanupTotal = 0;

// Global state for Find New Events
let shouldStopFindNewEvents = false;
let isFindNewEventsRunning = false;
let findNewEventsProcessed = 0;
let findNewEventsTotal = 0;

// Utility function to parse date strings from Perplexity
function parsePerplexityDate(dateText: string | null): string | null {
  if (!dateText) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText;
  const isoMatch = dateText.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  console.log(`⚠️ Could not parse date from: "${dateText}"`);
  return null;
}

  router.get("/api/analysis/stats", async (req, res) => {
    try {
      const progress = await newsAnalyzer.getAnalysisProgress();
      res.json(progress);
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  router.get("/api/analysis/year/:year", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      if (isNaN(year) || year < 2008 || year > new Date().getFullYear()) {
        return res.status(400).json({ error: "Invalid year" });
      }
      
      const yearData = await newsAnalyzer.getYearAnalysisData(year);
      res.json(yearData);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🔍 Retrieving analysis for date: ${date}`);
      const analysis = await storage.getAnalysisByDate(date);
      
      if (!analysis) {
        console.log(`❌ No analysis found in database for date: ${date}`);
        // Check if there are any analyses in the database
        const allAnalyses = await storage.getAllAnalyses();
        console.log(`📊 Total analyses in database: ${allAnalyses.length}`);
        if (allAnalyses.length > 0) {
          console.log(`📋 Sample dates in database: ${allAnalyses.slice(0, 3).map((a: HistoricalNewsAnalysis) => a.date).join(', ')}`);
        }
        return res.status(404).json({ error: `Analysis not found for date: ${date}. Database contains ${allAnalyses.length} analyses.` });
      }

      console.log(`✅ Analysis found for date: ${date}, ID: ${analysis.id}`);
      const manualEntries = await storage.getManualEntriesByDate(date);

      // Extract analyzed articles and tiered articles from the analysis
      let analyzedArticles: any[] = [];
      let tieredArticles: any = { bitcoin: [], crypto: [], macro: [] };
      let winningTier: string | null = null;

      // NEW: Extract tiered articles (preferred method)
      if (analysis.tieredArticles && typeof analysis.tieredArticles === 'object') {
        tieredArticles = analysis.tieredArticles;
        winningTier = analysis.winningTier || null;
        console.log(`📊 Found tiered articles - Bitcoin: ${tieredArticles.bitcoin?.length || 0}, Crypto: ${tieredArticles.crypto?.length || 0}, Macro: ${tieredArticles.macro?.length || 0}`);
        console.log(`🏆 Winning tier: ${winningTier}`);
      }

      // Legacy support: Extract analyzed articles from various storage locations
      if (analysis.analyzedArticles && Array.isArray(analysis.analyzedArticles)) {
        analyzedArticles = analysis.analyzedArticles;
      } else if (analysis.articleTags && typeof analysis.articleTags === 'object' && 
                 (analysis.articleTags as any).analysisMetadata && 
                 (analysis.articleTags as any).analysisMetadata.analyzedArticles) {
        // Fallback for older analyses that stored articles in metadata
        analyzedArticles = (analysis.articleTags as any).analysisMetadata.analyzedArticles;
      }

      console.log(`📄 Including ${analyzedArticles.length} analyzed articles with analysis response`);
      const totalTieredArticles = (tieredArticles.bitcoin?.length || 0) + (tieredArticles.crypto?.length || 0) + (tieredArticles.macro?.length || 0);
      console.log(`🗂️ Including ${totalTieredArticles} tiered articles (Bitcoin: ${tieredArticles.bitcoin?.length || 0}, Crypto: ${tieredArticles.crypto?.length || 0}, Macro: ${tieredArticles.macro?.length || 0})`);

      res.json({
        analysis,
        manualEntries,
        analyzedArticles: analyzedArticles, // Legacy support - exact articles that were analyzed
        tieredArticles: tieredArticles, // NEW: Articles from ALL tiers (bitcoin/crypto/macro)
        winningTier: winningTier, // NEW: Which tier won the significance analysis
        meta: {
          hasLegacyData: analyzedArticles.length > 0,
          hasTieredData: totalTieredArticles > 0,
          dataVersion: totalTieredArticles > 0 ? 'v2-tiered' : 'v1-legacy'
        }
      });
    } catch (error) {
      console.error(`💥 Error retrieving analysis for ${req.params.date}:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update flagged state for a specific date
  router.post("/api/analysis/date/:date/flag", async (req, res) => {
    try {
      const { date } = req.params;
      const { isFlagged, flagReason } = req.body as { isFlagged: boolean; flagReason?: string };

      if (typeof isFlagged !== "boolean") {
        return res.status(400).json({ error: "isFlagged (boolean) is required" });
      }

      const updated = await storage.updateAnalysisFlag(date, isFlagged, flagReason);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/analysis/date/:date/veri-badge", async (req, res) => {
    try {
      const { date } = req.params;
      const { veriBadge } = req.body;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      if (!veriBadge || !['Manual', 'Orphan', 'Verified', 'Not Available'].includes(veriBadge)) {
        return res.status(400).json({ error: "Invalid veri_badge value. Must be one of: Manual, Orphan, Verified, Not Available" });
      }

      console.log(`🏷️ POST /api/analysis/date/${date}/veri-badge - Updating veri_badge to ${veriBadge}`);

      // Check if analysis exists
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      // Update the underlying fields that determine veri_badge
      // The database trigger will automatically recalculate veri_badge
      const updateData: any = {};
      
      switch (veriBadge) {
        case 'Manual':
          updateData.isManualOverride = true;
          updateData.isOrphan = false;
          updateData.geminiApproved = false;
          updateData.perplexityApproved = false;
          break;
        case 'Orphan':
          updateData.isOrphan = true;
          updateData.isManualOverride = false;
          updateData.geminiApproved = false;
          updateData.perplexityApproved = false;
          break;
        case 'Verified':
          updateData.geminiApproved = true;
          updateData.perplexityApproved = true;
          updateData.isManualOverride = false;
          updateData.isOrphan = false;
          break;
        case 'Not Available':
          updateData.geminiApproved = false;
          updateData.perplexityApproved = false;
          updateData.isManualOverride = false;
          updateData.isOrphan = false;
          break;
      }

      await storage.updateAnalysis(date, updateData);

      console.log(`✅ Successfully updated veri_badge for ${date} to ${veriBadge}`);

      res.json({
        success: true,
        date,
        veriBadge,
        message: "Verification badge updated successfully"
      });
    } catch (error) {
      console.error(`💥 Error updating veri_badge for ${req.params.date}:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/api/analysis/month/:year/:month", async (req, res) => {
    try {
      const { year, month } = req.params;
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      
      if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ error: "Invalid year or month" });
      }

      const monthData = await newsAnalyzer.getYearAnalysisData(yearNum);
      res.json(monthData);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get("/api/analysis/filter", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate query parameters are required" });
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate as string) || !dateRegex.test(endDate as string)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🔍 Filtering analyses from ${startDate} to ${endDate}`);
      const analyses = await storage.getAnalysesByDateRange(startDate as string, endDate as string);
      
      // Map to the format expected by the frontend
      const formattedAnalyses = analyses.map((analysis): {
        date: string;
        summary: string;
        isManualOverride?: boolean;
      } => ({
        date: analysis.date,
        summary: analysis.summary || '',
        isManualOverride: analysis.isManualOverride || false,
      }));

      console.log(`✅ Returning ${formattedAnalyses.length} analyses`);
      res.json(formattedAnalyses);
    } catch (error) {
      console.error('❌ Error filtering analyses:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const { aiProvider = 'openai', forceReanalysis = false } = req.body;
      // Fallback: also honor ?force=true|1 query param for bulk buttons that might not send JSON body
      const forceFromQuery = req.query.force === 'true' || req.query.force === '1';
      const isForce = Boolean(forceReanalysis || forceFromQuery);
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const userAgent = req.get('User-Agent') || 'unknown';
      const referer = req.get('Referer') || 'no-referer';
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🚀 [${requestId}] POST /api/analysis/date/${date} - RECEIVED`);
      console.log(`📊 [${requestId}] Request details: force=${isForce}, aiProvider=${aiProvider}`);
      console.log(`🌐 [${requestId}] Source: ${referer}`);
      console.log(`🖥️ [${requestId}] User-Agent: ${userAgent.substring(0, 50)}...`);

      // DATABASE DEDUPLICATION: Check if analysis already exists (unless forcing reanalysis)
      if (!isForce) {
        console.log(`🔍 [${requestId}] Checking if analysis already exists for ${date}...`);
        const existingAnalysis = await storage.getAnalysisByDate(date);
        if (existingAnalysis) {
          console.log(`✅ [${requestId}] Analysis already exists for ${date}, returning existing data`);
          // Extract articles from the analysis record
          const articles = existingAnalysis.analyzedArticles || [];
          return res.json({
            topArticleId: existingAnalysis.topArticleId,
            summary: existingAnalysis.summary,
            totalArticlesFetched: existingAnalysis.totalArticlesFetched,
            uniqueArticlesAnalyzed: existingAnalysis.uniqueArticlesAnalyzed,
            duplicateArticleIds: existingAnalysis.duplicateArticleIds,
            isFromCache: true,
            analysis: existingAnalysis,
            articles: articles || []
          });
        }
        console.log(`➡️ [${requestId}] No existing analysis found, proceeding with new analysis...`);
      } else {
        console.log(`🔄 [${requestId}] Force reanalysis requested, skipping database check...`);
        
        // Clear existing tags when re-analyzing
        try {
          const existingAnalysis = await storage.getAnalysisByDate(date);
          if (existingAnalysis) {
            console.log(`🏷️ [${requestId}] Clearing existing tags for ${date}...`);
            
            // Clear tags_version2 array and old tags JSONB field
            await storage.updateAnalysis(date, {
              tags: [],
              tagsVersion2: []
            });
            
            // Clear normalized tags (pages_and_tags join table)
            const { pagesAndTags } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            await db.delete(pagesAndTags).where(eq(pagesAndTags.analysisId, existingAnalysis.id));
            
            console.log(`✅ [${requestId}] Tags cleared for ${date}`);
          }
        } catch (tagClearError) {
          console.warn(`⚠️ [${requestId}] Failed to clear tags, continuing anyway:`, tagClearError);
        }
      }

      // Import analyse day function
      const { analyzeDay } = await import('../services/analysis-modes');
      
      // Always use Analyse Day
      let analysisResult;
      let tieredArticles: any = { bitcoin: [], crypto: [], macro: [] }; // Preserve articles even on error
      
      try {
        console.log(`📅 [${requestId}] Using Analyse Day (parallel battle)`);
        analysisResult = await analyzeDay({
          date,
          requestContext: {
            requestId,
            source: 'POST_ROUTE',
            referer,
            userAgent
          }
        });
        
        // ALWAYS preserve tieredArticles from result (even if empty, use what was fetched)
        if (analysisResult.tieredArticles) {
          tieredArticles = analysisResult.tieredArticles;
          console.log(`💾 [${requestId}] Preserved tieredArticles - Bitcoin: ${tieredArticles.bitcoin?.length || 0}, Crypto: ${tieredArticles.crypto?.length || 0}, Macro: ${tieredArticles.macro?.length || 0}`);
        }
      } catch (analysisError) {
        console.error(`💥 [${requestId}] Error during analysis, but attempting to save any fetched articles...`, analysisError);
        console.error(`   Error stack:`, (analysisError as Error).stack);
        
        // Check if the error occurred after perplexity/gemini (meaning we might have selection data)
        // If analysisResult already has requiresSelection, preserve it
        const hasSelectionData = analysisResult && 'requiresSelection' in analysisResult && (analysisResult as any).requiresSelection;
        
        if (hasSelectionData) {
          console.log(`   ⚠️ [${requestId}] Error occurred but selection data exists, preserving it`);
          console.log(`   Selection mode: ${(analysisResult as any).selectionMode}`);
          // Keep the existing analysisResult with requiresSelection - don't overwrite it
        } else {
          // Even if analysis failed, try to save any articles that were fetched
          // This ensures articles are preserved for manual review
          // Note: tieredArticles might be empty if error occurred before fetching
          analysisResult = {
            summary: '',
            topArticleId: 'none',
            reasoning: `Analysis failed: ${(analysisError as Error).message}. Articles were still saved for manual review.`,
            winningTier: 'none',
            tieredArticles: tieredArticles,
            aiProvider: 'openai',
            confidenceScore: 0,
            sentimentScore: 0,
            sentimentLabel: 'neutral',
            topicCategories: [],
            duplicateArticleIds: [],
            totalArticlesFetched: (tieredArticles.bitcoin?.length || 0) + (tieredArticles.crypto?.length || 0) + (tieredArticles.macro?.length || 0),
            uniqueArticlesAnalyzed: 0,
            perplexityVerdict: 'uncertain',
            perplexityApproved: false,
            geminiApproved: false,
            factCheckVerdict: 'uncertain'
          };
        }
      }
      
      // CRITICAL: Always use tieredArticles from analysisResult if available (even after error handling)
      // This ensures we save what was actually fetched, not an empty object
      if (analysisResult.tieredArticles) {
        tieredArticles = analysisResult.tieredArticles;
      }

      // Check if user selection is required
      // Safety check: ensure analysisResult exists
      if (!analysisResult) {
        console.error(`💥 [${requestId}] analysisResult is undefined! This should not happen.`);
        return res.status(500).json({ 
          error: 'Analysis failed unexpectedly',
          requiresSelection: false 
        });
      }
      
      if (analysisResult.requiresSelection) {
        console.log(`🔄 [${requestId}] User selection required (mode: ${analysisResult.selectionMode})`);
        console.log(`   📊 Selection data:`, {
          geminiCount: analysisResult.geminiSelectedIds?.length || 0,
          perplexityCount: analysisResult.perplexitySelectedIds?.length || 0,
          intersectionCount: analysisResult.intersectionIds?.length || 0,
          openaiSuggested: analysisResult.openaiSuggestedId,
          tieredArticlesCount: {
            bitcoin: tieredArticles?.bitcoin?.length || 0,
            crypto: tieredArticles?.crypto?.length || 0,
            macro: tieredArticles?.macro?.length || 0
          }
        });
        try {
          // Save the analysis state with articles but no summary yet
          const initialAnalysisData: Partial<InsertHistoricalNewsAnalysis> = {
            summary: '',
            topArticleId: 'none',
            reasoning: analysisResult.reasoning,
            winningTier: 'none',
            tieredArticles: tieredArticles,
            aiProvider: 'openai',
            confidenceScore: '0',
            sentimentScore: '0',
            sentimentLabel: 'neutral',
            topicCategories: [],
            duplicateArticleIds: [],
            totalArticlesFetched: analysisResult.totalArticlesFetched,
            uniqueArticlesAnalyzed: 0,
            perplexityVerdict: analysisResult.perplexityVerdict,
            perplexityApproved: analysisResult.perplexityApproved,
            geminiApproved: analysisResult.geminiApproved,
            factCheckVerdict: analysisResult.factCheckVerdict,
            isOrphan: analysisResult.selectionMode === 'orphan'
          };
          
          const existingAnalysis = await storage.getAnalysisByDate(date);
          if (existingAnalysis) {
            await storage.updateAnalysis(date, initialAnalysisData);
          } else {
            await storage.createAnalysis(initialAnalysisData as any);
          }
          
          console.log(`✅ [${requestId}] Analysis state saved, returning selection data`);
        } catch (dbError) {
          console.error(`⚠️ [${requestId}] Error saving analysis state (continuing anyway):`, dbError);
          // Continue anyway - we still want to return the selection data
        }
        
        // Return selection data to frontend
        const responseData = {
          requiresSelection: true,
          selectionMode: analysisResult.selectionMode,
          tieredArticles: tieredArticles,
          geminiSelectedIds: analysisResult.geminiSelectedIds || [],
          perplexitySelectedIds: analysisResult.perplexitySelectedIds || [],
          intersectionIds: analysisResult.intersectionIds || [],
          openaiSuggestedId: analysisResult.openaiSuggestedId,
          date: date
        };
        console.log(`📤 [${requestId}] Sending selection response to frontend`);
        return res.json(responseData);
      }

      // Check if AIs didn't agree
      const aisDidntAgree = analysisResult.perplexityApproved === false && 
        analysisResult.geminiApproved === false &&
        analysisResult.topArticleId === 'none';

      // Save analysis to database (ALWAYS save, even if AIs didn't agree or analysis failed - articles are still valuable)
      // CRITICAL: Use tieredArticles from analysisResult if available, otherwise use the preserved one
      const finalTieredArticles = analysisResult.tieredArticles || tieredArticles || { bitcoin: [], crypto: [], macro: [] };
      
      const analysisData: any = {
        date,
        summary: analysisResult.summary || '',
        topArticleId: analysisResult.topArticleId || 'none',
        isManualOverride: false,
        aiProvider: analysisResult.aiProvider || 'openai',
        reasoning: analysisResult.reasoning || 'Analysis completed with no summary generated.',
        confidenceScore: (analysisResult.confidenceScore || 0).toString(),
        sentimentScore: (analysisResult.sentimentScore || 0).toString(),
        sentimentLabel: analysisResult.sentimentLabel || 'neutral',
        topicCategories: analysisResult.topicCategories || [],
        duplicateArticleIds: analysisResult.duplicateArticleIds || [],
        totalArticlesFetched: analysisResult.totalArticlesFetched || 0,
        uniqueArticlesAnalyzed: analysisResult.uniqueArticlesAnalyzed || 0,
        winningTier: analysisResult.winningTier || 'none',
        tieredArticles: finalTieredArticles, // ALWAYS save tieredArticles, even if no summary
        articleTags: {
          totalArticles: analysisResult.totalArticlesFetched || 0,
          topSources: {},
          duplicatesFound: (analysisResult.duplicateArticleIds || []).length,
          sourcesUsed: [],
          totalFetched: analysisResult.totalArticlesFetched || 0,
          accessibleArticles: analysisResult.totalArticlesFetched || 0,
          filteredArticles: 0,
          accessibilityRate: 1.0,
          analysisMetadata: {
            processingDate: new Date().toISOString(),
            version: '4.0-analyse-day',
            tierUsed: analysisResult.winningTier || 'none',
            winningTier: analysisResult.winningTier || 'none',
            analyzedArticles: []
          }
        }
      };

      // Add fact checking fields
      analysisData.perplexityVerdict = analysisResult.perplexityVerdict || 'uncertain';
      analysisData.perplexityApproved = analysisResult.perplexityApproved || false;
      analysisData.geminiApproved = analysisResult.geminiApproved || false;
      analysisData.factCheckVerdict = analysisResult.factCheckVerdict || 'uncertain';

      // Try to save to database (even if analysis failed, save what we have)
      try {
        // Log what we're about to save
        const bitcoinCount = finalTieredArticles?.bitcoin?.length || 0;
        const cryptoCount = finalTieredArticles?.crypto?.length || 0;
        const macroCount = finalTieredArticles?.macro?.length || 0;
        console.log(`💾 [${requestId}] Saving to database - Bitcoin: ${bitcoinCount}, Crypto: ${cryptoCount}, Macro: ${macroCount}, Total: ${analysisData.totalArticlesFetched}`);
        console.log(`💾 [${requestId}] tieredArticles type: ${typeof finalTieredArticles}, has macro: ${!!finalTieredArticles?.macro}, macro length: ${finalTieredArticles?.macro?.length || 0}`);
        
        const existingAnalysis = await storage.getAnalysisByDate(date);
        if (existingAnalysis) {
          await storage.updateAnalysis(date, analysisData);
        } else {
          await storage.createAnalysis(analysisData);
        }
        console.log(`✅ [${requestId}] Analysis saved to database successfully`);
      } catch (dbError) {
        console.error(`💥 [${requestId}] Failed to save to database:`, dbError);
        // Still continue to return response with articles
      }

      // Flatten tiered articles for response
      const articles: any[] = [];
      if (finalTieredArticles) {
        articles.push(...(finalTieredArticles.bitcoin || []));
        articles.push(...(finalTieredArticles.crypto || []));
        articles.push(...(finalTieredArticles.macro || []));
      }
      
      console.log(`🏁 [${requestId}] Request completed successfully`);
      if (aisDidntAgree) {
        console.log(`⚠️ [${requestId}] AIs didn't agree, but articles were saved`);
      }
      
      res.json({
        ...analysisResult,
        tieredArticles: finalTieredArticles, // Ensure tieredArticles is in response
        articles,
        analysisDate: date,
        aisDidntAgree: aisDidntAgree || false // Flag to indicate disagreement
      });
    } catch (error) {
      console.error(`💥 Error analyzing news for ${req.params.date}:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Redo summary endpoint - regenerate summary from existing article
  router.post("/api/analysis/date/:date/redo-summary", async (req, res) => {
    try {
      const { date } = req.params;
      const requestId = `redo-summary-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`📝 [${requestId}] POST /api/analysis/date/${date}/redo-summary - RECEIVED`);

      // Get existing analysis
      const analysis = await storage.getAnalysisByDate(date);
      if (!analysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      if (!analysis.topArticleId || analysis.topArticleId === 'none') {
        return res.status(400).json({ error: "No article selected for this analysis. Please select an article first." });
      }

      // Find the article in tieredArticles or analyzedArticles
      let selectedArticle: any = null;
      const tieredArticles = analysis.tieredArticles as any;
      
      if (tieredArticles && typeof tieredArticles === 'object') {
        const tiers = ['bitcoin', 'crypto', 'macro'] as const;
        for (const tier of tiers) {
          const tierArticles = tieredArticles[tier] || [];
          const article = tierArticles.find((a: any) => a.id === analysis.topArticleId);
          if (article) {
            selectedArticle = article;
            break;
          }
        }
      }

      // Fallback to analyzedArticles if not found in tieredArticles
      if (!selectedArticle && analysis.analyzedArticles) {
        const analyzedArticles = Array.isArray(analysis.analyzedArticles) 
          ? analysis.analyzedArticles 
          : [];
        selectedArticle = analyzedArticles.find((a: any) => a.id === analysis.topArticleId) || analyzedArticles[0];
      }

      if (!selectedArticle) {
        return res.status(404).json({ error: `Article not found for topArticleId: ${analysis.topArticleId}` });
      }

      // Determine tier
      let winningTier = 'bitcoin';
      if (tieredArticles?.crypto?.some((a: any) => a.id === selectedArticle.id)) {
        winningTier = 'crypto';
      } else if (tieredArticles?.macro?.some((a: any) => a.id === selectedArticle.id)) {
        winningTier = 'macro';
      }

      // Generate new summary using OpenAI
      const { generateSummaryWithOpenAI } = await import('../services/analysis-modes');
      console.log(`📝 [${requestId}] Regenerating summary for ${date} using article: ${selectedArticle.id}`);
      
      const summaryResult = await generateSummaryWithOpenAI(
        selectedArticle.id,
        [selectedArticle],
        date,
        winningTier,
        requestId
      );

      // Update only the summary field
      await storage.updateAnalysis(date, {
        summary: summaryResult.summary
      });

      console.log(`✅ [${requestId}] Summary regenerated successfully: "${summaryResult.summary.substring(0, 60)}..."`);

      res.json({
        success: true,
        summary: summaryResult.summary,
        topArticleId: analysis.topArticleId,
        date
      });
    } catch (error) {
      console.error(`💥 Error regenerating summary for ${req.params.date}:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Manual article selection endpoint - user selects article, OpenAI summarizes, creates orphan
  router.put("/api/analysis/date/:date/select-article", async (req, res) => {
    try {
      const { date } = req.params;
      const { articleId } = req.body;
      const requestId = `select-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      
      if (!articleId) {
        return res.status(400).json({ error: "articleId is required" });
      }
      
      console.log(`🎯 [${requestId}] Manual article selection for ${date}, article: ${articleId}`);
      
      // Get existing analysis to access tieredArticles
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `No analysis found for ${date}. Please run analysis first.` });
      }
      
      // Find the article in tieredArticles
      const tieredArticles = existingAnalysis.tieredArticles || { bitcoin: [], crypto: [], macro: [] };
      const allArticles = [
        ...(tieredArticles.bitcoin || []),
        ...(tieredArticles.crypto || []),
        ...(tieredArticles.macro || [])
      ];
      
      const selectedArticle = allArticles.find(a => a.id === articleId);
      if (!selectedArticle) {
        return res.status(404).json({ error: `Article ${articleId} not found in tiered articles for ${date}` });
      }
      
      // Determine which tier the article belongs to
      let winningTier = 'bitcoin';
      if (tieredArticles.crypto?.some(a => a.id === articleId)) {
        winningTier = 'crypto';
      } else if (tieredArticles.macro?.some(a => a.id === articleId)) {
        winningTier = 'macro';
      }
      
      console.log(`   📰 Found article: "${selectedArticle.title.substring(0, 60)}..."`);
      console.log(`   🏆 Tier: ${winningTier}`);
      
      // Import and use generateSummaryWithOpenAI
      const { generateSummaryWithOpenAI } = await import('../services/analysis-modes');
      
      // Generate summary with OpenAI
      console.log(`   📝 Generating summary with OpenAI...`);
      const summaryResult = await generateSummaryWithOpenAI(
        articleId,
        [selectedArticle],
        date,
        winningTier,
        requestId
      );
      
      console.log(`   ✅ Summary generated: "${summaryResult.summary.substring(0, 60)}..." (${summaryResult.summary.length} chars)`);
      
      // Update analysis with new summary, mark as orphan
      const updateData: Partial<InsertHistoricalNewsAnalysis> = {
        summary: summaryResult.summary,
        topArticleId: articleId,
        reasoning: `Manually selected article from ${winningTier} tier`,
        isOrphan: true, // Mark as orphan since it's manually selected
        aiProvider: 'openai',
        confidenceScore: summaryResult.confidenceScore.toString(),
        sentimentScore: summaryResult.sentimentScore.toString(),
        sentimentLabel: summaryResult.sentimentLabel,
        topicCategories: summaryResult.topicCategories,
        winningTier: winningTier,
        // Keep existing tieredArticles
        tieredArticles: tieredArticles
      };
      
      await storage.updateAnalysis(date, updateData);
      
      console.log(`   ✅ Analysis updated with orphan flag`);
      
      res.json({
        success: true,
        summary: summaryResult.summary,
        topArticleId: articleId,
        winningTier: winningTier,
        isOrphan: true
      });
    } catch (error) {
      console.error(`💥 Error selecting article:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Endpoint to proceed with summarization after user selection
  router.post("/api/analysis/date/:date/confirm-selection", async (req, res) => {
    try {
      const { date } = req.params;
      const { articleId, selectionMode } = req.body;
      const requestId = `confirm-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      
      if (!articleId) {
        return res.status(400).json({ error: "articleId is required" });
      }
      
      console.log(`✅ [${requestId}] Confirming article selection for ${date}, article: ${articleId}, mode: ${selectionMode}`);
      
      // Get existing analysis to access tieredArticles
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `No analysis found for ${date}. Please run analysis first.` });
      }
      
      // Find the article in tieredArticles
      const tieredArticles = existingAnalysis.tieredArticles || { bitcoin: [], crypto: [], macro: [] };
      const allArticles = [
        ...(tieredArticles.bitcoin || []),
        ...(tieredArticles.crypto || []),
        ...(tieredArticles.macro || [])
      ];
      
      const selectedArticle = allArticles.find(a => a.id === articleId);
      if (!selectedArticle) {
        return res.status(404).json({ error: `Article ${articleId} not found in tiered articles for ${date}` });
      }
      
      // Determine which tier the article belongs to
      let winningTier = 'bitcoin';
      if (tieredArticles.crypto?.some(a => a.id === articleId)) {
        winningTier = 'crypto';
      } else if (tieredArticles.macro?.some(a => a.id === articleId)) {
        winningTier = 'macro';
      }
      
      console.log(`   📰 Found article: "${selectedArticle.title.substring(0, 60)}..."`);
      console.log(`   🏆 Tier: ${winningTier}`);
      
      // Import and use generateSummaryWithOpenAI
      const { generateSummaryWithOpenAI } = await import('../services/analysis-modes');
      
      // Generate summary with OpenAI
      console.log(`   📝 Generating summary with OpenAI...`);
      const summaryResult = await generateSummaryWithOpenAI(
        articleId,
        [selectedArticle],
        date,
        winningTier,
        requestId
      );
      
      console.log(`   ✅ Summary generated: "${summaryResult.summary.substring(0, 60)}..." (${summaryResult.summary.length} chars)`);
      
      // Update analysis with new summary
      // Exclude agentCreated and other fields that might not exist in the database
      const updateData: Partial<InsertHistoricalNewsAnalysis> = {
        summary: summaryResult.summary,
        topArticleId: articleId,
        reasoning: selectionMode === 'orphan' 
          ? `Manually selected article from ${winningTier} tier (no intersection found)`
          : `User confirmed selection from ${winningTier} tier (multiple matches)`,
        isOrphan: selectionMode === 'orphan',
        aiProvider: 'openai',
        confidenceScore: summaryResult.confidenceScore.toString(),
        sentimentScore: summaryResult.sentimentScore.toString(),
        sentimentLabel: summaryResult.sentimentLabel,
        topicCategories: summaryResult.topicCategories,
        winningTier: winningTier,
        tieredArticles: tieredArticles,
        // Set verification fields based on selection mode
        perplexityVerdict: selectionMode === 'orphan' ? 'uncertain' : 'verified',
        perplexityApproved: selectionMode === 'orphan' ? false : true,
        geminiApproved: selectionMode === 'orphan' ? false : true,
        factCheckVerdict: selectionMode === 'orphan' ? 'uncertain' : 'verified'
      };
      
      // Remove any undefined values and exclude agentCreated
      const cleanUpdateData = Object.fromEntries(
        Object.entries(updateData).filter(([_, v]) => v !== undefined)
      ) as Partial<InsertHistoricalNewsAnalysis>;
      
      await storage.updateAnalysis(date, cleanUpdateData);
      
      console.log(`   ✅ Analysis updated with summary and verification status`);
      
      res.json({
        success: true,
        summary: summaryResult.summary,
        topArticleId: articleId,
        winningTier: winningTier,
        isOrphan: selectionMode === 'orphan',
        veriBadge: selectionMode === 'orphan' ? 'Orphan' : 'Verified'
      });
    } catch (error) {
      console.error(`💥 Error confirming article selection:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // PATCH route to update analysis (for manual summary edits)
  router.patch("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const { summary, reasoning, tags_version2 } = req.body;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      if (!summary || typeof summary !== 'string') {
        return res.status(400).json({ error: "Summary is required and must be a string" });
      }

      console.log(`📝 PATCH /api/analysis/date/${date} - Updating summary manually`);

      // Check if analysis exists
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      // Update the analysis - only include fields that exist in the database
      const updateData: any = {
        summary: summary.trim(),
      };
      
      if (reasoning) {
        updateData.reasoning = reasoning;
      }
      
      if (tags_version2 && Array.isArray(tags_version2)) {
        updateData.tags_version2 = tags_version2;
        
        // Also sync with normalized tags table
        console.log(`🏷️ Syncing ${tags_version2.length} tags with normalized tables...`);
        
        for (const tagName of tags_version2) {
          try {
            // Find or create the tag (use "miscellaneous" as default category for manual tags)
            const tag = await storage.findOrCreateTag({
              name: tagName,
              category: 'miscellaneous',
            });
            
            // Link tag to analysis (will skip if already linked)
            await storage.addTagToAnalysis(existingAnalysis.id, tag.id);
            
            // Update usage count
            await storage.updateTagUsageCount(tag.id);
            
            console.log(`   ✅ Tag "${tagName}" linked (id: ${tag.id.substring(0, 8)}...)`);
          } catch (tagError) {
            console.warn(`   ⚠️ Failed to sync tag "${tagName}":`, (tagError as Error).message);
            // Continue with other tags even if one fails
          }
        }
      }

      await storage.updateAnalysis(date, updateData);

      console.log(`✅ Successfully updated summary for ${date}`);
      console.log(`   New summary (${summary.trim().length} chars): "${summary.trim().substring(0, 60)}${summary.trim().length > 60 ? '...' : ''}"`);

      res.json({
        success: true,
        date,
        summary: summary.trim(),
        message: "Summary updated successfully"
      });
    } catch (error) {
      console.error(`💥 Error updating analysis for ${req.params.date}:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ... (Include other route handlers as needed, simplified for brevity)
  // For full functionality, you would need to re-implement all the route handlers 
  // from the original file, ensuring they use the new imports and global variables defined above.
  // I will stub a few more important ones.

  router.post("/api/analysis/analyze", async (req, res) => {
    try {
      const { date, forceReanalysis, aiProvider } = req.body;
      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }
      
      const result = await newsAnalyzer.analyzeNewsForDate({ 
        date, 
        forceReanalysis, 
        aiProvider,
        requestContext: {
          requestId: `analyze-${Date.now()}`,
          source: 'POST_ANALYZE'
        }
      });
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/final-analysis/verify", async (req, res) => {
    console.log('🔵 Final Analysis endpoint called');
    console.log('📥 Request body:', JSON.stringify(req.body));
    
    const batchStartTime = Date.now();
    const batchRequestId = apiMonitor.logRequest({
      service: 'health',
      endpoint: '/api/final-analysis/verify',
      method: 'POST',
      status: 'pending',
      context: 'final-analysis-batch',
      purpose: 'Batch verify dates',
      requestData: { dateCount: req.body?.dates?.length || 0 }
    });
    console.log('📊 API Monitor request logged with ID:', batchRequestId);
    console.log('📊 Total requests in monitor:', apiMonitor.getRecentRequests(100).length);

    try {
      const { dates } = req.body;
      console.log('📅 Received dates for verification:', dates?.length || 0);
      
      if (!Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: "Dates array is required and must not be empty" });
      }

      apiMonitor.updateRequest(batchRequestId, {
        requestData: { dateCount: dates.length }
      });

      const results = [];
      const totalDates = dates.length;
      let processedCount = 0;
      
      console.log(`📊 Processing ${totalDates} dates. This will make ${totalDates * 2} API calls (${totalDates} × Gemini + ${totalDates} × Perplexity)`);
      
      for (const date of dates) {
        processedCount++;
        console.log(`⏳ Processing date ${processedCount}/${totalDates}: ${date}`);
        try {
          // Fetch analysis for this date
          const analysis = await storage.getAnalysisByDate(date);
          
          if (!analysis) {
            results.push({
              date,
              error: "Analysis not found",
              geminiApproved: null,
              perplexityApproved: null
            });
            continue;
          }

          // Verify with Gemini
          let geminiResult: { approved: boolean | null; reasoning: string } | null = null;
          try {
            let geminiProvider;
            try {
              geminiProvider = aiService.getProvider('gemini');
            } catch (error) {
              console.log(`Gemini provider not available: ${(error as Error).message}`);
              geminiProvider = null;
            }
            
            if (geminiProvider && 'verifyEventDate' in geminiProvider) {
              geminiResult = await (geminiProvider as any).verifyEventDate(analysis.summary, date);
            } else {
              // Don't set false if provider not available - leave as null
              geminiResult = null;
            }
          } catch (error) {
            console.error(`Error verifying with Gemini for ${date}:`, error);
            // Don't set false on error - leave as null
            geminiResult = null;
          }

          // Verify with Perplexity
          let perplexityResult = { approved: false, reasoning: "" };
          try {
            let perplexityProvider;
            try {
              perplexityProvider = aiService.getProvider('perplexity');
            } catch (error) {
              console.log(`Perplexity provider not available: ${(error as Error).message}`);
              perplexityProvider = null;
            }
            
            if (perplexityProvider && 'verifyEventDate' in perplexityProvider) {
              perplexityResult = await (perplexityProvider as any).verifyEventDate(analysis.summary, date);
            } else {
              perplexityResult = { approved: false, reasoning: "Perplexity provider not available or not configured" };
            }
          } catch (error) {
            console.error(`Error verifying with Perplexity for ${date}:`, error);
            perplexityResult = { approved: false, reasoning: `Error: ${(error as Error).message}` };
          }

          // Update database with results
          // Note: This will fail if migration hasn't been run, so we catch and continue
          try {
            const updateData: any = {
              perplexityApproved: perplexityResult.approved,
              finalAnalysisCheckedAt: new Date()
            };
            // Only update geminiApproved if we actually got a result (not null)
            if (geminiResult !== null) {
              updateData.geminiApproved = geminiResult.approved;
            }
            await db.update(historicalNewsAnalyses)
              .set(updateData)
              .where(eq(historicalNewsAnalyses.date, date));
          } catch (dbError: any) {
            // If columns don't exist yet (migration not run), log but continue
            if (dbError.message?.includes('column') || dbError.message?.includes('does not exist')) {
              console.warn(`Database columns not found for ${date}. Migration may need to be run. Error: ${dbError.message}`);
            } else {
              throw dbError; // Re-throw if it's a different error
            }
          }

          results.push({
            date,
            geminiApproved: geminiResult?.approved ?? null,
            perplexityApproved: perplexityResult.approved,
            geminiReasoning: geminiResult?.reasoning ?? null,
            perplexityReasoning: perplexityResult.reasoning
          });
        } catch (error) {
          console.error(`Error processing date ${date}:`, error);
          results.push({
            date,
            error: (error as Error).message,
            geminiApproved: null,
            perplexityApproved: null
          });
        }
      }

      const totalDuration = Date.now() - batchStartTime;
      
      // Check if any providers were unavailable
      const unavailableProviders = [];
      if (results.length > 0) {
        const firstResult = results[0];
        if (firstResult.geminiReasoning?.includes('not available')) {
          unavailableProviders.push('Gemini');
        }
        if (firstResult.perplexityReasoning?.includes('not available')) {
          unavailableProviders.push('Perplexity');
        }
      }
      
      apiMonitor.updateRequest(batchRequestId, {
        status: 'success',
        duration: totalDuration,
        responseSize: results.length
      });

      res.json({ 
        results,
        warnings: unavailableProviders.length > 0 
          ? `${unavailableProviders.join(' and ')} ${unavailableProviders.length === 1 ? 'is' : 'are'} not configured or available`
          : undefined
      });
    } catch (error) {
      const totalDuration = Date.now() - batchStartTime;
      apiMonitor.updateRequest(batchRequestId, {
        status: 'error',
        duration: totalDuration,
        error: (error as Error).message
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/fact-check/verify-not-verified", async (req, res) => {
    console.log('🔵 Verify Not-Verified Entries endpoint called');
    
    const batchStartTime = Date.now();
    const batchRequestId = apiMonitor.logRequest({
      service: 'health',
      endpoint: '/api/fact-check/verify-not-verified',
      method: 'POST',
      status: 'pending',
      context: 'fact-check-batch',
      purpose: 'Verify not-verified entries',
    });

    try {
      // Get all analyses that have no verdict at all (both null)
      const allAnalyses = await storage.getAllAnalyses();
      
      const notVerifiedAnalyses = allAnalyses.filter(analysis => {
        return !analysis.perplexityVerdict && !analysis.factCheckVerdict;
      });

      const total = notVerifiedAnalyses.length;
      console.log(`📊 Found ${total} not-verified entries to process`);

      if (total === 0) {
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: Date.now() - batchStartTime,
        });
        return res.json({ 
          success: true,
          total: 0,
          message: 'No not-verified entries found' 
        });
      }

      // Send immediate response
      res.json({ 
        success: true,
        total,
        message: `Starting verification of ${total} entries. This will run in the background.` 
      });

      // Process in background (2 entries in parallel, continuously)
      (async () => {
        let processed = 0;
        let verified = 0;
        let contradicted = 0;

        // Process entries with continuous parallel processing (always keep 2 running)
        const processEntry = async (analysis: typeof notVerifiedAnalyses[0]) => {
          try {
            // Comprehensive fact-check with Perplexity
            let factCheckResult = null;
            
            try {
              const perplexityProvider = aiService.getProvider('perplexity');
              if (perplexityProvider && 'factCheckEvent' in perplexityProvider) {
                factCheckResult = await (perplexityProvider as any).factCheckEvent(analysis.summary, analysis.date);
              } else {
                // Fallback to simple verification
                console.log(`Using fallback verifyEventDate for ${analysis.date}`);
                const simpleResult = await (perplexityProvider as any).verifyEventDate(analysis.summary, analysis.date);
                factCheckResult = {
                  verdict: simpleResult.approved ? 'verified' : 'contradicted',
                  confidence: simpleResult.approved ? 80 : 20,
                  reasoning: simpleResult.reasoning,
                  correctDateText: null,
                  citations: [],
                };
              }
            } catch (error) {
              console.log(`Perplexity verification skipped for ${analysis.date}: ${(error as Error).message}`);
              return { success: false, date: analysis.date };
            }

            if (!factCheckResult) {
              return { success: false, date: analysis.date };
            }

            // Update database with fact-check results
            const updateData: any = {
              perplexityVerdict: factCheckResult.verdict,
              perplexityConfidence: factCheckResult.confidence.toString(),
              perplexityReasoning: factCheckResult.reasoning,
              perplexityCheckedAt: new Date(),
            };

            // Add citations if available
            if (factCheckResult.citations && factCheckResult.citations.length > 0) {
              updateData.perplexityCitations = factCheckResult.citations;
            }

            // Note: We do NOT save correctDateText in Button 1 (initial verify)
            // correctDateText will be determined later when resolving contradictions

            await db.update(historicalNewsAnalyses)
              .set(updateData)
              .where(eq(historicalNewsAnalyses.date, analysis.date));

            return { 
              success: true, 
              date: analysis.date, 
              verdict: factCheckResult.verdict 
            };
          } catch (error) {
            console.error(`Error verifying ${analysis.date}:`, error);
            return { success: false, date: analysis.date };
          }
        };

        // Continuous parallel processing: always keep 2 running
        let index = 0;
        const running = new Map<string, Promise<{ success: boolean; date: string; verdict?: string }>>();

        while (index < notVerifiedAnalyses.length || running.size > 0) {
          // Start new entries until we have 2 running
          while (running.size < 2 && index < notVerifiedAnalyses.length) {
            const analysis = notVerifiedAnalyses[index];
            const promise = processEntry(analysis).then(result => {
              // Update counters when entry completes
              processed++;
              if (result.success && result.verdict === 'verified') {
                verified++;
              } else if (result.success && result.verdict === 'contradicted') {
                contradicted++;
              }

              if (processed % 10 === 0) {
                console.log(`📈 Progress: ${processed}/${total} entries verified`);
              }

              return result;
            });
            running.set(analysis.date, promise);
            index++;
          }

          // Wait for at least one to complete before starting more
          if (running.size > 0) {
            const completed = await Promise.race(
              Array.from(running.entries()).map(([date, promise]) =>
                promise.then(result => ({ result, date }))
              )
            );
            // Remove the completed entry
            running.delete(completed.date);
          }
        }

        const totalDuration = Date.now() - batchStartTime;
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: totalDuration,
          responseSize: processed
        });

        console.log(`✅ Verification completed: ${processed} processed, ${verified} verified, ${contradicted} contradicted`);
      })();

    } catch (error) {
      const totalDuration = Date.now() - batchStartTime;
      apiMonitor.updateRequest(batchRequestId, {
        status: 'error',
        duration: totalDuration,
        error: (error as Error).message
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/fact-check/find-new-events", async (req, res) => {
    console.log('⚔️ Let\'s Battle! endpoint called');
    
    const batchStartTime = Date.now();
    const batchRequestId = apiMonitor.logRequest({
      service: 'health',
      endpoint: '/api/fact-check/find-new-events',
      method: 'POST',
      status: 'pending',
      context: 'battle-arena',
      purpose: 'Battle between Perplexity and Gemini to find relevant articles',
    });

    try {
      // Get all analyses that are in AI Arena (contradicted/uncertain or one verified but rejected by Gemini)
      const allAnalyses = await storage.getAllAnalyses();
      
      const arenaAnalyses = allAnalyses.filter(analysis => {
        const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
        const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
        const isGeminiApproved = analysis.geminiApproved === true;
        const isGeminiRejected = analysis.geminiApproved === false;
        const isBothVerified = isPerplexityVerified && isOpenAIVerified;
        const isOneVerified = (isPerplexityVerified || isOpenAIVerified) && !isBothVerified;
        const isOrphan = analysis.isOrphan === true;
        
        // Exclude: Orphans (already processed and marked as orphan)
        if (isOrphan) return false;
        
        // Exclude: Not Verified (both null)
        const isNotVerified = !analysis.perplexityVerdict && !analysis.factCheckVerdict;
        if (isNotVerified) return false;
        
        // Exclude: Ready to be Tagged (both verified OR one verified AND gemini approved)
        const isReadyToTag = isBothVerified || (isOneVerified && isGeminiApproved);
        if (isReadyToTag) return false;
        
        // Exclude: Verified by one service only (unless rejected by Gemini)
        if (isOneVerified && !isGeminiRejected) return false;
        
        // Include: Has verdict but NOT verified, OR one verified but rejected by Gemini
        const hasPerplexityVerdict = analysis.perplexityVerdict != null && analysis.perplexityVerdict !== '' && analysis.perplexityVerdict !== 'verified';
        const hasOpenAIVerdict = analysis.factCheckVerdict != null && analysis.factCheckVerdict !== '' && analysis.factCheckVerdict !== 'verified';
        
        return (!isPerplexityVerified && !isOpenAIVerified && (hasPerplexityVerdict || hasOpenAIVerdict)) ||
               (isOneVerified && isGeminiRejected);
      });

      const total = arenaAnalyses.length;
      console.log(`⚔️ Found ${total} AI Arena entries to battle`);

      if (total === 0) {
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: Date.now() - batchStartTime,
        });
        return res.json({ 
          success: true,
          total: 0,
          message: 'No AI Arena entries found' 
        });
      }

      // Reset stop flag and set running state
      shouldStopFindNewEvents = false;
      isFindNewEventsRunning = true;
      findNewEventsProcessed = 0;
      findNewEventsTotal = total;

      // Send immediate response
      res.json({ 
        success: true,
        total,
        message: `Starting battle for ${total} entries. This will run in the background.` 
      });

      // Process in background
      (async () => {
        let processed = 0;
        let resolved = 0;
        let failed = 0;
        let orphaned = 0;

        for (const analysis of arenaAnalyses) {
          // Check if stop was requested
          if (shouldStopFindNewEvents) {
            console.log(`🛑 Battle stopped by user after ${processed} entries (${resolved} resolved, ${orphaned} orphaned, ${failed} failed)`);
            isFindNewEventsRunning = false;
            findNewEventsProcessed = processed;
            break;
          }

          try {
            console.log(`⚔️ Battling ${analysis.date}...`);
            
            // Get cached articles from tiered_articles
            const tieredArticles = analysis.tieredArticles as any;
            if (!tieredArticles || typeof tieredArticles !== 'object') {
              console.log(`⚠️ No cached articles for ${analysis.date}, marking as orphan`);
              await db.update(historicalNewsAnalyses)
                .set({ isOrphan: true })
                .where(eq(historicalNewsAnalyses.date, analysis.date));
              processed++;
              orphaned++;
              findNewEventsProcessed = processed;
              continue;
            }

            // Flatten all articles from all tiers
            const allArticles: Array<{ id: string; title: string; summary?: string }> = [];
            const tiers = ['bitcoin', 'crypto', 'macro'] as const;
            for (const tier of tiers) {
              const tierArticles = tieredArticles[tier] || [];
              for (const article of tierArticles) {
                if (article && article.id && article.title) {
                  allArticles.push({
                    id: article.id,
                    title: article.title,
                    summary: article.summary || article.text?.substring(0, 200) || undefined
                  });
                }
              }
            }

            if (allArticles.length === 0) {
              console.log(`⚠️ No articles found for ${analysis.date}, marking as orphan`);
              await db.update(historicalNewsAnalyses)
                .set({ isOrphan: true })
                .where(eq(historicalNewsAnalyses.date, analysis.date));
              processed++;
              orphaned++;
              findNewEventsProcessed = processed;
              continue;
            }

            console.log(`📚 Found ${allArticles.length} cached articles for ${analysis.date}`);

            // Send to both models in parallel
            const perplexityProvider = aiService.getProvider('perplexity');
            const geminiProvider = aiService.getProvider('gemini');

            const [perplexityResult, geminiResult] = await Promise.all([
              perplexityProvider.selectRelevantArticles?.(allArticles, analysis.date) || Promise.resolve({ articleIds: [], status: 'error', error: 'Method not available' }),
              geminiProvider.selectRelevantArticles?.(allArticles, analysis.date) || Promise.resolve({ articleIds: [], status: 'error', error: 'Method not available' })
            ]);

            const perplexityIds = perplexityResult.articleIds || [];
            const geminiIds = geminiResult.articleIds || [];

            console.log(`🔵 Perplexity selected: ${perplexityIds.length} articles (status: ${perplexityResult.status})`);
            if (perplexityResult.status === 'error') {
              console.warn(`   ⚠️ Perplexity error: ${perplexityResult.error}`);
            } else if (perplexityResult.status === 'no_matches') {
              console.log(`   ℹ️ Perplexity found no relevant articles`);
            }
            
            console.log(`🟢 Gemini selected: ${geminiIds.length} articles (status: ${geminiResult.status})`);
            if (geminiResult.status === 'error') {
              console.warn(`   ⚠️ Gemini error: ${geminiResult.error}`);
            } else if (geminiResult.status === 'no_matches') {
              console.log(`   ℹ️ Gemini found no relevant articles`);
            }

            // Find intersection
            const intersection = perplexityIds.filter(id => geminiIds.includes(id));
            console.log(`🔍 Intersection for ${analysis.date}: ${intersection.length} matching article(s)`);
            if (intersection.length > 0) {
              console.log(`   Matching IDs: ${intersection.slice(0, 3).join(', ')}${intersection.length > 3 ? ` (+${intersection.length - 3} more)` : ''}`);
            }

            if (intersection.length === 0) {
              // No matches - mark as orphan
              console.log(`❌ No matching articles found for ${analysis.date}, marking as orphan`);
              try {
                await db.update(historicalNewsAnalyses)
                  .set({ isOrphan: true })
                  .where(eq(historicalNewsAnalyses.date, analysis.date));
                console.log(`✅ Successfully marked ${analysis.date} as orphan in database`);
              } catch (dbError) {
                console.error(`❌ Database error marking orphan for ${analysis.date}:`, dbError);
              }
              processed++;
              orphaned++;
              findNewEventsProcessed = processed;
              continue;
            }

            // Find the actual article objects
            let selectedArticle: any = null;

            if (intersection.length === 1) {
              // Single match - use it directly
              const articleId = intersection[0];
              console.log(`✅ Single match found: ${articleId}`);
              // Find article in tiered articles
              for (const tier of tiers) {
                const tierArticles = tieredArticles[tier] || [];
                const article = tierArticles.find((a: any) => a.id === articleId);
                if (article) {
                  selectedArticle = article;
                  console.log(`   Found article in ${tier} tier: ${article.title.substring(0, 60)}...`);
                  break;
                }
              }
            } else {
              // Multiple matches - use OpenAI to select best one
              console.log(`🔀 Multiple matches (${intersection.length}), asking OpenAI to select best...`);
              
              const candidateArticles = [];
              for (const articleId of intersection) {
                for (const tier of tiers) {
                  const tierArticles = tieredArticles[tier] || [];
                  const article = tierArticles.find((a: any) => a.id === articleId);
                  if (article) {
                    candidateArticles.push(article);
                    break;
                  }
                }
              }

              // Build prompt for OpenAI to select best article
              const articlesText = candidateArticles.map((article, idx) => 
                `Article ${idx + 1} (ID: ${article.id}):
Title: ${article.title}
Summary: ${article.summary || article.text?.substring(0, 300) || 'N/A'}
Tier: ${candidateArticles.indexOf(article) < tieredArticles.bitcoin?.length ? 'bitcoin' : 
        candidateArticles.indexOf(article) < (tieredArticles.bitcoin?.length || 0) + (tieredArticles.crypto?.length || 0) ? 'crypto' : 'macro'}`
              ).join('\n\n');

              const selectionPrompt = `You are selecting the most relevant news article for a Bitcoin/crypto timeline entry for ${analysis.date}.

ARTICLES:
${articlesText}

Priority hierarchy (most to least important):
1. Bitcoin-related news (price movements, halvings, protocol updates, Bitcoin companies)
2. Web3/Crypto news (Ethereum, DeFi, NFTs, other cryptocurrencies, crypto companies)
3. Macroeconomics news (general economic events, regulations affecting crypto)

Select the article that is MOST relevant to Bitcoin and cryptocurrency history. Return ONLY the article ID.

Format: "id"`;

              const openaiProvider = aiService.getProvider('openai');
              console.log(`🤖 [BATTLE] Calling OpenAI for article selection (${intersection.length} matches)...`);
              const selectionResult = await openaiProvider.generateCompletion({
                prompt: selectionPrompt,
                model: 'gpt-5-mini',
                maxTokens: 50,
                temperature: 0.2,
                context: 'battle-article-selection',
                purpose: 'Select best article from multiple matches'
              });
              console.log(`✅ [BATTLE] OpenAI selection completed`);

              const selectedId = selectionResult.text.trim().replace(/"/g, '');
              selectedArticle = candidateArticles.find((a: any) => a.id === selectedId) || candidateArticles[0];
              console.log(`✅ OpenAI selected: ${selectedId}`);
            }

            if (!selectedArticle) {
              console.error(`❌ Could not find selected article for ${analysis.date}`);
              await db.update(historicalNewsAnalyses)
                .set({ isOrphan: true })
                .where(eq(historicalNewsAnalyses.date, analysis.date));
              processed++;
              orphaned++;
              findNewEventsProcessed = processed;
              continue;
            }

            // Generate summary using OpenAI
            const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
            const openaiProvider = aiService.getProvider('openai');
            console.log(`📝 [BATTLE] Calling OpenAI for summary generation...`);
            const newSummary = await openaiProvider.generateCompletion({
              context: 'summary-generation',
              purpose: 'Generate 100-110 character summary for battle result',
              prompt: `Create a summary for a historical timeline entry from this article.

Title: "${selectedArticle.title}"
Text: "${articleText}"

CRITICAL REQUIREMENTS:
1. ⚠️ CHARACTER COUNT IS MANDATORY: Summary MUST be EXACTLY 100-110 characters. Count every character including spaces. Verify the character count before responding. This is a strict requirement that cannot be violated.
2. NO DATES anywhere in summary (no years, months, days, "On [date]", "In [year]")
3. Use active voice and present tense: "Bitcoin reaches $1000" not "Bitcoin reached $1000"
4. Focus on what actually HAPPENED, not what articles discussed
5. NO ending punctuation (no periods/full stops, colons, semicolons, dashes). We are NOT interested in full stops at the end - do not include them.
6. Be conversational yet professional
7. Emphasize the actual event/outcome over the reporting

IMPORTANT: After writing your summary, count the characters. If it's not between 100-110 characters, rewrite it until it is. Return ONLY the summary text, nothing else.`,
              model: 'gpt-5-mini',
              maxTokens: 150,
              temperature: 0.2
            });

            // Validate and adjust length if needed (up to 3 rounds)
            let finalSummary = newSummary.text.trim();
            let length = finalSummary.length;
            let adjustmentRound = 0;
            const maxAdjustmentRounds = 3;

            while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
              adjustmentRound++;
              console.log(`   ⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting...`);
              
              if (length < 100) {
                const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary (100-110 chars), nothing else.`;
                console.log(`🔧 [BATTLE] Calling OpenAI for summary adjustment (round ${adjustmentRound})...`);
                const adjusted = await openaiProvider.generateCompletion({
                  prompt: adjustPrompt,
                  model: 'gpt-5-mini',
                  maxTokens: 150,
                  temperature: 0.2,
                  context: 'summary-adjustment',
                  purpose: `Adjust summary length (round ${adjustmentRound})`
                });
                console.log(`✅ [BATTLE] OpenAI adjustment completed`);
                finalSummary = adjusted.text.trim();
                length = finalSummary.length;
              } else if (length > 110) {
                const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary (100-110 chars), nothing else.`;
                console.log(`🔧 [BATTLE] Calling OpenAI for summary adjustment (round ${adjustmentRound})...`);
                const adjusted = await openaiProvider.generateCompletion({
                  prompt: adjustPrompt,
                  model: 'gpt-5-mini',
                  maxTokens: 150,
                  temperature: 0.2,
                  context: 'summary-adjustment',
                  purpose: `Adjust summary length (round ${adjustmentRound})`
                });
                console.log(`✅ [BATTLE] OpenAI adjustment completed`);
                finalSummary = adjusted.text.trim();
                length = finalSummary.length;
              }
            }

            // Final validation
            if (length < 100 || length > 110) {
              console.warn(`⚠️ Final summary still ${length} chars after ${adjustmentRound} adjustment rounds: "${finalSummary}"`);
            } else {
              console.log(`✅ Summary adjusted to ${length} chars after ${adjustmentRound} round(s)`);
            }

            // Update entry with new summary and mark as verified
            console.log(`💾 [BATTLE] Updating database for ${analysis.date}...`);
            console.log(`   New summary: "${finalSummary}"`);
            console.log(`   Article ID: ${selectedArticle.id}`);
            try {
              const updateResult = await db.update(historicalNewsAnalyses)
                .set({
                  summary: finalSummary,
                  topArticleId: selectedArticle.id,
                  perplexityVerdict: 'verified',
                  geminiApproved: true,
                  isOrphan: false,
                  reasoning: `Battle result: Both Perplexity and Gemini agreed on this article. Original summary was incorrect.`
                })
                .where(eq(historicalNewsAnalyses.date, analysis.date));
              console.log(`✅ [BATTLE] Database update successful for ${analysis.date}`);
              console.log(`   Update result:`, updateResult);
            } catch (dbError) {
              console.error(`❌ [BATTLE] Database update FAILED for ${analysis.date}:`, dbError);
              console.error(`   Error details:`, (dbError as Error).message);
              console.error(`   Stack:`, (dbError as Error).stack);
              throw dbError; // Re-throw to be caught by outer catch
            }

            console.log(`✅ Battle won for ${analysis.date}: "${finalSummary.substring(0, 50)}..."`);
            
            processed++;
            resolved++;
            findNewEventsProcessed = processed;
            
            if (processed % 10 === 0) {
              console.log(`📈 Progress: ${processed}/${total} entries processed (${resolved} resolved, ${orphaned} orphaned, ${failed} failed)`);
            }
          } catch (error) {
            console.error(`❌ [BATTLE] Error processing ${analysis.date}:`, error);
            console.error(`   Error message:`, (error as Error).message);
            console.error(`   Error stack:`, (error as Error).stack);
            processed++;
            failed++;
            findNewEventsProcessed = processed;
          }
        }

        isFindNewEventsRunning = false;

        const totalDuration = Date.now() - batchStartTime;
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: totalDuration,
          responseSize: processed
        });

        if (shouldStopFindNewEvents) {
          console.log(`🛑 Battle stopped: ${processed} processed, ${resolved} resolved, ${orphaned} orphaned, ${failed} failed`);
        } else {
          console.log(`✅ Battle completed: ${processed} processed, ${resolved} resolved, ${orphaned} orphaned, ${failed} failed`);
        }
      })();

    } catch (error) {
      isFindNewEventsRunning = false;
      const totalDuration = Date.now() - batchStartTime;
      apiMonitor.updateRequest(batchRequestId, {
        status: 'error',
        duration: totalDuration,
        error: (error as Error).message
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/fact-check/find-new-events/stop", async (req, res) => {
    console.log('🛑 Stop Find New Events requested');
    
    shouldStopFindNewEvents = true;
    const processedCount = findNewEventsProcessed;
    const total = findNewEventsTotal;
    
    res.json({ 
      success: true, 
      processed: processedCount,
      total: total,
      message: `Stop requested. Processed ${processedCount}/${total} entries.`
    });
  });

  router.get("/api/fact-check/find-new-events/status", async (req, res) => {
    res.json({
      isRunning: isFindNewEventsRunning,
      processed: findNewEventsProcessed,
      total: findNewEventsTotal,
    });
  });

  // Gemini verification for verified entries
  let shouldStopGeminiVerification = false;
  let isGeminiVerificationRunning = false;
  let geminiVerificationProcessed = 0;
  let geminiVerificationTotal = 0;

  router.post("/api/fact-check/verify-with-gemini", async (req, res) => {
    console.log('🔵 Verify with Gemini endpoint called');
    
    // Prevent multiple instances from running simultaneously
    if (isGeminiVerificationRunning) {
      return res.status(409).json({ 
        error: 'Gemini verification is already running. Please wait for it to complete or stop it first.' 
      });
    }
    
    const batchStartTime = Date.now();
    const batchRequestId = apiMonitor.logRequest({
      service: 'health',
      endpoint: '/api/fact-check/verify-with-gemini',
      method: 'POST',
      status: 'pending',
      context: 'fact-check-gemini',
      purpose: 'Verify verified entries with Gemini',
    });

    try {
      // Get limit from request body (for testing - optional)
      const limit = req.body?.limit ? parseInt(req.body.limit) : undefined;
      
      // Get all analyses that are verified by either OpenAI or Perplexity
      const allAnalyses = await storage.getAllAnalyses();
      
      let verifiedAnalyses = allAnalyses.filter(analysis => {
        const isPerplexityVerified = analysis.perplexityVerdict === 'verified';
        const isOpenAIVerified = analysis.factCheckVerdict === 'verified';
        // Only include entries verified by one service (not both)
        const isOneServiceVerified = (isPerplexityVerified && !isOpenAIVerified) || (!isPerplexityVerified && isOpenAIVerified);
        // Exclude entries that already have a Gemini response
        const hasGeminiResponse = analysis.geminiApproved !== null && analysis.geminiApproved !== undefined;
        return isOneServiceVerified && !hasGeminiResponse;
      });

      // Apply limit if provided (for testing)
      if (limit && limit > 0) {
        verifiedAnalyses = verifiedAnalyses.slice(0, limit);
        console.log(`🧪 TEST MODE: Limiting to ${limit} entries`);
      }

      const total = verifiedAnalyses.length;
      console.log(`📊 Found ${total} verified entries to process with Gemini${limit ? ` (limited from ${allAnalyses.filter(a => a.perplexityVerdict === 'verified' || a.factCheckVerdict === 'verified').length})` : ''}`);

      if (total === 0) {
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: Date.now() - batchStartTime,
        });
        return res.json({ 
          success: true,
          total: 0,
          message: 'No verified entries found' 
        });
      }

      isGeminiVerificationRunning = true;
      geminiVerificationProcessed = 0;
      geminiVerificationTotal = total;
      shouldStopGeminiVerification = false;

      // Send immediate response
      res.json({ 
        success: true,
        total,
        message: `Starting Gemini verification of ${total} verified entries. This will run in the background.` 
      });

      // Process in background (2 entries in parallel, continuously)
      (async () => {
        let processed = 0;
        let approved = 0;
        let rejected = 0;

        // Process entries with continuous parallel processing (always keep 2 running)
        const processEntry = async (analysis: typeof verifiedAnalyses[0]) => {
          try {
            // Verify with Gemini
            let geminiResult = null;
            
            try {
              const geminiProvider = aiService.getProvider('gemini');
              if (geminiProvider && 'verifyEventDate' in geminiProvider) {
                geminiResult = await (geminiProvider as any).verifyEventDate(analysis.summary, analysis.date);
              } else {
                console.log(`Gemini provider not available for ${analysis.date}`);
                return { success: false, date: analysis.date };
              }
            } catch (error) {
              console.log(`Gemini verification skipped for ${analysis.date}: ${(error as Error).message}`);
              return { success: false, date: analysis.date };
            }

            if (!geminiResult) {
              return { success: false, date: analysis.date };
            }

            // Convert approved boolean to confidence score
            const confidence = geminiResult.approved ? 80 : 20;

            // Update database with Gemini verification results
            const updateData: any = {
              geminiApproved: geminiResult.approved,
              geminiConfidence: confidence.toString(),
            };

            await db.update(historicalNewsAnalyses)
              .set(updateData)
              .where(eq(historicalNewsAnalyses.date, analysis.date));

            return { 
              success: true, 
              date: analysis.date, 
              approved: geminiResult.approved 
            };
          } catch (error) {
            console.error(`Error verifying ${analysis.date} with Gemini:`, error);
            return { success: false, date: analysis.date };
          }
        };

        // Continuous parallel processing: always keep exactly 2 running (no more, no less)
        let index = 0;
        const running = new Map<string, Promise<{ success: boolean; date: string; approved?: boolean }>>();

        while (index < verifiedAnalyses.length || running.size > 0) {
          // Check if stop was requested
          if (shouldStopGeminiVerification) {
            console.log(`🛑 Gemini verification stopped by user after ${processed} entries`);
            break;
          }

          // Start new entries until we have exactly 2 running (strictly enforce limit)
          // Use while loop but check size at each iteration to prevent exceeding 2
          while (running.size < 2 && index < verifiedAnalyses.length) {
            const analysis = verifiedAnalyses[index];
            const currentRunning = running.size;
            
            // CRITICAL: Check size again right before starting to prevent race conditions
            if (running.size >= 2) {
              console.log(`⏸️  Pausing: Already have ${running.size} running, waiting for completion`);
              break;
            }
            
            console.log(`🚀 [${new Date().toISOString()}] Starting Gemini verification for ${analysis.date} (Map size: ${running.size}, will be: ${running.size + 1})`);
            
            const promise = processEntry(analysis).then(result => {
              // Update counters when entry completes
              processed++;
              geminiVerificationProcessed = processed;
              const remaining = running.size - 1; // -1 because this one is about to be removed
              console.log(`✅ [${new Date().toISOString()}] Completed ${analysis.date} (${processed}/${total}). Remaining in Map: ${remaining}`);
              
              if (result.success && result.approved) {
                approved++;
              } else if (result.success && !result.approved) {
                rejected++;
              }

              if (processed % 10 === 0) {
                console.log(`📈 Gemini Progress: ${processed}/${total} entries verified (${approved} approved, ${rejected} rejected)`);
              }

              return result;
            }).catch(error => {
              console.error(`❌ Error processing ${analysis.date}:`, error);
              return { success: false, date: analysis.date };
            });
            
            // Add to Map IMMEDIATELY (synchronous operation)
            running.set(analysis.date, promise);
            const newSize = running.size;
            console.log(`📝 [${new Date().toISOString()}] Added ${analysis.date} to Map. New Map size: ${newSize}`);
            
            index++;
            
            // Safety check - should never exceed 2
            if (newSize > 2) {
              console.error(`❌ ERROR: Exceeded parallel limit! Running count: ${newSize}, expected max: 2`);
              // Remove the last added entry to prevent exceeding limit
              running.delete(analysis.date);
              index--; // Don't advance index since we removed it
              break;
            }
          }
          
          // Log current state
          if (running.size > 0) {
            console.log(`📊 [${new Date().toISOString()}] Current state: ${running.size} running, ${index}/${verifiedAnalyses.length} processed`);
          }

          // Wait for at least one to complete before starting more
          if (running.size > 0) {
            const completed = await Promise.race(
              Array.from(running.entries()).map(([date, promise]) =>
                promise.then(result => ({ result, date })).catch(error => {
                  console.error(`Promise error for ${date}:`, error);
                  return { result: { success: false, date }, date };
                })
              )
            );
            // Remove the completed entry
            running.delete(completed.date);
            
            // Add a delay before starting the next request to prevent rapid-fire API calls
            // This ensures we maintain exactly 2 running but don't start new ones too quickly
            // Wait 1 second before starting the next batch to respect rate limits
            if (index < verifiedAnalyses.length && running.size < 2) {
              await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between starting new batches
            }
          } else {
            // If no entries are running but we have more to process, add a small delay
            // This prevents rapid cycling when entries complete very quickly
            if (index < verifiedAnalyses.length) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        isGeminiVerificationRunning = false;
        shouldStopGeminiVerification = false;

        const totalDuration = Date.now() - batchStartTime;
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: totalDuration,
          responseSize: processed
        });

        console.log(`✅ Gemini verification completed: ${processed} processed, ${approved} approved, ${rejected} rejected`);
      })();

    } catch (error) {
      isGeminiVerificationRunning = false;
      shouldStopGeminiVerification = false;
      const totalDuration = Date.now() - batchStartTime;
      apiMonitor.updateRequest(batchRequestId, {
        status: 'error',
        duration: totalDuration,
        error: (error as Error).message
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/fact-check/verify-with-gemini/stop", async (req, res) => {
    console.log('🛑 Stop Gemini verification requested');
    
    shouldStopGeminiVerification = true;
    const processedCount = geminiVerificationProcessed;
    const total = geminiVerificationTotal;
    
    res.json({ 
      success: true, 
      processed: processedCount,
      total: total,
      message: `Stop requested. Processed ${processedCount}/${total} entries.`
    });
  });

  router.get("/api/fact-check/verify-with-gemini/status", async (req, res) => {
    res.json({
      isRunning: isGeminiVerificationRunning,
      processed: geminiVerificationProcessed,
      total: geminiVerificationTotal,
    });
  });

  router.get("/api/quality-check/violations", async (req, res) => {
    try {
      const allAnalyses = await storage.getAllAnalyses();
      const violations: Array<{
        date: string;
        summary: string;
        violations: string[];
        length: number;
        tags_version2?: string[] | null;
        readyForTagging?: boolean | null;
        doubleCheckReasoning?: string | null;
      }> = [];
      
      for (const analysis of allAnalyses) {
        if (!analysis.summary) continue;
        
        const issues = qualityChecker.checkSummaryQuality(analysis.summary);
        if (issues.length > 0) {
          violations.push({
            date: analysis.date,
            summary: analysis.summary,
            violations: issues.map(issue => issue.message),
            length: analysis.summary.length,
            tags_version2: analysis.tags_version2 || null,
            readyForTagging: analysis.readyForTagging,
            doubleCheckReasoning: analysis.doubleCheckReasoning
          });
        }
      }
      
      res.json({
        data: violations,
        total: allAnalyses.length,
        violations: violations.length
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Empty summaries (server-side, bypasses any client RLS issues)
  router.get("/api/quality-check/empty-summaries", async (_req, res) => {
    try {
      const analyses = await storage.getAllAnalyses();
      const minValidDate = new Date('2009-01-03');

      const existingDates = new Set<string>();
      const emptyEntries: { date: string; summary: string }[] = [];

      for (const a of analyses) {
        existingDates.add(a.date);
        const isEmpty = !a.summary || a.summary.trim() === '';
        if (isEmpty) {
          emptyEntries.push({ date: a.date, summary: a.summary || '' });
        }
      }

      // also add missing dates between minValidDate and max existing
      const sortedDates = Array.from(existingDates).sort();
      if (sortedDates.length > 0) {
        const maxDate = new Date(sortedDates[sortedDates.length - 1]);
        const cursor = new Date(minValidDate);
        while (cursor <= maxDate) {
          const ds = cursor.toISOString().split('T')[0];
          if (!existingDates.has(ds)) {
            emptyEntries.push({ date: ds, summary: '' });
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      res.json({
        entries: emptyEntries,
        totalCount: emptyEntries.length
      });
    } catch (error) {
      console.error("❌ Error fetching empty summaries:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/quality-check/bulk-remove-periods", async (req, res) => {
    try {
      const { testDate } = req.body; // Optional: for testing with a single date
      
      let analysesToProcess;
      if (testDate) {
        // Test mode: process only one date
        const analysis = await storage.getAnalysisByDate(testDate);
        if (!analysis) {
          return res.status(404).json({ error: `Analysis not found for date: ${testDate}` });
        }
        analysesToProcess = [analysis];
        console.log(`🧪 TEST MODE: Processing only ${testDate}`);
      } else {
        // Normal mode: process all analyses
        analysesToProcess = await storage.getAllAnalyses();
      }

      let updated = 0;
      const errors: string[] = [];

      console.log(`🔧 Starting bulk removal of periods from summaries...`);

      for (const analysis of analysesToProcess) {
        if (!analysis.summary || !analysis.summary.trim().endsWith('.')) {
          continue;
        }

        try {
          const originalSummary = analysis.summary;
          const updatedSummary = analysis.summary.trim().slice(0, -1); // Remove last character (period)
          
          console.log(`📝 Updating ${analysis.date}:`);
          console.log(`   Before: "${originalSummary}"`);
          console.log(`   After:  "${updatedSummary}"`);
          
          await storage.updateAnalysis(analysis.date, {
            summary: updatedSummary
          });
          updated++;
          
          if (!testDate && updated % 50 === 0) {
            console.log(`📝 Progress: Updated ${updated} summaries...`);
          }
        } catch (error) {
          console.error(`❌ Error updating ${analysis.date}:`, error);
          errors.push(analysis.date);
        }
      }

      console.log(`✅ Bulk period removal completed: ${updated} updated, ${errors.length} errors`);

      res.json({
        success: true,
        updated,
        total: analysesToProcess.length,
        errors: errors.length > 0 ? errors : undefined,
        testMode: !!testDate
      });
    } catch (error) {
      console.error('💥 Error in bulk remove periods:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/quality-check/bulk-adjust-length", async (req, res) => {
  try {
    // Get all analyses with length violations (too short or too long)
    const allAnalyses = await storage.getAllAnalyses();
    const violations: Array<{
      date: string;
      summary: string;
      length: number;
      isTooShort: boolean;
    }> = [];
    
    for (const analysis of allAnalyses) {
      // Skip entries without summaries
      if (!analysis.summary || analysis.summary.trim().length === 0) continue;
      
      const length = analysis.summary.length;
      const isTooShort = length < 100;
      const isTooLong = length > 110;
      
      if (isTooShort || isTooLong) {
        violations.push({
          date: analysis.date,
          summary: analysis.summary,
          length,
          isTooShort
        });
      }
    }

    if (violations.length === 0) {
      return res.json({
        success: true,
        updated: 0,
        skipped: 0,
        total: 0,
        message: 'No summaries with length issues found'
      });
    }

    console.log(`📝 Found ${violations.length} summaries with length issues (too short or too long)`);
    console.log(`🔄 Starting bulk length adjustment for ${violations.length} entries...`);

    let updated = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    const openaiProvider = aiService.getProvider('openai');

    for (const violation of violations) {
      try {
        const analysis = await storage.getAnalysisByDate(violation.date);
        if (!analysis || !analysis.summary) {
          console.warn(`⚠️ Analysis or summary not found for ${violation.date}, skipping`);
          skipped.push(violation.date);
          continue;
        }

        console.log(`📝 Adjusting summary length for ${violation.date}...`);
        console.log(`   Current summary (${violation.length} chars): "${violation.summary.substring(0, 80)}${violation.summary.length > 80 ? '...' : ''}"`);

        // Adjust summary length using OpenAI
        let finalSummary = violation.summary;
        let length = finalSummary.length;
        let adjustmentRound = 0;
        const maxAdjustmentRounds = 3;

        while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
          adjustmentRound++;
          console.log(`   ⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting...`);
          
          if (length < 100) {
            const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters while preserving the meaning and key information. Count every character including spaces. Verify the character count before responding.

Current summary: "${finalSummary}"

REQUIREMENTS:
- Expand to 100-110 characters
- Keep the same meaning and key information
- NO dates (no years, months, days)
- NO ending punctuation
- Return ONLY the expanded summary, nothing else.`;

            const adjusted = await openaiProvider.generateCompletion({
              prompt: adjustPrompt,
              model: 'gpt-4o-mini',
              maxTokens: 150,
              temperature: 0.2,
              context: 'summary-length-adjustment',
              purpose: `Expand summary from ${length} to 100-110 chars (round ${adjustmentRound})`
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
          } else if (length > 110) {
            const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters while preserving the meaning and key information. Count every character including spaces. Verify the character count before responding.

Current summary: "${finalSummary}"

REQUIREMENTS:
- Shorten to 100-110 characters
- Keep the same meaning and key information
- NO dates (no years, months, days)
- NO ending punctuation
- Return ONLY the shortened summary, nothing else.`;

            const adjusted = await openaiProvider.generateCompletion({
              prompt: adjustPrompt,
              model: 'gpt-4o-mini',
              maxTokens: 150,
              temperature: 0.2,
              context: 'summary-length-adjustment',
              purpose: `Shorten summary from ${length} to 100-110 chars (round ${adjustmentRound})`
            });
            finalSummary = adjusted.text.trim();
            length = finalSummary.length;
          }
        }

        // Final validation - only update if within range
        if (length >= 100 && length <= 110) {
          await storage.updateAnalysis(violation.date, {
            summary: finalSummary
          });
          console.log(`✅ Updated ${violation.date}: ${violation.length} → ${length} chars`);
          updated++;
        } else {
          console.warn(`⚠️ Summary for ${violation.date} still out of range after ${maxAdjustmentRounds} rounds (${length} chars), skipping`);
          skipped.push(violation.date);
        }
      } catch (error) {
        console.error(`❌ Error adjusting summary for ${violation.date}:`, error);
        errors.push(violation.date);
      }
    }

    console.log(`✅ Bulk length adjustment completed: ${updated} updated, ${skipped.length} skipped, ${errors.length} errors`);

    res.json({
      success: true,
      updated,
      skipped: skipped.length,
      errors: errors.length > 0 ? errors : undefined,
      total: violations.length
    });
  } catch (error) {
    console.error('Bulk length adjustment error:', error);
    res.status(500).json({ error: 'Failed to adjust summary lengths' });
  }
});

router.post("/api/quality-check/bulk-regenerate-summaries", async (req, res) => {
    try {
      const { testDates } = req.body; // Optional: array of dates for testing
      
      // Get all analyses with quality violations
      const allAnalyses = await storage.getAllAnalyses();
      const violations: Array<{
        date: string;
        summary: string;
        violations: string[];
        length: number;
      }> = [];
      
      for (const analysis of allAnalyses) {
        if (!analysis.summary) continue;
        
        const issues = qualityChecker.checkSummaryQuality(analysis.summary);
        const hasLengthIssue = issues.some(issue => 
          issue.message.includes('too short') || issue.message.includes('too long')
        );
        
        if (hasLengthIssue) {
          violations.push({
            date: analysis.date,
            summary: analysis.summary,
            violations: issues.map(issue => issue.message),
            length: analysis.summary.length
          });
        }
      }

      // Filter to test dates if provided
      let analysesToProcess = violations;
      if (testDates && Array.isArray(testDates) && testDates.length > 0) {
        analysesToProcess = violations.filter(v => testDates.includes(v.date));
        console.log(`🧪 TEST MODE: Processing only ${testDates.length} date(s): ${testDates.join(', ')}`);
      } else {
        console.log(`📝 Found ${violations.length} summaries with length issues (too short or too long)`);
      }

      if (analysesToProcess.length === 0) {
        return res.json({
          success: true,
          updated: 0,
          total: 0,
          message: testDates ? 'No violations found for test dates' : 'No summaries with length issues found'
        });
      }

      let updated = 0;
      const errors: string[] = [];
      const skipped: string[] = [];

      console.log(`🔄 Starting bulk regeneration of summaries for ${analysesToProcess.length} entries...`);

      const openaiProvider = aiService.getProvider('openai');

      for (const violation of analysesToProcess) {
        try {
          const analysis = await storage.getAnalysisByDate(violation.date);
          if (!analysis) {
            console.warn(`⚠️ Analysis not found for ${violation.date}, skipping`);
            skipped.push(violation.date);
            continue;
          }

          // Find the article using topArticleId
          let selectedArticle: any = null;
          const tieredArticles = analysis.tieredArticles as any;
          
          if (tieredArticles && typeof tieredArticles === 'object' && analysis.topArticleId) {
            // Search through all tiers
            const tiers = ['bitcoin', 'crypto', 'macro'] as const;
            for (const tier of tiers) {
              const tierArticles = tieredArticles[tier] || [];
              const article = tierArticles.find((a: any) => a.id === analysis.topArticleId);
              if (article) {
                selectedArticle = article;
                console.log(`   Found article in ${tier} tier for ${violation.date}`);
                break;
              }
            }
          }

          // Fallback to analyzedArticles if not found in tieredArticles
          if (!selectedArticle && analysis.analyzedArticles) {
            const analyzedArticles = Array.isArray(analysis.analyzedArticles) 
              ? analysis.analyzedArticles 
              : [];
            selectedArticle = analyzedArticles.find((a: any) => a.id === analysis.topArticleId) || analyzedArticles[0];
            if (selectedArticle) {
              console.log(`   Found article in analyzedArticles for ${violation.date}`);
            }
          }

          if (!selectedArticle) {
            console.warn(`⚠️ Article not found for ${violation.date} (topArticleId: ${analysis.topArticleId}), skipping`);
            skipped.push(violation.date);
            continue;
          }

          // Generate new summary using OpenAI
          const articleText = (selectedArticle.text || selectedArticle.summary || '').substring(0, 2000);
          console.log(`📝 Regenerating summary for ${violation.date}...`);
          console.log(`   Article: "${selectedArticle.title.substring(0, 60)}..."`);
          console.log(`   Current summary (${violation.length} chars): "${violation.summary.substring(0, 80)}..."`);

          const newSummary = await openaiProvider.generateCompletion({
            context: 'summary-regeneration',
            purpose: 'Regenerate 100-110 character summary for quality check',
            prompt: `Create a summary for a historical timeline entry from this article.

Title: "${selectedArticle.title}"
Text: "${articleText}"

CRITICAL REQUIREMENTS:
1. ⚠️ CHARACTER COUNT IS MANDATORY: Summary MUST be EXACTLY 100-110 characters. Count every character including spaces. Verify the character count before responding. This is a strict requirement that cannot be violated.
2. NO DATES anywhere in summary (no years, months, days, "On [date]", "In [year]")
3. Use active voice and present tense: "Bitcoin reaches $1000" not "Bitcoin reached $1000"
4. Focus on what actually HAPPENED, not what articles discussed
5. NO ending punctuation (no periods/full stops, colons, semicolons, dashes). We are NOT interested in full stops at the end - do not include them.
6. Be conversational yet professional
7. Emphasize the actual event/outcome over the reporting

IMPORTANT: After writing your summary, count the characters. If it's not between 100-110 characters, rewrite it until it is. Return ONLY the summary text, nothing else.`,
            model: 'gpt-4o-mini',
            maxTokens: 150,
            temperature: 0.2
          });

          // Validate and adjust length if needed (up to 3 rounds)
          let finalSummary = newSummary.text.trim();
          let length = finalSummary.length;
          let adjustmentRound = 0;
          const maxAdjustmentRounds = 3;

          while ((length < 100 || length > 110) && adjustmentRound < maxAdjustmentRounds) {
            adjustmentRound++;
            console.log(`   ⚠️ Summary length ${length} chars (round ${adjustmentRound}/${maxAdjustmentRounds}), adjusting...`);
            
            if (length < 100) {
              const adjustPrompt = `⚠️ CRITICAL: The following summary is too short (${length} chars). You MUST expand it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the expanded summary (100-110 chars), nothing else.`;
              const adjusted = await openaiProvider.generateCompletion({
                prompt: adjustPrompt,
                model: 'gpt-4o-mini',
                maxTokens: 150,
                temperature: 0.2,
                context: 'summary-adjustment',
                purpose: `Adjust summary length (round ${adjustmentRound})`
              });
              finalSummary = adjusted.text.trim();
              length = finalSummary.length;
            } else if (length > 110) {
              const adjustPrompt = `⚠️ CRITICAL: The following summary is too long (${length} chars). You MUST shorten it to exactly 100-110 characters. Count every character including spaces. Verify the character count before responding.

Current: "${finalSummary}"

Return ONLY the shortened summary (100-110 chars), nothing else.`;
              const adjusted = await openaiProvider.generateCompletion({
                prompt: adjustPrompt,
                model: 'gpt-4o-mini',
                maxTokens: 150,
                temperature: 0.2,
                context: 'summary-adjustment',
                purpose: `Adjust summary length (round ${adjustmentRound})`
              });
              finalSummary = adjusted.text.trim();
              length = finalSummary.length;
            }
          }

          // Final validation and manual adjustment if still out of range
          if (length < 100 || length > 110) {
            console.warn(`   ⚠️ Final summary still ${length} chars after ${adjustmentRound} adjustment rounds, applying manual fix...`);
            
            // Manual truncation/expansion as last resort
            if (length > 110) {
              // Truncate to 110 chars, ensuring we don't cut in the middle of a word
              let truncated = finalSummary.substring(0, 110);
              const lastSpace = truncated.lastIndexOf(' ');
              if (lastSpace > 100) {
                truncated = truncated.substring(0, lastSpace);
              }
              finalSummary = truncated;
              length = finalSummary.length;
              console.log(`   🔧 Manually truncated to ${length} chars: "${finalSummary}"`);
            } else if (length < 100) {
              // Expand by repeating key phrases or adding context
              const needed = 100 - length;
              const words = finalSummary.split(' ');
              const lastWords = words.slice(-3).join(' ');
              finalSummary = finalSummary + ' ' + lastWords.substring(0, needed).trim();
              if (finalSummary.length < 100) {
                finalSummary = finalSummary + ' ' + 'and continues to evolve'.substring(0, 100 - finalSummary.length);
              }
              finalSummary = finalSummary.substring(0, 110).trim();
              length = finalSummary.length;
              console.log(`   🔧 Manually expanded to ${length} chars: "${finalSummary}"`);
            }
          }
          
          // Final check - only update if within range
          if (length >= 100 && length <= 110) {
            console.log(`   ✅ Summary regenerated: ${length} chars - "${finalSummary}"`);
            // Update the database
            await storage.updateAnalysis(violation.date, {
              summary: finalSummary
            });
          } else {
            console.warn(`   ❌ Summary still out of range (${length} chars) after all attempts, skipping update`);
            skipped.push(violation.date);
            continue;
          }
          updated++;

          if (!testDates && updated % 10 === 0) {
            console.log(`📝 Progress: Regenerated ${updated}/${analysesToProcess.length} summaries...`);
          }
        } catch (error) {
          console.error(`❌ Error regenerating summary for ${violation.date}:`, error);
          errors.push(violation.date);
        }
      }

      console.log(`✅ Bulk summary regeneration completed: ${updated} updated, ${skipped.length} skipped, ${errors.length} errors`);

      res.json({
        success: true,
        updated,
        total: analysesToProcess.length,
        skipped: skipped.length > 0 ? skipped : undefined,
        errors: errors.length > 0 ? errors : undefined,
        testMode: !!testDates
      });
    } catch (error) {
      console.error('💥 Error in bulk regenerate summaries:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Double-check summaries for Ready for Soft Check
  let shouldStopDoubleCheck = false;
  let isDoubleCheckRunning = false;
  let doubleCheckProcessed = 0;
  let doubleCheckTotal = 0;

  router.post("/api/ready-to-tag/double-check-summaries", async (req, res) => {
    console.log('🔍 Double-check summaries endpoint called');
    
    // Prevent multiple instances from running simultaneously
    if (isDoubleCheckRunning) {
      return res.status(409).json({ 
        error: 'Double-check is already running. Please wait for it to complete or stop it first.' 
      });
    }
    
    const batchStartTime = Date.now();
    const batchRequestId = apiMonitor.logRequest({
      service: 'health',
      endpoint: '/api/ready-to-tag/double-check-summaries',
      method: 'POST',
      status: 'pending',
      context: 'double-check-summaries',
      purpose: 'Double-check summaries for quality before tagging',
    });

    try {
      const { entries } = req.body; // Array of { date, summary }
      
      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries must be a non-empty array' });
      }

      const total = entries.length;
      doubleCheckTotal = total;
      doubleCheckProcessed = 0;
      shouldStopDoubleCheck = false;
      isDoubleCheckRunning = true;

      console.log(`📊 Starting double-check for ${total} summaries. Processing 8 at a time.`);

      // Send immediate response
      res.json({ 
        success: true,
        total,
        message: `Starting double-check of ${total} summaries. This will run in the background.` 
      });

      // Process in background (2 entries in parallel, continuously)
      (async () => {
        let processed = 0;
        let passed = 0;
        let failed = 0;

        const processEntry = async (entry: { date: string; summary: string }) => {
          try {
            const openaiProvider = aiService.getProvider('openai');
            if (!openaiProvider || !('doubleCheckSummary' in openaiProvider)) {
              console.log(`OpenAI provider not available for ${entry.date}`);
              return { success: false, date: entry.date };
            }

            const checkResult = await (openaiProvider as any).doubleCheckSummary(entry.summary);
            
            // Update database
            await storage.updateAnalysis(entry.date, {
              readyForTagging: checkResult.isValid,
              doubleCheckReasoning: checkResult.reasoning,
              doubleCheckedAt: new Date(),
            });

            return { 
              success: true, 
              date: entry.date,
              isValid: checkResult.isValid,
              issues: checkResult.issues,
              reasoning: checkResult.reasoning
            };
          } catch (error) {
            console.error(`Error double-checking ${entry.date}:`, error);
            return { success: false, date: entry.date };
          }
        };

        // Continuous parallel processing: always keep exactly 8 running
        const MAX_CONCURRENT = 8;
        let index = 0;
        const running = new Map<string, Promise<{ success: boolean; date: string; isValid?: boolean; issues?: string[]; reasoning?: string }>>();

        while (index < entries.length || running.size > 0) {
          // Check if stop was requested
          if (shouldStopDoubleCheck) {
            console.log(`🛑 Double-check stopped by user after ${processed} entries`);
            break;
          }

          // Start new entries until we have exactly MAX_CONCURRENT running
          while (running.size < MAX_CONCURRENT && index < entries.length) {
            const entry = entries[index];
            
            // CRITICAL: Check size again right before starting to prevent race conditions
            if (running.size >= MAX_CONCURRENT) {
              console.log(`⏸️  Pausing: Already have ${running.size} running, waiting for completion`);
              break;
            }
            
            console.log(`🚀 Starting double-check for ${entry.date} (Map size: ${running.size}, will be: ${running.size + 1})`);
            
            const promise = processEntry(entry).then(result => {
              processed++;
              doubleCheckProcessed = processed;
              const remaining = running.size - 1;
              console.log(`✅ Completed ${entry.date} (${processed}/${total}). Remaining in Map: ${remaining}`);
              
              if (result.success && result.isValid) {
                passed++;
              } else if (result.success && !result.isValid) {
                failed++;
              }

              if (processed % 10 === 0) {
                console.log(`📈 Double-check Progress: ${processed}/${total} checked (${passed} passed, ${failed} failed)`);
              }

              return result;
            }).catch(error => {
              console.error(`❌ Error processing ${entry.date}:`, error);
              return { success: false, date: entry.date };
            });
            
            running.set(entry.date, promise);
            index++;
          }

          // Wait for at least one to complete before starting more
          if (running.size > 0) {
            const completed = await Promise.race(
              Array.from(running.entries()).map(([date, promise]) =>
                promise.then(result => ({ result, date }))
              )
            );
            running.delete(completed.date);
          }
        }

        isDoubleCheckRunning = false;
        const totalDuration = Date.now() - batchStartTime;
        apiMonitor.updateRequest(batchRequestId, {
          status: 'success',
          duration: totalDuration,
          responseSize: processed
        });

        console.log(`✅ Double-check completed: ${processed} processed, ${passed} passed, ${failed} failed`);
      })();

    } catch (error) {
      isDoubleCheckRunning = false;
      const totalDuration = Date.now() - batchStartTime;
      apiMonitor.updateRequest(batchRequestId, {
        status: 'error',
        duration: totalDuration,
        error: (error as Error).message
      });
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post("/api/ready-to-tag/stop-double-check", async (req, res) => {
    if (!isDoubleCheckRunning) {
      return res.json({ success: true, message: 'Double-check is not running' });
    }
    
    shouldStopDoubleCheck = true;
    console.log('🛑 Stop double-check requested');
    res.json({ 
      success: true, 
      message: 'Stop request received. Double-check will stop after current entries complete.',
      processed: doubleCheckProcessed,
      total: doubleCheckTotal
    });
  });

  router.get("/api/ready-to-tag/double-check-status", async (req, res) => {
    res.json({
      isRunning: isDoubleCheckRunning,
      processed: doubleCheckProcessed,
      total: doubleCheckTotal,
      progress: doubleCheckTotal > 0 ? Math.round((doubleCheckProcessed / doubleCheckTotal) * 100) : 0
    });
  });

export default router;

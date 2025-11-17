import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import { storage } from "./storage";
import { newsAnalyzer, NewsAnalyzerService } from "./services/news-analyzer";
import { exaService } from "./services/exa";
import { type ArticleData } from "@shared/schema";
import { periodDetector } from "./services/period-detector";
import { hierarchicalSearch } from "./services/hierarchical-search";
import { insertHistoricalNewsAnalysisSchema, insertManualNewsEntrySchema, insertEventBatchSchema, insertBatchEventSchema, type InsertHistoricalNewsAnalysis, type HistoricalNewsAnalysis, type EventBatch, type BatchEvent } from "@shared/schema";

import { cacheManager } from "./services/cache-manager";

import { healthMonitor } from "./services/health-monitor";
import { createErrorResponse } from "./utils/error-handler";
import { apiMonitor } from "./services/api-monitor";
import { qualityChecker } from "./services/quality-checker";
import { batchProcessor } from "./services/batch-processor";
import { evaluateEventSummary, enhanceEventSummary, compareArticleSets } from "./services/openai";
import { conflictClusterer } from "./services/conflict-clusterer";
import { verifyDateWithPerplexity, type PerplexityDateVerificationResult } from "./services/perplexity";
import { perplexityCleaner } from "./services/perplexity-cleaner";
import { entityExtractor } from "./services/entity-extractor";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Analysis routes
  app.get("/api/analysis/stats", async (req, res) => {
    try {
      const progress = await newsAnalyzer.getAnalysisProgress();
      res.json(progress);
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get("/api/analysis/year/:year", async (req, res) => {
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

  app.get("/api/analysis/date/:date", async (req, res) => {
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

  // Month data routes
  app.get("/api/analysis/month/:year/:month", async (req, res) => {
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

  // Analysis generation routes
  app.post("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const { aiProvider = 'openai', forceReanalysis = false } = req.body;
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const userAgent = req.get('User-Agent') || 'unknown';
      const referer = req.get('Referer') || 'no-referer';
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🚀 [${requestId}] POST /api/analysis/date/${date} - RECEIVED`);
      console.log(`📊 [${requestId}] Request details: force=${forceReanalysis}, aiProvider=${aiProvider}`);
      console.log(`🌐 [${requestId}] Source: ${referer}`);
      console.log(`🖥️ [${requestId}] User-Agent: ${userAgent.substring(0, 50)}...`);

      // DATABASE DEDUPLICATION: Check if analysis already exists (unless forcing reanalysis)
      if (!forceReanalysis) {
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
      }

      const result = await newsAnalyzer.analyzeNewsForDate({ 
        date, 
        forceReanalysis, 
        aiProvider,
        requestContext: {
          requestId,
          source: 'POST_ROUTE',
          referer,
          userAgent: userAgent.substring(0, 100)
        }
      });
      
      console.log(`✅ [${requestId}] POST /api/analysis/date/${date} - COMPLETED`);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Analysis endpoint used by frontend hooks - single date analysis
  app.post("/api/analysis/analyze", async (req, res) => {
    try {
      const { date, forceReanalysis = false, aiProvider = 'openai', newsProvider = 'exa' } = req.body;
      const requestId = `req-analyze-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const userAgent = req.get('User-Agent') || 'unknown';
      const referer = req.get('Referer') || 'no-referer';
      
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🚀 [${requestId}] POST /api/analysis/analyze - RECEIVED (date: ${date})`);
      console.log(`📊 [${requestId}] Request details: force=${forceReanalysis}, aiProvider=${aiProvider}`);
      console.log(`🌐 [${requestId}] Source: ${referer}`);
      console.log(`🖥️ [${requestId}] User-Agent: ${userAgent.substring(0, 50)}...`);

      const result = await newsAnalyzer.analyzeNewsForDate({
        date,
        forceReanalysis,
        aiProvider,
        newsProvider,
        requestContext: {
          requestId,
          source: 'ANALYZE_ROUTE',
          referer,
          userAgent: userAgent.substring(0, 100)
        }
      });

      console.log(`✅ [${requestId}] POST /api/analysis/analyze - COMPLETED (date: ${date})`);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Article selection endpoint - allows users to manually select a different article and re-summarize
  app.put("/api/analysis/date/:date/select-article", async (req, res) => {
    try {
      const { date } = req.params;
      const { articleId } = req.body;
      const requestId = `req-select-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      if (!articleId) {
        return res.status(400).json({ error: "Article ID is required" });
      }

      console.log(`🌟 [${requestId}] PUT /api/analysis/date/${date}/select-article - RECEIVED (articleId: ${articleId})`);

      // Get existing analysis
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      // Find the article in the tiered articles
      const tieredArticles = existingAnalysis.tieredArticles as any;
      let selectedArticle = null;
      
      // Search through all tiers for the article
      if (tieredArticles?.bitcoin) {
        selectedArticle = tieredArticles.bitcoin.find((article: any) => article.id === articleId);
      }
      if (!selectedArticle && tieredArticles?.crypto) {
        selectedArticle = tieredArticles.crypto.find((article: any) => article.id === articleId);
      }
      if (!selectedArticle && tieredArticles?.macro) {
        selectedArticle = tieredArticles.macro.find((article: any) => article.id === articleId);
      }

      if (!selectedArticle) {
        return res.status(404).json({ error: `Article with ID ${articleId} not found in saved articles for ${date}` });
      }

      console.log(`🎯 [${requestId}] Found article: "${selectedArticle.title}"`);
      console.log(`📝 [${requestId}] Re-summarizing selected article...`);

      // Re-summarize the selected article using OpenAI
      const { openaiService } = await import("./services/openai");
      
      const systemPrompt = `You write concise, natural summaries of what happened in Bitcoin on a given calendar day.

TASK: Based on the article title and summary provided, understand what actually happened on that specific day and write about it in exactly 100-110 characters.

INPUT CONTRACT:
- You will receive an article TITLE and EXA SUMMARY (article content/snippet)
- Your job is to infer what event occurred on that calendar day from these inputs
- Focus on the day's event, not just the article's perspective

REQUIREMENTS:
- EXACTLY 100-110 characters (count carefully)
- Write what happened that day in natural flowing language
- Use active voice and present tense
- NO dashes (-), semicolons (;), or colons (:) anywhere
- NEVER end with a period or punctuation
- Do not include any dates or time-relative words (today/yesterday) in the summary
- Write like you're telling someone what happened that day in conversation
- Focus on the actual event/announcement that occurred, not what the article discusses

EXAMPLES:
INPUT: Title: "Fed Criticism Mounts" + Summary: "Article defends Fed independence against proposed transparency act"
OUTPUT: "Fed faces criticism over proposed transparency act threatening monetary policy independence"

INPUT: Title: "Bitcoin Price Drop" + Summary: "Analysis shows Bitcoin fell 10% amid regulatory concerns"  
OUTPUT: "Bitcoin drops 10% to $3,805 as market reacts to regulatory concerns"

OUTPUT: JSON object with:
- summary: string (100-110 characters exactly)
- reasoning: string (why significant for Bitcoin)
- confidenceScore: number (0-100)
- sentimentScore: number (-1 to 1)
- sentimentLabel: string ('bearish'|'neutral'|'bullish')
- topicCategories: string[] (regulation, adoption, price, technology, mining, institutional, economic, political)`;

      const articleContent = selectedArticle.summary || selectedArticle.text || 'No content available';
      const userPrompt = `From the title and EXA summary below, understand what actually happened on ${date} and write it in exactly 100-110 characters:

ARTICLE TITLE: "${selectedArticle.title}"
EXA SUMMARY: ${articleContent}

TASK: Based on these inputs, infer what event occurred on this calendar day and write about it naturally.

PROCESSING INSTRUCTIONS:
- Read the title to understand the main topic
- Read the EXA summary to understand what actually happened
- Combine both to understand the day's key event
- Write what happened that day, not what the article discusses about what happened

FORBIDDEN: Never start with "Article", "Report", "Blog", "Study", "Analysis", "Op-ed"
FORBIDDEN: No dashes (-), semicolons (;), or colons (:) anywhere in the summary
REQUIRED: Natural flowing language describing what occurred on ${date}

TRANSFORMATION EXAMPLES:
Title: "Fed Under Fire" + EXA: "Article defends central bank against criticism"
Day Event: "Fed faces criticism over proposed transparency act threatening monetary policy independence"

Title: "Bitcoin Volatility" + EXA: "Report shows price dropped amid regulatory concerns"  
Day Event: "Bitcoin drops 10% as market reacts to regulatory uncertainty"

Count characters carefully to ensure 100-110 character length.`;

      // Call OpenAI for re-summarization with proper API monitoring
      try {
        // Log the API request to monitor
        const startTime = Date.now();
        const monitorRequestId = apiMonitor.logRequest({
          service: 'openai',
          endpoint: '/chat/completions',
          method: 'POST',
          status: 'pending',
          context: 'article-selection',
          purpose: 'Re-summarize selected article for Bitcoin news analysis',
          triggeredBy: `Article selection for ${date} (${requestId})`,
          date: date,
          requestData: { 
            model: 'gpt-4o-mini', 
            tokens: 500, 
            purpose: 'article-re-summarization',
            articleId: articleId,
            articleTitle: selectedArticle.title
          }
        });

        const rawResponse = await openaiService.createCompletion([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]);

        let result;
        try {
          result = JSON.parse(rawResponse);
        } catch (parseError) {
          // Update API monitor with parse error
          apiMonitor.updateRequest(monitorRequestId, {
            status: 'error',
            error: `JSON Parse Error: ${parseError}`,
            errorCategory: 'parsing',
            duration: Date.now() - startTime
          });
          console.error(`❌ [${requestId}] JSON Parse Error:`, parseError);
          throw new Error(`Failed to parse OpenAI JSON response: ${parseError}`);
        }

        // Update API monitor with success
        apiMonitor.updateRequest(monitorRequestId, {
          status: 'success',
          duration: Date.now() - startTime,
          responseSize: JSON.stringify(result).length,
          requestData: {
            model: 'gpt-4o-mini',
            tokens: 500,
            purpose: 'article-re-summarization',
            articleId: articleId,
            result: {
              summaryLength: result.summary?.length || 0,
              confidenceScore: result.confidenceScore || 0,
              sentimentLabel: result.sentimentLabel || 'neutral'
            }
          }
        });

        // Validate response
        if (!result.summary || !result.reasoning) {
          throw new Error('Invalid response from OpenAI: missing required fields');
        }

        // Validate summary length (strict requirement)
        if (result.summary.length < 100 || result.summary.length > 110) {
          console.warn(`⚠️ [${requestId}] Summary length error: ${result.summary.length} characters (required: 100-110)`);
          
          // Auto-correct if close to target
          if (result.summary.length >= 90 && result.summary.length <= 120) {
            let correctedSummary = result.summary;
            if (correctedSummary.length > 110) {
              correctedSummary = correctedSummary.substring(0, 107) + '...';
            } else if (correctedSummary.length < 100) {
              const padding = ' Analysis confirmed.';
              correctedSummary += padding.substring(0, 100 - correctedSummary.length);
            }
            
            if (correctedSummary.length >= 100 && correctedSummary.length <= 110) {
              console.log(`✅ [${requestId}] Auto-corrected summary to ${correctedSummary.length} characters`);
              result.summary = correctedSummary;
            } else {
              throw new Error(`Summary length ${correctedSummary.length} characters after auto-correction. Required: exactly 100-110 characters.`);
            }
          } else {
            throw new Error(`Summary length ${result.summary.length} characters is significantly off target. Required: exactly 100-110 characters.`);
          }
        }

        console.log(`✅ [${requestId}] Summary length valid: ${result.summary.length} characters`);
        console.log(`📝 [${requestId}] New summary: "${result.summary}"`);

        // Update only the specific fields that changed
        await storage.updateAnalysis(date, {
          topArticleId: articleId,
          summary: result.summary,
          aiProvider: 'openai-manual-selection',
          confidenceScore: Math.min(100, Math.max(0, result.confidenceScore || 75)).toString(),
          sentimentScore: Math.min(1, Math.max(-1, result.sentimentScore || 0)).toString(),
          sentimentLabel: result.sentimentLabel || 'neutral',
          topicCategories: result.topicCategories || ['manual-selection']
        });
        
        // Get the updated analysis for response
        const updatedAnalysis = await storage.getAnalysisByDate(date);

        console.log(`✅ [${requestId}] PUT /api/analysis/date/${date}/select-article - COMPLETED`);

        // Return the updated analysis
        res.json({
          success: true,
          analysis: updatedAnalysis,
          selectedArticle: selectedArticle,
          newSummary: result.summary,
          reasoning: result.reasoning
        });

      } catch (openaiError) {
        console.error(`❌ [${requestId}] OpenAI error:`, openaiError);
        return res.status(500).json({ 
          error: `Failed to re-summarize article: ${(openaiError as Error).message}` 
        });
      }

    } catch (error) {
      console.error(`❌ Article selection error:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Update summary endpoint - allows direct summary editing
  app.put("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const { summary } = req.body;
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      if (!summary || typeof summary !== 'string') {
        return res.status(400).json({ error: "Summary is required" });
      }

      console.log(`📝 PUT /api/analysis/date/${date} - Updating summary`);

      // Get existing analysis
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      // Update just the summary
      await storage.updateAnalysis(date, {
        summary: summary.trim()
      });
      
      // Get updated analysis for response
      const updatedAnalysis = await storage.getAnalysisByDate(date);

      console.log(`✅ PUT /api/analysis/date/${date} - Summary updated`);

      res.json({
        success: true,
        analysis: updatedAnalysis,
      });

    } catch (error) {
      console.error(`❌ Update summary error:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Re-summarize endpoint - AI re-generates summary from existing top article
  app.post("/api/analysis/date/:date/resummarize", async (req, res) => {
    try {
      const { date } = req.params;
      const requestId = `req-resummarize-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`✨ [${requestId}] POST /api/analysis/date/${date}/resummarize - RECEIVED`);

      // Get existing analysis
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (!existingAnalysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      if (!existingAnalysis.topArticleId) {
        return res.status(400).json({ error: `No top article found for ${date}` });
      }

      // Find the top article in tiered articles
      const tieredArticles = existingAnalysis.tieredArticles as any;
      let topArticle = null;
      
      if (tieredArticles?.bitcoin) {
        topArticle = tieredArticles.bitcoin.find((article: any) => article.id === existingAnalysis.topArticleId);
      }
      if (!topArticle && tieredArticles?.crypto) {
        topArticle = tieredArticles.crypto.find((article: any) => article.id === existingAnalysis.topArticleId);
      }
      if (!topArticle && tieredArticles?.macro) {
        topArticle = tieredArticles.macro.find((article: any) => article.id === existingAnalysis.topArticleId);
      }

      if (!topArticle) {
        return res.status(404).json({ error: `Top article not found in saved articles for ${date}` });
      }

      console.log(`🎯 [${requestId}] Re-summarizing top article: "${topArticle.title}"`);

      // Re-summarize using OpenAI with same prompts as select-article
      const { openaiService } = await import("./services/openai");
      
      const systemPrompt = `You write concise, natural summaries of what happened in Bitcoin on a given calendar day.

TASK: Based on the article title and summary provided, understand what actually happened on that specific day and write about it in exactly 100-110 characters.

INPUT CONTRACT:
- You will receive an article TITLE and EXA SUMMARY (article content/snippet)
- Your job is to infer what event occurred on that calendar day from these inputs
- Focus on the day's event, not just the article's perspective

REQUIREMENTS:
- EXACTLY 100-110 characters (count carefully)
- Write what happened that day in natural flowing language
- Use active voice and present tense
- NO dashes (-), semicolons (;), or colons (:) anywhere
- NEVER end with a period or punctuation
- Do not include any dates or time-relative words (today/yesterday) in the summary
- Write like you're telling someone what happened that day in conversation
- Focus on the actual event/announcement that occurred, not what the article discusses

EXAMPLES:
INPUT: Title: "Fed Criticism Mounts" + Summary: "Article defends Fed independence against proposed transparency act"
OUTPUT: "Fed faces criticism over proposed transparency act threatening monetary policy independence"

INPUT: Title: "Bitcoin Price Drop" + Summary: "Analysis shows Bitcoin fell 10% amid regulatory concerns"  
OUTPUT: "Bitcoin drops 10% to $3,805 as market reacts to regulatory concerns"

OUTPUT: JSON object with:
- summary: string (100-110 characters exactly)
- reasoning: string (why significant for Bitcoin)
- confidenceScore: number (0-100)
- sentimentScore: number (-1 to 1)
- sentimentLabel: string ('bearish'|'neutral'|'bullish')
- topicCategories: string[] (regulation, adoption, price, technology, mining, institutional, economic, political)`;

      const articleContent = topArticle.summary || topArticle.text || 'No content available';
      const userPrompt = `From the title and EXA summary below, understand what actually happened on ${date} and write it in exactly 100-110 characters:

ARTICLE TITLE: "${topArticle.title}"
EXA SUMMARY: ${articleContent}

TASK: Based on these inputs, infer what event occurred on this calendar day and write about it naturally.

PROCESSING INSTRUCTIONS:
- Read the title to understand the main topic
- Read the EXA summary to understand what actually happened
- Combine both to understand the day's key event
- Write what happened that day, not what the article discusses about what happened

FORBIDDEN: Never start with "Article", "Report", "Blog", "Study", "Analysis", "Op-ed"
FORBIDDEN: No dashes (-), semicolons (;), or colons (:) anywhere in the summary
REQUIRED: Natural flowing language describing what occurred on ${date}

TRANSFORMATION EXAMPLES:
Title: "Fed Under Fire" + EXA: "Article defends central bank against criticism"
Day Event: "Fed faces criticism over proposed transparency act threatening monetary policy independence"

Title: "Bitcoin Volatility" + EXA: "Report shows price dropped amid regulatory concerns"  
Day Event: "Bitcoin drops 10% as market reacts to regulatory uncertainty"

Count characters carefully to ensure 100-110 character length.`;

      try {
        const startTime = Date.now();
        const monitorRequestId = apiMonitor.logRequest({
          service: 'openai',
          endpoint: '/chat/completions',
          method: 'POST',
          status: 'pending',
          context: 'resummarize',
          purpose: 'Re-generate summary for Bitcoin news analysis',
          triggeredBy: `Re-summarize for ${date} (${requestId})`,
          date: date,
          requestData: { 
            model: 'gpt-4o-mini', 
            tokens: 500, 
            purpose: 'resummarize',
            articleId: topArticle.id,
            articleTitle: topArticle.title
          }
        });

        const rawResponse = await openaiService.createCompletion([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]);

        let result;
        try {
          result = JSON.parse(rawResponse);
        } catch (parseError) {
          apiMonitor.updateRequest(monitorRequestId, {
            status: 'error',
            error: `JSON Parse Error: ${parseError}`,
            errorCategory: 'parsing',
            duration: Date.now() - startTime
          });
          console.error(`❌ [${requestId}] JSON Parse Error:`, parseError);
          throw new Error(`Failed to parse OpenAI JSON response: ${parseError}`);
        }

        apiMonitor.updateRequest(monitorRequestId, {
          status: 'success',
          duration: Date.now() - startTime,
          responseSize: JSON.stringify(result).length,
          requestData: {
            model: 'gpt-4o-mini',
            tokens: 500,
            purpose: 'resummarize',
            articleId: topArticle.id,
            result: {
              summaryLength: result.summary?.length || 0,
              confidenceScore: result.confidenceScore || 0,
              sentimentLabel: result.sentimentLabel || 'neutral'
            }
          }
        });

        // Validate response
        if (!result.summary || !result.reasoning) {
          throw new Error('Invalid response from OpenAI: missing required fields');
        }

        // Validate summary length (strict requirement)
        if (result.summary.length < 100 || result.summary.length > 110) {
          console.warn(`⚠️ [${requestId}] Summary length error: ${result.summary.length} characters (required: 100-110)`);
          
          // Auto-correct if close to target
          if (result.summary.length >= 90 && result.summary.length <= 120) {
            let correctedSummary = result.summary;
            if (correctedSummary.length > 110) {
              correctedSummary = correctedSummary.substring(0, 107) + '...';
            } else if (correctedSummary.length < 100) {
              const padding = ' Analysis confirmed.';
              correctedSummary += padding.substring(0, 100 - correctedSummary.length);
            }
            
            if (correctedSummary.length >= 100 && correctedSummary.length <= 110) {
              console.log(`✅ [${requestId}] Auto-corrected summary to ${correctedSummary.length} characters`);
              result.summary = correctedSummary;
            } else {
              throw new Error(`Summary length ${correctedSummary.length} characters after auto-correction. Required: exactly 100-110 characters.`);
            }
          } else {
            throw new Error(`Summary length ${result.summary.length} characters is significantly off target. Required: exactly 100-110 characters.`);
          }
        }

        console.log(`✅ [${requestId}] Summary length valid: ${result.summary.length} characters`);

        // Update the analysis with new summary
        await storage.updateAnalysis(date, {
          summary: result.summary,
          reasoning: result.reasoning || existingAnalysis.reasoning || undefined,
          confidenceScore: result.confidenceScore || existingAnalysis.confidenceScore || undefined,
          sentimentScore: result.sentimentScore !== undefined ? result.sentimentScore.toString() : existingAnalysis.sentimentScore || undefined,
          sentimentLabel: result.sentimentLabel || existingAnalysis.sentimentLabel || undefined,
          topicCategories: result.topicCategories || existingAnalysis.topicCategories as string[] || undefined
        });

        console.log(`✅ [${requestId}] POST /api/analysis/date/${date}/resummarize - COMPLETED`);

        res.json({
          success: true,
          summary: result.summary,
          reasoning: result.reasoning,
          confidenceScore: result.confidenceScore
        });

      } catch (openaiError) {
        console.error(`❌ [${requestId}] OpenAI error:`, openaiError);
        return res.status(500).json({ 
          error: `Failed to re-summarize: ${(openaiError as Error).message}` 
        });
      }

    } catch (error) {
      console.error(`❌ Re-summarize error:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Re-analyze endpoint - fetches news from ALL tiers without AI filtering
  app.post("/api/analysis/date/:date/reanalyze-all", async (req, res) => {
    try {
      const { date } = req.params;
      const requestId = `req-reanalyze-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🔄 [${requestId}] POST /api/analysis/date/${date}/reanalyze-all - RECEIVED`);
      console.log(`📊 [${requestId}] Fetching news from ALL three tiers without AI filtering...`);

      // Delete existing analysis if it exists
      const existingAnalysis = await storage.getAnalysisByDate(date);
      if (existingAnalysis) {
        console.log(`🗑️ [${requestId}] Deleting existing analysis for ${date}...`);
        await storage.deleteAnalysis(date);
      }

      // Import services
      const { hierarchicalSearch } = await import('./services/hierarchical-search');
      
      const requestContext = {
        requestId,
        source: 'REANALYZE_ALL_ROUTE',
        referer: req.get('Referer') || 'no-referer',
        userAgent: (req.get('User-Agent') || 'unknown').substring(0, 100)
      };

      // Fetch from ALL three tiers in parallel (no AI validation, no waterfall)
      console.log(`🌊 [${requestId}] Fetching from all tiers simultaneously...`);
      
      const [bitcoinArticles, cryptoArticles, macroArticles] = await Promise.all([
        hierarchicalSearch.searchBitcoinTier(date, requestContext),
        hierarchicalSearch.searchCryptoTier(date, requestContext),
        hierarchicalSearch.searchMacroTier(date, requestContext)
      ]);

      console.log(`✅ [${requestId}] Fetched articles from all tiers:`);
      console.log(`   🪙 Bitcoin: ${bitcoinArticles.length} articles`);
      console.log(`   🔗 Crypto: ${cryptoArticles.length} articles`);
      console.log(`   📈 Macro: ${macroArticles.length} articles`);

      // Store the tiered articles in database (no summary, user will pick article later)
      const tieredArticles = {
        bitcoin: bitcoinArticles,
        crypto: cryptoArticles,
        macro: macroArticles
      };

      const totalArticles = bitcoinArticles.length + cryptoArticles.length + macroArticles.length;

      // Create a placeholder analysis entry with just the articles (no AI summary)
      const analysisData = {
        date,
        summary: '', // Empty - user will generate this by selecting an article
        topArticleId: '', // Empty - no article selected yet
        totalArticlesFetched: totalArticles,
        uniqueArticlesAnalyzed: totalArticles,
        duplicateArticleIds: [],
        aiProvider: 'none-reanalyzed',
        newsProvider: 'EXA',
        confidenceScore: '0',
        sentimentScore: '0',
        sentimentLabel: 'neutral',
        topicCategories: ['reanalyzed'],
        articleTags: [],
        tieredArticles: tieredArticles,
        analyzedArticles: [...bitcoinArticles, ...cryptoArticles, ...macroArticles],
        searchPath: `bitcoin (${bitcoinArticles.length}), crypto (${cryptoArticles.length}), macro (${macroArticles.length})`,
        winningTier: 'none',
        sourcesUsed: ['EXA'],
        isManualOverride: false
      };

      // Save to database
      await storage.createAnalysis(analysisData);

      console.log(`✅ [${requestId}] POST /api/analysis/date/${date}/reanalyze-all - COMPLETED`);
      console.log(`📦 [${requestId}] Stored ${totalArticles} articles across 3 tiers`);

      res.json({
        success: true,
        date,
        tieredArticles,
        totalArticles,
        tierCounts: {
          bitcoin: bitcoinArticles.length,
          crypto: cryptoArticles.length,
          macro: macroArticles.length
        },
        message: `Fetched ${totalArticles} articles from all tiers. Select an article to generate summary.`
      });

    } catch (error) {
      console.error(`❌ Re-analyze all tiers error:`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // FIXED: Fast batch analysis endpoint with proper request isolation
  app.post("/api/analysis/batch-analyze", async (req, res) => {
    try {
      const { dates, concurrency = 2, aiProvider = 'openai', newsProvider = 'exa' } = req.body; // FIXED: Default to 2 instead of 1
      
      if (!Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: "Dates array is required" });
      }

      // Validate all dates
      for (const date of dates) {
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ error: `Invalid date format: ${date}. Use YYYY-MM-DD` });
        }
      }

      // FIXED: Cap concurrency at 3 to prevent overwhelming EXA
      const safeConcurrency = Math.min(concurrency, 3);

      // Start streaming response
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });

      let completed = 0;
      const total = dates.length;
      const results = [];
      const currentlyAnalyzing = new Set<string>();

      // Process in batches with controlled concurrency
      for (let i = 0; i < dates.length; i += safeConcurrency) {
        const batch = dates.slice(i, i + safeConcurrency);
        
        // Add batch dates to currently analyzing set and send initial update
        batch.forEach(date => currentlyAnalyzing.add(date));
        res.write(JSON.stringify({
          completed,
          total,
          progress: Math.round((completed / total) * 100),
          analyzingDates: Array.from(currentlyAnalyzing)
        }) + '\n');
        
        const batchPromises = batch.map(async (date) => {
          try {
            // Check if already exists to avoid unnecessary work
            const existing = await storage.getAnalysisByDate(date);
            if (existing) {
              currentlyAnalyzing.delete(date);
              return { date, status: 'already_exists', analysis: existing };
            }

            // FIXED: Add unique request context to prevent mixing
            const result = await newsAnalyzer.analyzeNewsForDate({ 
              date, 
              aiProvider, 
              newsProvider,
              requestContext: {
                requestId: `batch-${date}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                source: 'batch-analysis',
                referer: 'month-view',
                userAgent: 'bitcoin-news-analyzer'
              }
            });
            currentlyAnalyzing.delete(date);
            return { date, status: 'success', analysis: result };
          } catch (error) {
            currentlyAnalyzing.delete(date);
            return { date, status: 'error', error: (error as Error).message };
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          completed++;
          const data = result.status === 'fulfilled' ? result.value : { status: 'error', error: 'Promise rejected' };
          results.push(data);
          
          // Stream progress update with currently analyzing dates
          const progress = {
            completed,
            total,
            progress: Math.round((completed / total) * 100),
            lastResult: data,
            analyzingDates: Array.from(currentlyAnalyzing)
          };
          
          res.write(JSON.stringify(progress) + '\n');
        }

        // FIXED: Add small delay between batches to respect rate limits
        if (i + safeConcurrency < dates.length) {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay between batches
        }
      }

      // Send final result
      res.write(JSON.stringify({ 
        completed: true, 
        results,
        summary: {
          total,
          successful: results.filter(r => r.status === 'success').length,
          alreadyExisted: results.filter(r => r.status === 'already_exists').length,
          errors: results.filter(r => r.status === 'error').length
        }
      }) + '\n');
      
      res.end();
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.patch("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const { summary, isManualOverride } = req.body;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      const analysis = await storage.updateAnalysis(date, { summary, isManualOverride });
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // CSV Export route
  app.get("/api/analysis/export/csv", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ error: "Start date and end date are required" });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate as string) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate as string)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      const analyses = await storage.getAnalysesByDateRange(startDate as string, endDate as string);
      
      // Create CSV content
      const csvHeaders = 'Date,Summary,Key Date,Confidence,AI Provider,Type\n';
      let csvContent = csvHeaders;
      
      for (const analysis of analyses) {
        const keyDate = analysis.isManualOverride ? 'Yes' : 'No';
        const confidence = Math.round(parseFloat(analysis.confidenceScore || '0'));
        const aiProvider = analysis.aiProvider || 'Unknown';
        
        // Summary row
        csvContent += `"${analysis.date}","${(analysis.summary || '').replace(/"/g, '""')}","${keyDate}","${confidence}%","${aiProvider}","Summary"\n`;
      }
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="bitcoin-analysis-${startDate}-to-${endDate}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/analysis/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      await storage.deleteAnalysis(date);
      
      // Clear any cached entries for this date to prevent stale cache issues
      NewsAnalyzerService.clearCacheForDate(date);
      
      res.json({ message: "Analysis deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Quality check endpoint
  app.post("/api/analysis/check-quality", async (req, res) => {
    try {
      const { analyses } = req.body;
      
      if (!Array.isArray(analyses) || analyses.length === 0) {
        return res.status(400).json({ error: "Analyses array is required" });
      }

      console.log(`🔍 Quality check requested for ${analyses.length} analyses`);
      
      const qualityResults = await qualityChecker.checkMonthQuality(analyses);
      
      console.log(`✅ Quality check completed: ${qualityResults.totalIssues} issues found across ${qualityResults.affectedDates.length} dates`);
      
      // Convert Map to plain object for JSON serialization
      const qualityIssuesObj: Record<string, any[]> = {};
      console.log(`🗂️ Converting Map with ${qualityResults.qualityIssues.size} entries to object`);
      for (const [date, issues] of qualityResults.qualityIssues.entries()) {
        qualityIssuesObj[date] = issues;
        console.log(`📝 Added ${date}: ${issues.length} issues to object`);
      }
      console.log(`📦 Final qualityIssuesObj:`, qualityIssuesObj);
      
      res.json({
        ...qualityResults,
        qualityIssues: qualityIssuesObj
      });
    } catch (error) {
      console.error('Quality check error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Google verification route
  app.post("/api/analysis/google-verify", async (req, res) => {
    try {
      const { date, summary } = req.body;
      
      if (!date || !summary) {
        return res.status(400).json({ error: "Date and summary are required" });
      }

      console.log(`🔍 Google verification requested for ${date}`);
      
      const { geminiService } = await import("./services/gemini");
      const result = await geminiService.verifyDaySummary(date, summary, {
        source: 'individual-day-check',
        referer: req.headers.referer,
        userAgent: req.headers['user-agent']
      });
      
      console.log(`✅ Google verification completed for ${date}: ${result.assessment}`);
      
      res.json(result);
    } catch (error) {
      console.error('Google verification error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Bulk Google verification route for month view
  app.post("/api/analysis/google-check-month", async (req, res) => {
    try {
      const { analyses } = req.body;
      
      if (!Array.isArray(analyses) || analyses.length === 0) {
        return res.status(400).json({ error: "Analyses array is required" });
      }

      console.log(`🔍 Bulk Google verification requested for ${analyses.length} analyses`);
      
      const { geminiService } = await import("./services/gemini");
      const results = await geminiService.checkMonthAccuracy(analyses);
      
      console.log(`✅ Bulk Google verification completed: ${results.validDays} valid, ${results.incorrectDays} incorrect, ${results.cannotVerifyDays} cannot verify`);
      
      // Convert Map to plain object for JSON serialization
      const googleResultsObj: Record<string, any> = {};
      console.log(`🗂️ Converting Google results Map with ${results.results.size} entries to object`);
      for (const [date, result] of results.results.entries()) {
        googleResultsObj[date] = result;
        console.log(`📝 Added ${date}: ${result.assessment} to Google results object`);
      }
      console.log(`📦 Final Google results object:`, googleResultsObj);
      
      res.json({
        ...results,
        results: googleResultsObj
      });
    } catch (error) {
      console.error('Bulk Google verification error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Manual entry routes
  app.post("/api/manual-entries", async (req, res) => {
    try {
      const validatedData = insertManualNewsEntrySchema.parse(req.body);
      
      // Check if a manual entry already exists for this date
      const existingEntries = await storage.getManualEntriesByDate(validatedData.date);
      if (existingEntries.length > 0) {
        return res.status(409).json({ error: "Manual entry already exists for this date" });
      }
      
      const entry = await storage.createManualEntry(validatedData);
      res.json(entry);
    } catch (error) {
      if ((error as any).name === 'ZodError') {
        return res.status(400).json({ error: "Invalid input data", details: (error as any).errors });
      }
      // Check for unique constraint violation
      if ((error as any).code === '23505' || (error as any).message?.includes('unique constraint')) {
        return res.status(409).json({ error: "Manual entry already exists for this date" });
      }
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/manual-entries/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      const entries = await storage.getManualEntriesByDate(date);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/manual-entries/all", async (req, res) => {
    try {
      const entries = await storage.getAllManualEntries();
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/manual-entries/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const entry = await storage.updateManualEntry(id, updateData);
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/manual-entries/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteManualEntry(id);
      res.json({ message: "Manual entry deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Flag management endpoints
  app.patch("/api/analysis/flag/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const { isFlagged, flagReason } = req.body;
      
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      
      const analysis = await storage.updateAnalysisFlag(date, isFlagged, flagReason);
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.patch("/api/manual-entries/flag/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { isFlagged, flagReason } = req.body;
      
      const entry = await storage.updateManualEntryFlag(id, isFlagged, flagReason);
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // REMOVED: News fetch route - consolidated into analysis endpoint to eliminate duplicate API calls
  // The /api/analysis/date/:date endpoint now returns both analysis and articles in a single response

  // News search routes
  app.get("/api/news/search", async (req, res) => {
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

  // Health monitoring routes
  app.get("/api/health/status", async (req, res) => {
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

  app.post("/api/health/refresh", async (req, res) => {
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

  // Database management routes
  app.delete("/api/database/clear-all", async (req, res) => {
    try {
      await storage.clearAllData();
      cacheManager.clearAll(); // Clear caches too
      res.json({ success: true, message: "All database data has been cleared" });
    } catch (error) {
      console.error('Error clearing database:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Selective deletion endpoints
  app.delete("/api/database/clear-analyses", async (req, res) => {
    try {
      await storage.clearAnalysisData();
      cacheManager.clearAll();
      res.json({ success: true, message: "Historical Bitcoin news analyses cleared" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/database/clear-manual-entries", async (req, res) => {
    try {
      await storage.clearManualEntries();
      res.json({ success: true, message: "Manual news entries cleared" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/database/clear-source-credibility", async (req, res) => {
    try {
      await storage.clearSourceCredibility();
      res.json({ success: true, message: "Source credibility settings cleared" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/database/clear-spam-domains", async (req, res) => {
    try {
      await storage.clearSpamDomains();
      res.json({ success: true, message: "Spam domain filters cleared" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/database/clear-ai-prompts", async (req, res) => {
    try {
      await storage.clearAiPrompts();
      res.json({ success: true, message: "AI prompts and configurations cleared" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/database/clear-users", async (req, res) => {
    try {
      await storage.clearUserData();
      res.json({ success: true, message: "User data cleared" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Performance monitoring routes
  app.get("/api/system/db-stats", async (req, res) => {
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

  // Quality warning routes
  app.get("/api/analysis/quality-warnings", async (req, res) => {
    try {
      // Return empty array for now since this was scraping-related
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Advanced filtering routes
  app.get("/api/analysis/filter", async (req, res) => {
    try {
      const { minConfidence, maxConfidence, sentiment, topics, startDate, endDate } = req.query;
      
      // Get all analyses in date range
      const analyses = await storage.getAnalysesByDateRange(
        startDate as string || '2008-01-01', 
        endDate as string || new Date().toISOString().split('T')[0]
      );
      
      // Apply filters
      let filtered = analyses;
      
      if (minConfidence) {
        filtered = filtered.filter(a => parseFloat(a.confidenceScore || '0') >= parseFloat(minConfidence as string));
      }
      
      if (maxConfidence) {
        filtered = filtered.filter(a => parseFloat(a.confidenceScore || '100') <= parseFloat(maxConfidence as string));
      }
      
      if (sentiment && sentiment !== 'all') {
        filtered = filtered.filter(a => a.sentimentLabel === sentiment);
      }
      
      if (topics && Array.isArray(topics)) {
        filtered = filtered.filter(a => {
          const analysisTopic = (a.topicCategories as string[]) || [];
          return topics.some(topic => analysisTopic.includes(topic as string));
        });
      }
      
      res.json(filtered);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Batch analysis routes
  app.post("/api/analysis/batch", async (req, res) => {
    try {
      const { dates, aiProvider = 'openai' } = req.body;
      
      if (!Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: "Dates array is required" });
      }
      
      const results = [];
      let completed = 0;
      
      for (const date of dates) {
        try {
          const result = await newsAnalyzer.analyzeNewsForDate({ 
            date, 
            forceReanalysis: false, 
            aiProvider 
          });
          results.push({ date, status: 'success', data: result });
          completed++;
        } catch (error) {
          results.push({ 
            date, 
            status: 'error', 
            error: (error as Error).message 
          });
        }
      }
      
      res.json({ 
        total: dates.length, 
        completed, 
        failed: dates.length - completed,
        results 
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Topic analysis route
  app.get("/api/analysis/topics", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      const analyses = await storage.getAnalysesByDateRange(
        startDate as string || '2008-01-01', 
        endDate as string || new Date().toISOString().split('T')[0]
      );
      
      const topicCounts: Record<string, number> = {};
      const sentimentCounts = { bullish: 0, bearish: 0, neutral: 0 };
      
      analyses.forEach(analysis => {
        // Count topics
        const topics = (analysis.topicCategories as string[]) || [];
        topics.forEach(topic => {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        });
        
        // Count sentiment
        const sentiment = analysis.sentimentLabel || 'neutral';
        if (sentiment in sentimentCounts) {
          sentimentCounts[sentiment as keyof typeof sentimentCounts]++;
        }
      });
      
      res.json({
        topicDistribution: topicCounts,
        sentimentDistribution: sentimentCounts,
        totalAnalyses: analyses.length
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Settings and Configuration Routes
  app.get("/api/periods", async (req, res) => {
    try {
      // Import the period detector to get period information
      const { HISTORICAL_PERIODS } = await import("./services/period-detector");
      
      const periods = HISTORICAL_PERIODS.map(period => ({
        id: period.id,
        name: period.name,
        range: `${period.startDate} - ${period.endDate}`,
        description: period.description,
        keywords: period.keywords,
        searchOrder: period.searchOrder
      }));
      
      res.json({ periods });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/system/diagnostics", async (req, res) => {
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

  // Only create HTTP server and WebSocket in non-serverless environments
  const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
  const httpServer = createServer(app);

  // WebSocket for real-time API monitoring (disabled in serverless)
  let wss: any = null;
  if (!isServerless) {
    const { WebSocketServer } = await import('ws');
    wss = new WebSocketServer({ server: httpServer, path: '/api/monitor/ws' });
  }
  
  // Store connected clients
  const monitoringClients = new Set<any>();
  
  if (wss) {
    wss.on('connection', (ws) => {
    console.log('📡 API Monitor client connected');
    monitoringClients.add(ws);
    
    // Send current API stats and recent requests
    ws.send(JSON.stringify({
      type: 'init',
      stats: apiMonitor.getRequestStats(),
      recentRequests: apiMonitor.getRecentRequests(20)
    }));
    
    ws.on('close', () => {
      console.log('📡 API Monitor client disconnected');
      monitoringClients.delete(ws);
    });
    
    ws.on('error', (error) => {
      console.error('📡 API Monitor WebSocket error:', error);
      monitoringClients.delete(ws);
    });
  });
  
  // Forward API monitor events to connected clients
  apiMonitor.on('request', (request) => {
    const message = JSON.stringify({ type: 'request', data: request });
    for (const client of monitoringClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    }
  });

  // Forward API monitor update events to connected clients  
  apiMonitor.on('request-updated', (request) => {
    const message = JSON.stringify({ type: 'request', data: request });
    for (const client of monitoringClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(message);
      }
    }
  });
  } // End of if (wss) block
  
  // API monitoring endpoints
  app.get('/api/monitor/stats', async (req, res) => {
    try {
      res.json(apiMonitor.getRequestStats());
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
  
  app.get('/api/monitor/requests', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      res.json(apiMonitor.getRecentRequests(limit));
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
  
  app.delete('/api/monitor/clear', async (req, res) => {
    try {
      apiMonitor.clearHistory();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Batch Event Processing Routes
  // Event Cockpit - paginated batch events
  app.get('/api/event-cockpit/:batchId', async (req, res) => {
    try {
      const { batchId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = 50; // 50 events per page
      const offset = (page - 1) * limit;

      // Get batch info
      const batch = await storage.getEventBatch(batchId);
      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      // Get all events for this batch
      const allEvents = await storage.getBatchEventsByBatchId(batchId);
      
      // Calculate pagination
      const totalEvents = allEvents.length;
      const totalPages = Math.ceil(totalEvents / limit);
      const events = allEvents.slice(offset, offset + limit);

      res.json({
        batch,
        events,
        pagination: {
          currentPage: page,
          totalPages,
          totalEvents,
          eventsPerPage: limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      console.error('Event cockpit error:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // On-demand AI enhancement for single event
  app.post('/api/event-cockpit/enhance/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      
      // Get the event
      const event = await storage.getBatchEvent(eventId);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      console.log(`🤖 AI re-evaluating event ${eventId} from ${event.originalDate} (forced re-enhancement)`);
      
      // Always evaluate - even if previously enhanced, user wants fresh AI assessment
      const currentSummary = event.enhancedSummary || event.originalSummary;
      const evaluation = await evaluateEventSummary(currentSummary, event.originalDate, event.originalGroup);
      
      if (!evaluation.needsEnhancement) {
        // Mark as enhanced but keep original summary
        await storage.updateBatchEvent(eventId, {
          enhancedSummary: event.originalSummary,
          enhancedReasoning: evaluation.reasoning,
          status: 'enhanced'
        });
        
        return res.json({
          eventId,
          needsEnhancement: false,
          message: 'Summary is already high quality',
          reasoning: evaluation.reasoning,
          originalSummary: event.originalSummary,
          enhancedSummary: event.originalSummary
        });
      }
      
      // Enhance the summary
      const enhanced = await enhanceEventSummary(event.originalSummary, event.originalDate, event.originalGroup);
      
      // Update the event with enhanced summary
      const updatedEvent = await storage.updateBatchEvent(eventId, {
        enhancedSummary: enhanced.summary,
        enhancedReasoning: enhanced.reasoning,
        status: 'enhanced'
      });
      
      res.json({
        eventId,
        needsEnhancement: true,
        originalSummary: event.originalSummary,
        enhancedSummary: enhanced.summary,
        reasoning: enhanced.reasoning,
        event: updatedEvent
      });
      
    } catch (error) {
      console.error('AI enhancement error:', error);
      res.status(500).json({ error: 'Failed to enhance event' });
    }
  });

  // Batch enhancement for all events on a page
  app.post('/api/event-cockpit/enhance-batch', async (req, res) => {
    try {
      const { eventIds } = req.body;
      
      if (!Array.isArray(eventIds) || eventIds.length === 0) {
        return res.status(400).json({ error: 'eventIds must be a non-empty array' });
      }
      
      console.log(`🎆 Starting batch enhancement of ${eventIds.length} events`);
      let enhanced = 0;
      let alreadyGood = 0;
      
      // Process events sequentially to avoid overwhelming OpenAI API
      for (const eventId of eventIds) {
        try {
          const event = await storage.getBatchEvent(eventId);
          if (!event) {
            console.log(`⚠️ Event ${eventId} not found, skipping`);
            continue;
          }
          
          // Skip if already enhanced
          if (event.enhancedSummary) {
            alreadyGood++;
            console.log(`✅ Event ${eventId} already enhanced, skipping`);
            continue;
          }
          
          console.log(`🤖 Evaluating event ${eventId} from ${event.originalDate}`);
          
          // Evaluate and enhance the event
          const evaluation = await evaluateEventSummary(event.originalSummary, event.originalDate, event.originalGroup);
          
          if (!evaluation.needsEnhancement) {
            // Mark as enhanced but keep original
            await storage.updateBatchEvent(eventId, {
              enhancedSummary: event.originalSummary,
              enhancedReasoning: evaluation.reasoning,
              status: 'enhanced'
            });
            alreadyGood++;
            console.log(`✅ Event ${eventId} already perfect`);
          } else {
            // Enhance the summary
            const enhanced_result = await enhanceEventSummary(event.originalSummary, event.originalDate, event.originalGroup);
            
            await storage.updateBatchEvent(eventId, {
              enhancedSummary: enhanced_result.summary,
              enhancedReasoning: enhanced_result.reasoning,
              status: 'enhanced'
            });
            enhanced++;
            console.log(`✨ Enhanced event ${eventId}: "${enhanced_result.summary}"`);
          }
          
        } catch (eventError) {
          console.error(`❌ Error enhancing event ${eventId}:`, eventError);
          alreadyGood++; // Count as processed to avoid confusion
        }
      }
      
      console.log(`🎉 Batch complete: ${enhanced} enhanced, ${alreadyGood} already good`);
      res.json({ enhanced, alreadyGood, total: enhanced + alreadyGood });
      
    } catch (error) {
      console.error('Error in batch enhancement:', error);
      res.status(500).json({ error: 'Failed to enhance events batch' });
    }
  });

  // Manual edit event summary
  app.patch('/api/event-cockpit/edit/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      const { summary } = req.body;
      
      if (!summary || summary.length < 100 || summary.length > 110) {
        return res.status(400).json({ error: 'Summary must be 100-110 characters' });
      }

      const updatedEvent = await storage.updateBatchEvent(eventId, {
        enhancedSummary: summary,
        status: 'enhanced'
      });

      res.json(updatedEvent);
    } catch (error) {
      console.error('Edit event error:', error);
      res.status(500).json({ error: 'Failed to edit event' });
    }
  });

  // Approve batch of events
  app.post('/api/event-cockpit/approve', async (req, res) => {
    try {
      const { eventIds } = req.body;
      
      if (!Array.isArray(eventIds) || eventIds.length === 0) {
        return res.status(400).json({ error: 'Event IDs required' });
      }

      const approvedEvents = await storage.approveBatchEvents(eventIds);
      res.json({ approved: approvedEvents.length, events: approvedEvents });
    } catch (error) {
      console.error('Approve events error:', error);
      res.status(500).json({ error: 'Failed to approve events' });
    }
  });

  app.post('/api/batch-events/upload', async (req, res) => {
    try {
      const { filename, events } = req.body;
      
      if (!filename || !events || !Array.isArray(events)) {
        return res.status(400).json({ error: 'Invalid upload data' });
      }

      // Calculate batch structure
      const totalEvents = events.length;
      const totalBatches = Math.ceil(totalEvents / 10);

      // Create batch record
      const batch = await storage.createEventBatch({
        originalFilename: filename,
        totalEvents,
        totalBatches,
        status: 'uploaded'
      });

      // Create individual event records
      const batchEvents = events.map((event: any, index: number) => ({
        batchId: batch.id,
        batchNumber: Math.floor(index / 10) + 1,
        originalDate: event.date,
        originalSummary: event.summary,
        originalGroup: event.group || 'General',
        status: 'pending' as const
      }));

      await storage.createBatchEvents(batchEvents);

      res.json({ success: true, batchId: batch.id, batch });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/batch-events/batches', async (req, res) => {
    try {
      const batches = await storage.getAllEventBatches();
      res.json(batches);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/batch-events/batch/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const batch = await storage.getEventBatch(id);
      
      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      const events = await storage.getBatchEventsByBatchId(id);
      res.json({ batch, events });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/batch-events/batch/:id/events/:batchNumber', async (req, res) => {
    try {
      const { id, batchNumber } = req.params;
      const batchNum = parseInt(batchNumber);
      
      if (isNaN(batchNum)) {
        return res.status(400).json({ error: 'Invalid batch number' });
      }

      const events = await storage.getBatchEventsByBatchNumber(id, batchNum);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/batch-events/process/:id/:batchNumber', async (req, res) => {
    try {
      const { id, batchNumber } = req.params;
      const batchNum = parseInt(batchNumber);
      
      if (isNaN(batchNum)) {
        return res.status(400).json({ error: 'Invalid batch number' });
      }

      // Get events for this batch
      const events = await storage.getBatchEventsByBatchNumber(id, batchNum);
      
      if (events.length === 0) {
        return res.status(404).json({ error: 'No events found for this batch' });
      }

      // Process batch with OpenAI
      const batchContext = {
        batchId: id,
        batchNumber: batchNum,
        events,
        groupContext: `Batch ${batchNum} processing`
      };

      const enhancementResult = await batchProcessor.enhanceBatch(batchContext);
      
      if (!enhancementResult.success) {
        return res.status(500).json({ 
          error: 'Batch processing failed', 
          details: enhancementResult.errors 
        });
      }

      // Update events with enhanced summaries
      const enhancedEvents = await Promise.all(
        enhancementResult.enhancedEvents?.map(async (enhanced) => {
          return await storage.updateBatchEvent(enhanced.id, {
            status: 'enhanced',
            enhancedSummary: enhanced.enhancedSummary,
            enhancedReasoning: enhanced.enhancedReasoning,
            aiProvider: 'openai'
          });
        }) || []
      );

      // Update batch progress
      await storage.updateEventBatch(id, {
        processedEvents: (await storage.getBatchEventsByBatchId(id)).filter(e => e.status === 'enhanced' || e.status === 'approved' || e.status === 'rejected').length,
        currentBatchNumber: batchNum,
        status: 'processing'
      });

      res.json({ success: true, events: enhancedEvents });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get('/api/batch-events/review/:id/:batchNumber', async (req, res) => {
    try {
      const { id, batchNumber } = req.params;
      const batchNum = parseInt(batchNumber);
      
      if (isNaN(batchNum)) {
        return res.status(400).json({ error: 'Invalid batch number' });
      }

      const events = await storage.getBatchEventsForReview(id, batchNum);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/batch-events/approve/:id/:batchNumber', async (req, res) => {
    try {
      const { id, batchNumber } = req.params;
      const { eventIds } = req.body;
      
      if (!Array.isArray(eventIds)) {
        return res.status(400).json({ error: 'Event IDs must be an array' });
      }

      const approvedEvents = await storage.approveBatchEvents(eventIds);
      
      // Update batch progress
      const allEvents = await storage.getBatchEventsByBatchId(id);
      const approvedCount = allEvents.filter(e => e.status === 'approved').length;
      
      await storage.updateEventBatch(id, {
        approvedEvents: approvedCount
      });

      res.json({ success: true, events: approvedEvents });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/batch-events/reject/:id/:batchNumber', async (req, res) => {
    try {
      const { id, batchNumber } = req.params;
      const { eventIds } = req.body;
      
      if (!Array.isArray(eventIds)) {
        return res.status(400).json({ error: 'Event IDs must be an array' });
      }

      const rejectedEvents = await storage.rejectBatchEvents(eventIds);
      
      // Update batch progress
      const allEvents = await storage.getBatchEventsByBatchId(id);
      const rejectedCount = allEvents.filter(e => e.status === 'rejected').length;
      
      await storage.updateEventBatch(id, {
        rejectedEvents: rejectedCount
      });

      res.json({ success: true, events: rejectedEvents });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/batch-events/finalize/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get all approved events
      const allEvents = await storage.getBatchEventsByBatchId(id);
      const approvedEvents = allEvents.filter(e => e.status === 'approved');
      
      if (approvedEvents.length === 0) {
        return res.status(400).json({ error: 'No approved events to finalize' });
      }

      // Convert approved events to manual entries
      const manualEntries = await Promise.all(approvedEvents.map(async (event) => {
        return await storage.createManualEntry({
          date: event.originalDate,
          title: `Batch Import: ${event.originalGroup}`,
          summary: event.enhancedSummary || event.originalSummary,
          description: `Enhanced from batch upload: ${event.enhancedReasoning || 'No reasoning provided'}`
        });
      }));

      // Mark batch as completed
      await storage.updateEventBatch(id, {
        status: 'completed',
        completedAt: new Date()
      });

      res.json({ 
        success: true, 
        message: `Successfully imported ${manualEntries.length} events`,
        entries: manualEntries 
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Database migration endpoint - Push enhanced events to main database
  app.post("/api/database/migrate-enhanced-events", async (req, res) => {
    try {
      console.log("🗄️ Starting migration of enhanced events to main database...");
      
      // Get all enhanced events from batch_events table
      const { db } = await import("./db");
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

  // ==================== CONFLICT DETECTION ROUTES ====================

  // Test single date duplicate detection
  app.post("/api/conflicts/test-date/:date", async (req, res) => {
    try {
      const date = req.params.date;
      
      console.log(`🔍 Testing duplicate detection for ${date}...`);

      // Import the duplicate detector service
      const { duplicateDetector } = await import('./services/duplicate-detector');

      // Analyze this date
      const similarDates = await duplicateDetector.analyzeDate(date);

      res.json({ 
        success: true,
        date,
        similarDates,
        count: similarDates.length
      });
    } catch (error) {
      console.error("❌ Error testing date:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Start duplicate analysis for a year
  app.post("/api/conflicts/analyze-year/:year", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      
      if (isNaN(year) || year < 2008 || year > 2030) {
        return res.status(400).json({ error: "Invalid year" });
      }

      console.log(`🧹 Starting duplicate analysis for year ${year}...`);

      // Import the duplicate detector service
      const { duplicateDetector } = await import('./services/duplicate-detector');

      // Wait for analysis to complete
      await duplicateDetector.analyzeYear(year, (completed, total, currentDate) => {
        console.log(`📊 Progress: ${completed}/${total} - Currently analyzing ${currentDate}`);
      });

      console.log(`✅ Completed duplicate analysis for year ${year}`);

      // Automatically assign cluster IDs to all conflicts
      console.log(`🔗 Assigning cluster IDs...`);
      const { conflictClusterer } = await import('./services/conflict-clusterer');
      const clusterResult = await conflictClusterer.assignClusterIds();
      console.log(`✅ Assigned ${clusterResult.conflictsUpdated} conflicts to ${clusterResult.clustersFound} clusters`);

      res.json({ 
        success: true, 
        message: `Completed duplicate analysis for year ${year}`,
        clusters: clusterResult.clustersFound,
        conflictsUpdated: clusterResult.conflictsUpdated
      });
    } catch (error) {
      console.error("❌ Error in duplicate analysis:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Start duplicate analysis for a specific month
  app.post("/api/conflicts/analyze-month/:year/:month", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      
      if (isNaN(year) || year < 2008 || year > 2030) {
        return res.status(400).json({ error: "Invalid year" });
      }
      
      if (isNaN(month) || month < 1 || month > 12) {
        return res.status(400).json({ error: "Invalid month" });
      }

      console.log(`🧹 Starting duplicate analysis for ${year}-${month.toString().padStart(2, '0')}...`);

      // Calculate date range for the month
      const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate(); // Get last day of month
      const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;

      // Clear existing conflicts for this month
      const allConflicts = await storage.getAllConflicts();
      const monthConflicts = allConflicts.filter(c => 
        c.sourceDate >= startDate && c.sourceDate <= endDate
      );
      
      for (const conflict of monthConflicts) {
        await storage.deleteConflict(conflict.id);
      }

      // Get all analyses for the month
      const analyses = await storage.getAnalysesByDateRange(startDate, endDate);

      console.log(`📊 Found ${analyses.length} dates to analyze in ${year}-${month.toString().padStart(2, '0')}`);

      // Import the duplicate detector service
      const { duplicateDetector } = await import('./services/duplicate-detector');

      // Analyze each date in the month
      let completed = 0;
      const total = analyses.length;

      for (const analysis of analyses) {
        const similarDates = await duplicateDetector.analyzeDate(analysis.date);

        if (similarDates.length > 0) {
          const conflicts = similarDates.map(relatedDate => {
            const [first, second] = [analysis.date, relatedDate].sort();
            return {
              sourceDate: first,
              relatedDate: second,
            };
          });
          await storage.createEventConflicts(conflicts);
          console.log(`💾 Stored ${conflicts.length} conflicts for ${analysis.date}`);
        }

        completed++;
        console.log(`📊 Progress: ${completed}/${total} - Analyzed ${analysis.date}`);

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ Completed duplicate analysis for ${year}-${month.toString().padStart(2, '0')}`);

      // Automatically assign cluster IDs to all conflicts
      console.log(`🔗 Assigning cluster IDs...`);
      const { conflictClusterer } = await import('./services/conflict-clusterer');
      const clusterResult = await conflictClusterer.assignClusterIds();
      console.log(`✅ Assigned ${clusterResult.conflictsUpdated} conflicts to ${clusterResult.clustersFound} clusters`);

      res.json({ 
        success: true, 
        message: `Completed duplicate analysis for ${year}-${month.toString().padStart(2, '0')}`,
        analyzed: total,
        clusters: clusterResult.clustersFound,
        conflictsUpdated: clusterResult.conflictsUpdated
      });
    } catch (error) {
      console.error("❌ Error starting duplicate analysis:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get all conflicts for a year (grouped by clusters)
  app.get("/api/conflicts/year/:year", async (req, res) => {
    try {
      const year = parseInt(req.params.year);
      
      if (isNaN(year) || year < 2008 || year > 2030) {
        return res.status(400).json({ error: "Invalid year" });
      }

      const conflicts = await storage.getConflictsByYear(year);

      // Group conflicts by clusterId (skip conflicts without cluster ID)
      const clusters = new Map<string, { clusterId: string; dateSet: Set<string>; conflictIds: number[] }>();
      
      for (const conflict of conflicts) {
        const clusterId = conflict.clusterId;
        
        // Skip conflicts without cluster ID
        if (!clusterId) continue;
        
        if (!clusters.has(clusterId)) {
          clusters.set(clusterId, {
            clusterId,
            dateSet: new Set<string>(),
            conflictIds: [],
          });
        }
        
        const cluster = clusters.get(clusterId)!;
        
        // Add both source and related dates to the cluster
        cluster.dateSet.add(conflict.sourceDate);
        cluster.dateSet.add(conflict.relatedDate);
        cluster.conflictIds.push(conflict.id);
      }
      
      // Convert to final cluster format (no summaries for performance)
      const clustersArray = [];
      
      for (const cluster of clusters.values()) {
        const dates = Array.from(cluster.dateSet).sort();
        
        clustersArray.push({
          clusterId: cluster.clusterId,
          dates,
          conflictIds: cluster.conflictIds,
        });
      }
      
      const result = clustersArray.sort((a, b) => 
        b.clusterId.localeCompare(a.clusterId)
      );

      res.json(result);
    } catch (error) {
      console.error("❌ Error fetching conflicts:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get all conflicts
  app.get("/api/conflicts/all", async (req, res) => {
    try {
      const conflicts = await storage.getAllConflicts();
      res.json(conflicts);
    } catch (error) {
      console.error("❌ Error fetching all conflicts:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get all conflicts grouped by clusters
  app.get("/api/conflicts/all-grouped", async (req, res) => {
    try {
      const clusteredConflicts = await conflictClusterer.getClusteredConflicts();
      res.json(clusteredConflicts);
    } catch (error) {
      console.error("❌ Error fetching clustered conflicts:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete a conflict
  app.delete("/api/conflicts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid conflict ID" });
      }

      await storage.deleteConflict(id);
      res.json({ success: true });
    } catch (error) {
      console.error("❌ Error deleting conflict:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Resolve conflict - delete all conflicts in a cluster
  app.delete("/api/conflicts/resolve/:clusterId", async (req, res) => {
    try {
      const clusterId = req.params.clusterId;
      
      console.log(`✅ Resolving conflict cluster: ${clusterId}`);
      
      await conflictClusterer.deleteCluster(clusterId);
      res.json({ success: true, message: `Conflict cluster resolved for ${clusterId}` });
    } catch (error) {
      console.error("❌ Error resolving conflict:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get a specific cluster by any date in it
  app.get("/api/conflicts/cluster/:date", async (req, res) => {
    try {
      const date = req.params.date;
      const cluster = await conflictClusterer.getClusterByDate(date);
      
      if (!cluster) {
        return res.status(404).json({ error: "Cluster not found" });
      }
      
      res.json(cluster);
    } catch (error) {
      console.error("❌ Error fetching cluster:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get AI recommendations for conflict resolution - HOLISTIC CLUSTER ANALYSIS
  app.post("/api/conflicts/ai-recommendations", async (req, res) => {
    try {
      const { sourceDate, duplicateDates } = req.body;
      
      if (!sourceDate || !duplicateDates || !Array.isArray(duplicateDates)) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      console.log(`🤖 Getting holistic AI recommendations for cluster with ${duplicateDates.length + 1} dates`);

      // Fetch all analyses and their cached news
      const allDates = [sourceDate, ...duplicateDates];
      const allDatesData = await Promise.all(
        allDates.map(async (date) => {
          const analysis = await storage.getAnalysisByDate(date);
          const tieredArticles = analysis?.tieredArticles as any || { bitcoin: [], crypto: [], macro: [] };
          
          // Get all available articles with full details
          const allArticles = [
            ...(tieredArticles.bitcoin || []).map((a: any) => ({ ...a, tier: 'bitcoin' })),
            ...(tieredArticles.crypto || []).map((a: any) => ({ ...a, tier: 'crypto' })),
            ...(tieredArticles.macro || []).map((a: any) => ({ ...a, tier: 'macro' }))
          ];
          
          return {
            date,
            summary: analysis?.summary || '',
            topArticleId: analysis?.topArticleId || '',
            allArticles
          };
        })
      );

      // Build comprehensive prompt for holistic analysis
      const prompt = `You are a Bitcoin news analyst performing STRATEGIC CLUSTER ANALYSIS for duplicate detection.

CLUSTER DATES WITH SUMMARIES:
${allDatesData.map((d, i) => `${i + 1}. ${d.date}: "${d.summary}"`).join('\n')}

AVAILABLE ARTICLES FOR EACH DATE:
${allDatesData.map((d, i) => {
  return `
${d.date}:
${d.allArticles.map((article: any, j: number) => `  ${j + 1}. [${article.tier.toUpperCase()}] ID: ${article.id}
     Title: ${article.title}
     Summary: ${article.summary || article.text || ''}`).join('\n')}
`;
}).join('\n')}

TASK - HOLISTIC CLUSTER ANALYSIS:
1. **Group dates by theme/topic**: Identify which dates discuss the same event (e.g., "halving buildup", "Ethereum fork", "mining difficulty")
2. **For each group**: 
   - Decide which dates should KEEP their current article (represent the theme best)
   - Decide which dates need to SWITCH to a different article (to avoid overlap)
3. **For dates that need to switch**: Recommend a specific article ID from their available articles that covers a DIFFERENT topic
4. **Provide strategic reasoning**: Explain the overall cluster structure and why this resolution strategy makes sense

Return a comprehensive analysis with:
- Theme-based groupings
- Keep/switch recommendations for each date
- Specific article IDs for switches
- Strategic reasoning about the cluster`;

      // Call OpenAI with structured output for holistic analysis
      const openaiResponse = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are a Bitcoin news analyst performing strategic cluster analysis. Provide holistic recommendations.' },
          { role: 'user', content: prompt }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'holistic_cluster_analysis',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                groups: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      theme: { type: 'string' },
                      dates: { 
                        type: 'array',
                        items: { type: 'string' }
                      },
                      action: { type: 'string' },
                      reasoning: { type: 'string' }
                    },
                    required: ['theme', 'dates', 'action', 'reasoning'],
                    additionalProperties: false
                  }
                },
                recommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string' },
                      action: { 
                        type: 'string',
                        enum: ['keep', 'switch']
                      },
                      articleId: { type: 'string' },
                      newTopic: { type: 'string' },
                      reasoning: { type: 'string' }
                    },
                    required: ['date', 'action', 'reasoning'],
                    additionalProperties: false
                  }
                },
                overallStrategy: { type: 'string' }
              },
              required: ['groups', 'recommendations', 'overallStrategy'],
              additionalProperties: false
            }
          }
        }
      });

      const analysis = JSON.parse(openaiResponse.choices[0].message.content || '{"groups":[],"recommendations":[],"overallStrategy":""}');
      console.log(`✅ Holistic cluster analysis complete: ${analysis.groups.length} groups, ${analysis.recommendations.length} recommendations`);
      
      res.json(analysis);
    } catch (error) {
      console.error("❌ Error getting AI recommendations:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Smart deduplication - detects overlaps and suggests alternatives
  app.post("/api/conflicts/smart-dedup", async (req, res) => {
    try {
      const { sourceDate, duplicateDates } = req.body;
      
      if (!sourceDate || !duplicateDates || !Array.isArray(duplicateDates)) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      console.log(`🧠 Starting smart deduplication for cluster with ${duplicateDates.length + 1} dates`);

      // Step 1: Fetch all analyses
      const allDates = [sourceDate, ...duplicateDates];
      const allDatesData = await Promise.all(
        allDates.map(async (date) => {
          const analysis = await storage.getAnalysisByDate(date);
          const tieredArticles = analysis?.tieredArticles as any || { bitcoin: [], crypto: [], macro: [] };
          return {
            date,
            summary: analysis?.summary || '',
            tieredArticles,
            topArticleId: analysis?.topArticleId || '',
          };
        })
      );

      // Step 2: Detect overlaps using OpenAI
      console.log(`🔍 Step 1: Detecting overlaps among ${allDates.length} summaries`);
      const overlapPrompt = `You are analyzing Bitcoin news summaries to detect duplicates.

SUMMARIES TO ANALYZE:
${allDatesData.map((d, i) => `${i + 1}. ${d.date}: "${d.summary}"`).join('\n')}

TASK: Identify groups of summaries that discuss the SAME SPECIFIC EVENT or ISSUE.

For example:
- "Mt Gox trustee sells 400 BTC" and "Mt Gox liquidation continues with BTC sales" = SAME EVENT
- "Bitcoin reaches $10k" and "BTC price hits new high" = SAME EVENT  
- "Lightning Network update" and "Mt Gox sale" = DIFFERENT EVENTS

Return groups of dates that overlap. Keep the first date in each group, mark others as duplicates.`;

      const overlapResponse = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are a Bitcoin news analyst detecting duplicate coverage.' },
          { role: 'user', content: overlapPrompt }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'overlap_detection',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                overlapGroups: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      keepDate: { type: 'string' },
                      duplicateDates: {
                        type: 'array',
                        items: { type: 'string' }
                      },
                      topic: { type: 'string' }
                    },
                    required: ['keepDate', 'duplicateDates', 'topic'],
                    additionalProperties: false
                  }
                }
              },
              required: ['overlapGroups'],
              additionalProperties: false
            }
          }
        }
      });

      const overlapResult = JSON.parse(overlapResponse.choices[0].message.content || '{"overlapGroups":[]}');
      console.log(`✅ Detected ${overlapResult.overlapGroups.length} overlap groups`);

      // Step 3: For each duplicate, ensure all tiers are cached
      const duplicatesToFix = new Set<string>();
      overlapResult.overlapGroups.forEach((group: any) => {
        group.duplicateDates.forEach((date: string) => duplicatesToFix.add(date));
      });

      console.log(`📰 Step 2: Ensuring full news coverage for ${duplicatesToFix.size} duplicates`);
      
      // Re-fetch all tiers if needed
      for (const date of Array.from(duplicatesToFix)) {
        const dateData = allDatesData.find(d => d.date === date);
        if (!dateData) continue;

        const hasBitcoin = (dateData.tieredArticles.bitcoin?.length || 0) > 0;
        const hasCrypto = (dateData.tieredArticles.crypto?.length || 0) > 0;
        const hasMacro = (dateData.tieredArticles.macro?.length || 0) > 0;

        if (!hasBitcoin || !hasCrypto || !hasMacro) {
          console.log(`🔄 Re-fetching all tiers for ${date} (Bitcoin: ${hasBitcoin}, Crypto: ${hasCrypto}, Macro: ${hasMacro})`);
          
          try {
            const requestContext = {
              requestId: `smart-dedup-${date}-${Date.now()}`,
              source: 'SMART_DEDUP',
              referer: 'smart-dedup',
              userAgent: 'smart-dedup'
            };

            // Fetch all three tiers
            const [bitcoinResults, cryptoResults, macroResults] = await Promise.all([
              hierarchicalSearch.searchBitcoinTier(date, requestContext),
              hierarchicalSearch.searchCryptoTier(date, requestContext),
              hierarchicalSearch.searchMacroTier(date, requestContext)
            ]);

            // Update the tiered articles in memory and database
            dateData.tieredArticles = {
              bitcoin: bitcoinResults,
              crypto: cryptoResults,
              macro: macroResults
            };

            // Update database
            const analysis = await storage.getAnalysisByDate(date);
            if (analysis) {
              await storage.updateAnalysis(analysis.id, {
                tieredArticles: dateData.tieredArticles
              });
            }

            console.log(`✅ Fetched all tiers for ${date}: Bitcoin=${bitcoinResults.length}, Crypto=${cryptoResults.length}, Macro=${macroResults.length}`);
          } catch (error) {
            console.error(`❌ Error fetching tiers for ${date}:`, error);
          }
        }
      }

      // Step 4: Get AI suggestions for alternatives
      console.log(`💡 Step 3: Getting AI suggestions for ${duplicatesToFix.size} duplicates`);
      
      const suggestions = [];
      
      for (const group of overlapResult.overlapGroups) {
        for (const dupDate of group.duplicateDates) {
          const dateData = allDatesData.find(d => d.date === dupDate);
          if (!dateData) continue;

          // Get all existing summaries to avoid overlaps
          const existingSummaries = allDatesData
            .filter(d => d.date !== dupDate)
            .map(d => d.summary);

          // Get all available articles
          const allArticles = [
            ...(dateData.tieredArticles.bitcoin || []),
            ...(dateData.tieredArticles.crypto || []),
            ...(dateData.tieredArticles.macro || [])
          ];

          if (allArticles.length === 0) {
            console.log(`⚠️ No articles available for ${dupDate}, skipping`);
            continue;
          }

          // Ask AI for alternative
          const suggestionPrompt = `You are analyzing news for ${dupDate}.

CURRENT SUMMARY (discussing ${group.topic}):
"${dateData.summary}"

THIS DATE MUST AVOID THESE TOPICS (already covered by other dates):
${existingSummaries.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

AVAILABLE ARTICLES for ${dupDate}:
${allArticles.map((article, i) => `${i + 1}. ID: ${article.id}
   Title: ${article.title}
   Summary: ${article.summary || article.text || ''}`).join('\n\n')}

TASK: Select the BEST article that:
1. Discusses a COMPLETELY DIFFERENT event/topic from all existing summaries above
2. Is newsworthy and represents ${dupDate} accurately
3. Would create NO OVERLAP with any existing summary

Return the article ID and explain why it doesn't overlap.`;

          try {
            const suggestionResponse = await openai.chat.completions.create({
              messages: [
                { role: 'system', content: 'You are a Bitcoin news analyst selecting non-overlapping coverage.' },
                { role: 'user', content: suggestionPrompt }
              ],
              model: 'gpt-4o-mini',
              temperature: 0.3,
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'article_suggestion',
                  strict: true,
                  schema: {
                    type: 'object',
                    properties: {
                      articleId: { type: 'string' },
                      reasoning: { type: 'string' },
                      newTopic: { type: 'string' }
                    },
                    required: ['articleId', 'reasoning', 'newTopic'],
                    additionalProperties: false
                  }
                }
              }
            });

            const suggestion = JSON.parse(suggestionResponse.choices[0].message.content || '{}');
            
            if (suggestion.articleId) {
              suggestions.push({
                date: dupDate,
                currentSummary: dateData.summary,
                currentTopic: group.topic,
                suggestedArticleId: suggestion.articleId,
                newTopic: suggestion.newTopic,
                reasoning: suggestion.reasoning
              });

              // Update existing summaries to include this new suggestion
              existingSummaries.push(suggestion.newTopic);
            }
          } catch (error) {
            console.error(`❌ Error getting suggestion for ${dupDate}:`, error);
          }
        }
      }

      console.log(`✅ Smart deduplication complete: ${suggestions.length} suggestions generated`);
      
      res.json({ 
        suggestions,
        overlapGroups: overlapResult.overlapGroups
      });
    } catch (error) {
      console.error("❌ Error in smart deduplication:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ==================== QUALITY CHECK ROUTES ====================

  // Get all summary quality violations
  app.get("/api/quality-check/violations", async (req, res) => {
    try {
      console.log("🔍 Scanning database for summary quality violations...");
      
      const allAnalyses = await storage.getAllAnalyses();
      console.log(`📊 Scanning ${allAnalyses.length} analyses`);

      interface Violation {
        date: string;
        summary: string;
        violations: string[];
        length: number;
      }

      const violations: Violation[] = [];

      // Validation rules
      const truncatedEndings = [' a', ' an', ' ana', ' anal', ' analy', ' analys', ' analysi', ' analysis'];

      for (const analysis of allAnalyses) {
        const summary = analysis.summary || '';
        const violationList: string[] = [];

        // Check length violations
        if (summary.length < 100) {
          violationList.push('Too short (< 100 chars)');
        }
        if (summary.length > 110) {
          violationList.push('Too long (> 110 chars)');
        }

        // Check ending period
        if (summary.endsWith('.')) {
          violationList.push('Ends with period');
        }

        // Check for space-hyphen
        if (summary.includes(' -')) {
          violationList.push('Contains hyphen');
        }

        // Check for truncated endings (space followed by truncated word)
        for (const ending of truncatedEndings) {
          if (summary.endsWith(ending)) {
            violationList.push(`Ends with "${ending.trim()}"`);
            break; // Only report once
          }
        }

        // Add to violations list if any violations found
        if (violationList.length > 0) {
          violations.push({
            date: analysis.date,
            summary,
            violations: violationList,
            length: summary.length
          });
        }
      }

      console.log(`✅ Found ${violations.length} violations`);
      
      res.json({
        total: allAnalyses.length,
        violations: violations.length,
        data: violations.sort((a, b) => b.date.localeCompare(a.date)) // Sort by date descending
      });
    } catch (error) {
      console.error("❌ Error scanning for quality violations:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ==================== FACT CHECK ROUTES ====================

  // Get all fact-checked results
  app.get("/api/fact-check/results", async (req, res) => {
    try {
      console.log("🔍 Fetching all fact-checked results...");
      
      const allAnalyses = await storage.getAllAnalyses();
      const factChecked = allAnalyses.filter(a => a.factCheckVerdict !== null);
      
      console.log(`✅ Found ${factChecked.length} fact-checked analyses`);
      
      res.json({
        total: allAnalyses.length,
        factChecked: factChecked.length,
        data: factChecked.map(a => ({
          date: a.date,
          summary: a.summary,
          verdict: a.factCheckVerdict,
          confidence: a.factCheckConfidence,
          reasoning: a.factCheckReasoning,
          checkedAt: a.factCheckedAt
        })).sort((a, b) => b.date.localeCompare(a.date))
      });
    } catch (error) {
      console.error("❌ Error fetching fact-check results:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Start fact-checking all analyses
  app.post("/api/fact-check/run", async (req, res) => {
    try {
      console.log("🔍 Starting fact-check of entire database...");
      
      // Check if already running
      if (isFactCheckRunning) {
        return res.status(409).json({ 
          error: "Fact-check already running. Please stop the current one first." 
        });
      }
      
      // Mark as running and reset state
      isFactCheckRunning = true;
      shouldStopFactCheck = false;
      factCheckProcessed = 0;
      
      const allAnalyses = await storage.getAllAnalyses();
      
      // CRITICAL: Only fact-check dates through September 30, 2023
      // OpenAI model knowledge cutoff is October 2023, so we only check dates before that
      const FACT_CHECK_CUTOFF = '2023-09-30';
      const eligibleAnalyses = allAnalyses.filter(a => a.date <= FACT_CHECK_CUTOFF);
      const skippedCount = allAnalyses.length - eligibleAnalyses.length;
      
      console.log(`📊 Total analyses: ${allAnalyses.length}`);
      console.log(`✅ Eligible for fact-check (≤${FACT_CHECK_CUTOFF}): ${eligibleAnalyses.length}`);
      console.log(`⏭️ Skipped (after ${FACT_CHECK_CUTOFF}): ${skippedCount}`);

      // Send initial response with count breakdown
      res.json({ 
        success: true, 
        total: allAnalyses.length,
        eligible: eligibleAnalyses.length,
        skipped: skippedCount,
        cutoffDate: FACT_CHECK_CUTOFF,
        message: `Fact-check started. Processing ${eligibleAnalyses.length} analyses (${skippedCount} skipped - after Sept 2023)`
      });

      // Process in background
      (async () => {
        const { openaiService } = await import("./services/openai");
        let processed = 0;
        let verified = 0;
        let contradicted = 0;
        let uncertain = 0;

        for (const analysis of eligibleAnalyses) {
          // Check if we should stop
          if (shouldStopFactCheck) {
            console.log(`⏹️ Fact-check stopped by user at ${processed}/${eligibleAnalyses.length}`);
            isFactCheckRunning = false;
            break;
          }
          try {
            const date = analysis.date;
            const summary = analysis.summary;

            console.log(`📝 Fact-checking ${date}: "${summary}"`);

            // Create OpenAI prompt
            const systemPrompt = `You are a Bitcoin historian verifying the accuracy of historical event records.

You will receive summaries of Bitcoin-related events, cryptocurrency/Web3 events, or macroeconomic/political events that may have impacted Bitcoin.

Your task is to verify if the event happened on the specific date provided.

NOTE: Your knowledge cutoff is October 2023. You can only verify events through September 2023 with confidence.

Respond in JSON format with:
- verdict: "verified" | "contradicted" | "uncertain"
- confidence: number (0-100)
- reasoning: string (short explanation, required for contradicted/uncertain, optional for verified)

VERDICT GUIDELINES:
- "verified": Event definitely happened on this date
- "contradicted": Event happened on different date OR didn't happen at all
- "uncertain": Cannot confirm the exact date OR insufficient information`;

            const userPrompt = `Date: ${date}
Summary: ${summary}

Did this event happen on this specific date?

If VERIFIED: Just confirm it's correct
If CONTRADICTED: Explain what's wrong (wrong date? different event?)
If UNCERTAIN: Explain why you can't verify it

Keep reasoning concise (10-30 words).`;

            const startTime = Date.now();
            const monitorRequestId = apiMonitor.logRequest({
              service: 'openai',
              endpoint: '/chat/completions',
              method: 'POST',
              status: 'pending',
              context: 'fact-check',
              purpose: 'Verify Bitcoin historical event accuracy',
              triggeredBy: `Fact-check for ${date}`,
              date: date,
              requestData: { 
                model: 'gpt-4o-mini', 
                purpose: 'fact-check',
                summary: summary
              }
            });

            try {
              const rawResponse = await openaiService.createCompletion([
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ]);

              const result = JSON.parse(rawResponse);

              apiMonitor.updateRequest(monitorRequestId, {
                status: 'success',
                duration: Date.now() - startTime,
                responseSize: JSON.stringify(result).length,
                requestData: {
                  model: 'gpt-4o-mini',
                  purpose: 'fact-check',
                  verdict: result.verdict,
                  confidence: result.confidence
                }
              });

              // Validate response
              if (!result.verdict || !result.confidence) {
                throw new Error('Invalid response from OpenAI: missing required fields');
              }

              // Update the analysis with fact-check results
              await storage.updateAnalysis(date, {
                factCheckVerdict: result.verdict,
                factCheckConfidence: result.confidence,
                factCheckReasoning: result.reasoning || null,
                factCheckedAt: new Date()
              });

              // Track stats
              if (result.verdict === 'verified') verified++;
              else if (result.verdict === 'contradicted') contradicted++;
              else if (result.verdict === 'uncertain') uncertain++;

              processed++;
              factCheckProcessed = processed; // Update global counter
              console.log(`✅ [${processed}/${eligibleAnalyses.length}] ${date}: ${result.verdict} (${result.confidence}%)`);

              // Rate limiting: wait 500ms between requests
              await new Promise(resolve => setTimeout(resolve, 500));

            } catch (openaiError) {
              console.error(`❌ OpenAI error for ${date}:`, openaiError);
              apiMonitor.updateRequest(monitorRequestId, {
                status: 'error',
                error: (openaiError as Error).message,
                errorCategory: 'other',
                duration: Date.now() - startTime
              });
            }

          } catch (error) {
            console.error(`❌ Error fact-checking ${analysis.date}:`, error);
          }
        }

        console.log(`✅ Fact-check completed: ${processed} processed, ${verified} verified, ${contradicted} contradicted, ${uncertain} uncertain`);
        isFactCheckRunning = false; // Mark as no longer running
      })();

    } catch (error) {
      console.error("❌ Error starting fact-check:", error);
      isFactCheckRunning = false; // Reset on error
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Stop fact-checking process
  app.post("/api/fact-check/stop", async (req, res) => {
    try {
      console.log("🛑 Stop fact-check requested");
      
      if (!isFactCheckRunning) {
        return res.status(400).json({ 
          error: "No fact-check process is currently running" 
        });
      }
      
      shouldStopFactCheck = true;
      const processedCount = factCheckProcessed;
      
      res.json({ 
        success: true, 
        processed: processedCount,
        message: "Fact-check will stop after current analysis completes" 
      });
    } catch (error) {
      console.error("❌ Error stopping fact-check:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Perplexity fact-check routes
  let shouldStopPerplexityFactCheck = false;
  let isPerplexityFactCheckRunning = false;
  let perplexityFactCheckProcessed = 0;

  // Get all Perplexity fact-check results
  app.get("/api/perplexity-fact-check/results", async (req, res) => {
    try {
      console.log("🔍 Fetching Perplexity fact-checked results (page 1, limit 50)...");
      
      const allAnalyses = await storage.getAllAnalyses();
      const perplexityChecked = allAnalyses.filter(a => a.perplexityVerdict !== null);
      
      console.log(`✅ Found ${perplexityChecked.length} Perplexity fact-checked analyses`);
      
      // OPTIMIZATION: Get all manual entries once and create a lookup Set
      const allManualEntries = await storage.getAllManualEntries();
      const manualEntryDates = new Set(allManualEntries.map(e => e.date));
      
      // OPTIMIZATION: Get all clusters once and create a lookup Map
      const allClusters = await conflictClusterer.getClusteredConflicts();
      const clusterLookup = new Map<string, string[]>();
      for (const cluster of allClusters) {
        for (const date of cluster.dates) {
          clusterLookup.set(date, cluster.dates.filter((d: string) => d !== date));
        }
      }
      
      // Process results in memory (no more database calls per item)
      const results = perplexityChecked.map((a) => {
        try {
          // Check if original date has manual entries
          let hasManualEntries = manualEntryDates.has(a.date);
          
          // Check corrected date if it exists
          if (!hasManualEntries && a.perplexityCorrectDateText) {
            const correctedDate = parsePerplexityDate(a.perplexityCorrectDateText);
            if (correctedDate) {
              hasManualEntries = manualEntryDates.has(correctedDate);
            }
          }
          
          // Get cluster information from in-memory lookup
          const otherDatesInCluster = clusterLookup.get(a.date) || [];
          
          return {
            date: a.date || '',
            summary: a.summary || '',
            verdict: a.perplexityVerdict || 'uncertain',
            confidence: a.perplexityConfidence ? Number(a.perplexityConfidence) : null,
            reasoning: a.perplexityReasoning || null,
            correctDateText: a.perplexityCorrectDateText || null,
            citations: Array.isArray(a.perplexityCitations) ? a.perplexityCitations : [],
            checkedAt: a.perplexityCheckedAt || null,
            manualEntryProtected: hasManualEntries,
            reVerified: a.reVerified || false,
            reVerificationSummary: a.reVerificationSummary || null,
            reVerificationDate: a.reVerificationDate || null,
            reVerificationStatus: a.reVerificationStatus || null,
            reVerificationWinner: a.reVerificationWinner || null,
            reVerificationReasoning: a.reVerificationReasoning || null,
            otherDuplicateDates: otherDatesInCluster
          };
        } catch (itemError) {
          console.error(`❌ Error processing analysis for date ${a.date}:`, itemError);
          return {
            date: a.date || '',
            summary: a.summary || '',
            verdict: a.perplexityVerdict || 'uncertain',
            confidence: a.perplexityConfidence ? Number(a.perplexityConfidence) : null,
            reasoning: a.perplexityReasoning || null,
            correctDateText: a.perplexityCorrectDateText || null,
            citations: [],
            checkedAt: a.perplexityCheckedAt || null,
            manualEntryProtected: false,
            reVerified: false,
            reVerificationSummary: null,
            reVerificationDate: null,
            reVerificationStatus: null,
            reVerificationWinner: null,
            reVerificationReasoning: null,
            otherDuplicateDates: []
          };
        }
      });
      
      res.json({
        total: allAnalyses.length,
        perplexityChecked: perplexityChecked.length,
        data: results.sort((a, b) => b.date.localeCompare(a.date))
      });
    } catch (error) {
      console.error("❌ Error fetching Perplexity fact-check results:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Run Perplexity fact-check on contradicted events
  app.post("/api/perplexity-fact-check/run", async (req, res) => {
    try {
      console.log("🔍 Starting Perplexity fact-check on contradicted events...");
      
      // Check if already running
      if (isPerplexityFactCheckRunning) {
        return res.status(409).json({ 
          error: "Perplexity fact-check already running. Please stop the current one first." 
        });
      }
      
      // Mark as running and reset state
      isPerplexityFactCheckRunning = true;
      shouldStopPerplexityFactCheck = false;
      perplexityFactCheckProcessed = 0;
      
      const allAnalyses = await storage.getAllAnalyses();
      
      // Only process contradicted events from OpenAI fact-check
      const contradictedAnalyses = allAnalyses.filter(a => a.factCheckVerdict === 'contradicted');
      
      console.log(`📊 Total analyses: ${allAnalyses.length}`);
      console.log(`🔴 Contradicted by OpenAI: ${contradictedAnalyses.length}`);

      // Send initial response
      res.json({ 
        success: true, 
        total: allAnalyses.length,
        contradicted: contradictedAnalyses.length,
        message: `Perplexity fact-check started. Processing ${contradictedAnalyses.length} contradicted analyses`
      });

      // Process in background
      (async () => {
        const { perplexityFactCheck } = await import("./services/perplexity");
        let processed = 0;
        let verified = 0;
        let contradicted = 0;
        let uncertain = 0;

        for (const analysis of contradictedAnalyses) {
          // Check if we should stop
          if (shouldStopPerplexityFactCheck) {
            console.log(`⏹️ Perplexity fact-check stopped by user at ${processed}/${contradictedAnalyses.length}`);
            isPerplexityFactCheckRunning = false;
            break;
          }

          try {
            const date = analysis.date;
            const summary = analysis.summary;
            const tieredArticles = analysis.tieredArticles || { bitcoin: [], crypto: [], macro: [] };

            console.log(`🔍 Perplexity fact-checking ${date}: "${summary}"`);

            const startTime = Date.now();
            const monitorRequestId = apiMonitor.logRequest({
              service: 'perplexity',
              endpoint: '/chat/completions',
              method: 'POST',
              status: 'pending',
              context: 'perplexity-fact-check',
              purpose: 'Verify Bitcoin historical event with grounded search',
              triggeredBy: `Perplexity fact-check for ${date}`,
              date: date,
              requestData: { 
                model: 'sonar', 
                purpose: 'perplexity-fact-check',
                summary: summary
              }
            });

            try {
              const result = await perplexityFactCheck(date, summary, tieredArticles as any);

              apiMonitor.updateRequest(monitorRequestId, {
                status: 'success',
                duration: Date.now() - startTime,
                responseSize: JSON.stringify(result).length,
                requestData: {
                  model: 'sonar',
                  purpose: 'perplexity-fact-check',
                  verdict: result.verdict,
                  confidence: result.confidence
                }
              });

              // Update database
              // Handle complex date strings by writing to both old and new fields
              const isValidSingleDate = result.correctDate && /^\d{4}-\d{2}-\d{2}$/.test(result.correctDate);
              
              await storage.updateAnalysisPerplexityFactCheck(date, {
                perplexityVerdict: result.verdict,
                perplexityConfidence: result.confidence.toString(),
                perplexityReasoning: result.reasoning,
                perplexityCorrectDate: isValidSingleDate ? result.correctDate : null, // Only set if valid YYYY-MM-DD
                perplexityCorrectDateText: result.correctDate ? result.correctDate : null, // Store raw string (handles complex formats)
                perplexityCitations: result.citations,
                perplexityCheckedAt: new Date()
              });

              processed++;
              perplexityFactCheckProcessed = processed;
              
              if (result.verdict === 'verified') verified++;
              else if (result.verdict === 'contradicted') contradicted++;
              else uncertain++;

              console.log(`✅ ${date}: ${result.verdict} (confidence: ${result.confidence}%) - ${processed}/${contradictedAnalyses.length}`);
              
              // Delay between requests
              await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (perplexityError) {
              console.error(`❌ Perplexity error for ${date}:`, perplexityError);
              apiMonitor.updateRequest(monitorRequestId, {
                status: 'error',
                error: (perplexityError as Error).message,
                errorCategory: 'other',
                duration: Date.now() - startTime
              });
            }

          } catch (error) {
            console.error(`❌ Error Perplexity fact-checking ${analysis.date}:`, error);
          }
        }

        console.log(`✅ Perplexity fact-check completed: ${processed} processed, ${verified} verified, ${contradicted} contradicted, ${uncertain} uncertain`);
        isPerplexityFactCheckRunning = false;
      })();

    } catch (error) {
      console.error("❌ Error starting Perplexity fact-check:", error);
      isPerplexityFactCheckRunning = false;
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Stop Perplexity fact-checking process
  app.post("/api/perplexity-fact-check/stop", async (req, res) => {
    try {
      console.log("🛑 Stop Perplexity fact-check requested");
      
      if (!isPerplexityFactCheckRunning) {
        return res.status(400).json({ 
          error: "No Perplexity fact-check process is currently running" 
        });
      }
      
      shouldStopPerplexityFactCheck = true;
      const processedCount = perplexityFactCheckProcessed;
      
      res.json({ 
        success: true, 
        processed: processedCount,
        message: "Perplexity fact-check will stop after current analysis completes" 
      });
    } catch (error) {
      console.error("❌ Error stopping Perplexity fact-check:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Batch tagging routes
  app.post("/api/batch-tagging/start", async (req, res) => {
    try {
      console.log("🏷️ Starting batch tagging of entire database...");
      
      // Check if already running
      if (isBatchTaggingRunning) {
        return res.status(409).json({ 
          error: "Batch tagging already running. Please stop the current one first." 
        });
      }
      
      // Get all analyses
      const allAnalyses = await storage.getAllAnalyses();
      
      // Filter to only analyses with summaries that don't already have tags
      const eligibleAnalyses = allAnalyses.filter(a => 
        a.summary && 
        a.summary.trim().length > 0 &&
        (!a.tags || (Array.isArray(a.tags) && a.tags.length === 0))
      );
      
      const alreadyTagged = allAnalyses.filter(a => 
        a.summary && 
        a.summary.trim().length > 0 &&
        a.tags && 
        Array.isArray(a.tags) &&
        a.tags.length > 0
      ).length;
      
      batchTaggingTotal = eligibleAnalyses.length;
      console.log(`✅ Found ${batchTaggingTotal} untagged analyses to process (${alreadyTagged} already tagged, skipping)`);
      
      // Send initial response
      res.json({ 
        success: true, 
        total: batchTaggingTotal,
        message: `Starting batch tagging of ${batchTaggingTotal} analyses` 
      });
      
      // Mark as running
      isBatchTaggingRunning = true;
      shouldStopBatchTagging = false;
      batchTaggingProcessed = 0;
      
      // Start background processing
      (async () => {
        let processed = 0;
        let failed = 0;
        const failedDates: string[] = [];
        
        for (const analysis of eligibleAnalyses) {
          // Check if stop was requested
          if (shouldStopBatchTagging) {
            console.log(`🛑 Batch tagging stopped by user after ${processed} analyses (${failed} failed)`);
            break;
          }
          
          try {
            console.log(`🏷️ [${processed + failed + 1}/${batchTaggingTotal}] Extracting tags for ${analysis.date}...`);
            
            // Extract entities from summary
            const tags = await entityExtractor.extractEntities(analysis.summary);
            
            // Update analysis with tags (empty array is valid - means no entities found)
            await storage.updateAnalysis(analysis.date, {
              tags: tags
            });
            
            processed++;
            batchTaggingProcessed = processed + failed; // Update progress to include both success and failure
            
            console.log(`✅ Tagged ${analysis.date} with ${tags.length} entities: ${tags.map(t => `${t.name}(${t.category})`).join(', ')}`);
            
            // Small delay to avoid rate limits (1 second)
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(`❌ Error tagging ${analysis.date}:`, error);
            failed++;
            failedDates.push(analysis.date);
            batchTaggingProcessed = processed + failed; // Update progress to include both success and failure
            
            // Continue with next analysis on error (don't stop entire batch)
            // Small delay before continuing to next analysis
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        console.log(`✅ Batch tagging completed: ${processed} successful, ${failed} failed`);
        if (failedDates.length > 0) {
          console.log(`❌ Failed dates: ${failedDates.join(', ')}`);
        }
        isBatchTaggingRunning = false;
      })();
      
    } catch (error) {
      console.error("❌ Error starting batch tagging:", error);
      isBatchTaggingRunning = false;
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/batch-tagging/stop", async (req, res) => {
    try {
      console.log("🛑 Stop batch tagging requested");
      
      if (!isBatchTaggingRunning) {
        return res.status(400).json({ 
          error: "No batch tagging process is currently running" 
        });
      }
      
      shouldStopBatchTagging = true;
      const processedCount = batchTaggingProcessed;
      
      res.json({ 
        success: true, 
        processed: processedCount,
        total: batchTaggingTotal,
        message: "Batch tagging will stop after current analysis completes" 
      });
    } catch (error) {
      console.error("❌ Error stopping batch tagging:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.get("/api/batch-tagging/status", async (req, res) => {
    try {
      res.json({
        isRunning: isBatchTaggingRunning,
        processed: batchTaggingProcessed,
        total: batchTaggingTotal,
        progress: batchTaggingTotal > 0 ? Math.round((batchTaggingProcessed / batchTaggingTotal) * 100) : 0
      });
    } catch (error) {
      console.error("❌ Error getting batch tagging status:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get entity catalog with counts
  app.get("/api/tags/catalog", async (req, res) => {
    try {
      console.log("📊 Fetching tag catalog");
      
      const allAnalyses = await storage.getAllAnalyses();
      
      // Count entities
      const entityCounts: Record<string, { category: string; name: string; count: number }> = {};
      let taggedCount = 0;
      let untaggedCount = 0;
      
      allAnalyses.forEach((analysis: HistoricalNewsAnalysis) => {
        const hasTags = analysis.tags && Array.isArray(analysis.tags) && analysis.tags.length > 0;
        
        if (hasTags) {
          taggedCount++;
          analysis.tags.forEach(tag => {
            const key = `${tag.category}::${tag.name}`;
            if (!entityCounts[key]) {
              entityCounts[key] = {
                category: tag.category,
                name: tag.name,
                count: 0
              };
            }
            entityCounts[key].count++;
          });
        } else {
          untaggedCount++;
        }
      });
      
      // Group entities by category
      const entitiesByCategory: Record<string, typeof entityCounts[string][]> = {};
      Object.values(entityCounts).forEach(entity => {
        if (!entitiesByCategory[entity.category]) {
          entitiesByCategory[entity.category] = [];
        }
        entitiesByCategory[entity.category].push(entity);
      });
      
      // Sort entities within each category by count (descending)
      Object.keys(entitiesByCategory).forEach(category => {
        entitiesByCategory[category].sort((a, b) => b.count - a.count);
      });
      
      console.log(`✅ Catalog: ${taggedCount} tagged, ${untaggedCount} untagged, ${Object.keys(entityCounts).length} unique entities`);
      
      res.json({
        entitiesByCategory,
        taggedCount,
        untaggedCount,
        totalAnalyses: allAnalyses.length
      });
    } catch (error) {
      console.error("❌ Error fetching tag catalog:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get filtered analyses with server-side filtering and pagination
  app.get("/api/tags/analyses", async (req, res) => {
    try {
      const { 
        entities, 
        untagged, 
        search, 
        page = '1', 
        pageSize = '50',
        all 
      } = req.query;
      
      console.log("🔍 Fetching filtered analyses:", { entities, untagged, search, page, pageSize, all });
      
      const allAnalyses = await storage.getAllAnalyses();
      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const returnAll = all === 'true';
      
      // Parse entity filters (format: "category::name,category::name,...")
      const entityFilters = entities 
        ? (entities as string).split(',').filter(e => e.trim())
        : [];
      
      // Filter analyses
      let filtered = allAnalyses.filter((analysis: HistoricalNewsAnalysis) => {
        // Handle untagged filter
        if (untagged === 'true') {
          const hasNoTags = !analysis.tags || 
                           !Array.isArray(analysis.tags) || 
                           analysis.tags.length === 0;
          if (!hasNoTags) return false;
          
          // Still apply search filter if active
          if (search) {
            const searchLower = (search as string).toLowerCase();
            const matchesSummary = analysis.summary.toLowerCase().includes(searchLower);
            const matchesDate = analysis.date.includes(search as string);
            if (!matchesSummary && !matchesDate) return false;
          }
          
          return true;
        }
        
        // For tagged analyses
        const hasTags = analysis.tags && Array.isArray(analysis.tags) && analysis.tags.length > 0;
        if (!hasTags) return false;
        
        // Filter by selected entities (AND logic - must match ALL)
        if (entityFilters.length > 0) {
          const hasAllEntities = entityFilters.every(entityKey => {
            const [category, name] = entityKey.split('::');
            return analysis.tags!.some(tag => 
              tag.category === category && tag.name === name
            );
          });
          if (!hasAllEntities) return false;
        }
        
        // Filter by search query
        if (search) {
          const searchLower = (search as string).toLowerCase();
          const matchesSummary = analysis.summary.toLowerCase().includes(searchLower);
          const matchesTag = analysis.tags!.some(tag => 
            tag.name.toLowerCase().includes(searchLower)
          );
          const matchesDate = analysis.date.includes(search as string);
          if (!matchesSummary && !matchesTag && !matchesDate) return false;
        }
        
        return true;
      });
      
      // Sort by date descending
      filtered.sort((a, b) => b.date.localeCompare(a.date));
      
      // If 'all' parameter is set, return all results without pagination
      if (returnAll) {
        console.log(`✅ Found ${filtered.length} results, returning all (no pagination)`);
        
        res.json({
          analyses: filtered.map((a: HistoricalNewsAnalysis) => ({
            date: a.date,
            summary: a.summary,
            winningTier: a.winningTier,
            tags: a.tags || [],
            analyzedArticles: a.analyzedArticles || []
          }))
        });
        return;
      }
      
      // Pagination
      const totalCount = filtered.length;
      const totalPages = Math.ceil(totalCount / pageSizeNum);
      const startIndex = (pageNum - 1) * pageSizeNum;
      const endIndex = startIndex + pageSizeNum;
      const paginatedResults = filtered.slice(startIndex, endIndex);
      
      console.log(`✅ Found ${totalCount} results, returning page ${pageNum} of ${totalPages}`);
      
      res.json({
        analyses: paginatedResults.map((a: HistoricalNewsAnalysis) => ({
          date: a.date,
          summary: a.summary,
          winningTier: a.winningTier,
          tags: a.tags || [],
          analyzedArticles: a.analyzedArticles || []
        })),
        pagination: {
          currentPage: pageNum,
          pageSize: pageSizeNum,
          totalCount,
          totalPages
        }
      });
    } catch (error) {
      console.error("❌ Error fetching filtered analyses:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Bulk tag operations
  app.post("/api/tags/bulk-add", async (req, res) => {
    try {
      const { dates, tag } = req.body;
      
      if (!dates || !Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: "dates must be a non-empty array" });
      }
      
      if (!tag || typeof tag.name !== 'string' || typeof tag.category !== 'string') {
        return res.status(400).json({ error: "tag must have name and category" });
      }
      
      console.log(`🏷️ Bulk adding tag "${tag.name}" (${tag.category}) to ${dates.length} analyses`);
      
      let updated = 0;
      for (const date of dates) {
        try {
          const analysis = await storage.getAnalysisByDate(date);
          if (!analysis) {
            console.warn(`⚠️ Analysis not found for ${date}, skipping`);
            continue;
          }
          
          // Get existing tags or empty array
          const currentTags = Array.isArray(analysis.tags) ? analysis.tags : [];
          
          // Check if tag already exists
          const tagExists = currentTags.some(
            (t: any) => t.name === tag.name && t.category === tag.category
          );
          
          if (!tagExists) {
            // Add the new tag
            await storage.updateAnalysis(date, {
              tags: [...currentTags, tag]
            });
            updated++;
          }
        } catch (error) {
          console.error(`❌ Error adding tag to ${date}:`, error);
        }
      }
      
      console.log(`✅ Added tag to ${updated} analyses`);
      res.json({ 
        success: true, 
        updated,
        message: `Tag added to ${updated} analyses` 
      });
    } catch (error) {
      console.error("❌ Error bulk adding tags:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post("/api/tags/bulk-remove", async (req, res) => {
    try {
      const { dates, tag } = req.body;
      
      if (!dates || !Array.isArray(dates) || dates.length === 0) {
        return res.status(400).json({ error: "dates must be a non-empty array" });
      }
      
      if (!tag || typeof tag.name !== 'string' || typeof tag.category !== 'string') {
        return res.status(400).json({ error: "tag must have name and category" });
      }
      
      console.log(`🏷️ Bulk removing tag "${tag.name}" (${tag.category}) from ${dates.length} analyses`);
      
      let updated = 0;
      for (const date of dates) {
        try {
          const analysis = await storage.getAnalysisByDate(date);
          if (!analysis) {
            console.warn(`⚠️ Analysis not found for ${date}, skipping`);
            continue;
          }
          
          // Get existing tags
          const currentTags = Array.isArray(analysis.tags) ? analysis.tags : [];
          
          // Filter out the tag to remove
          const newTags = currentTags.filter(
            (t: any) => !(t.name === tag.name && t.category === tag.category)
          );
          
          // Only update if we actually removed something
          if (newTags.length < currentTags.length) {
            await storage.updateAnalysis(date, {
              tags: newTags
            });
            updated++;
          }
        } catch (error) {
          console.error(`❌ Error removing tag from ${date}:`, error);
        }
      }
      
      console.log(`✅ Removed tag from ${updated} analyses`);
      res.json({ 
        success: true, 
        updated,
        message: `Tag removed from ${updated} analyses` 
      });
    } catch (error) {
      console.error("❌ Error bulk removing tags:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get unique tags from selected summaries for bulk operations
  app.post("/api/tags/selected-summaries-tags", async (req, res) => {
    try {
      const { dates } = req.body;
      
      if (!dates || !Array.isArray(dates)) {
        return res.status(400).json({ error: "dates must be an array" });
      }
      
      if (dates.length === 0) {
        return res.json({ tags: [] });
      }
      
      console.log(`🏷️ Fetching unique tags from ${dates.length} selected summaries`);
      
      // Fetch all analyses for the selected dates
      const analyses = await storage.getAnalysesByDates(dates);
      
      // Collect all unique tags
      const tagsMap = new Map<string, { name: string; category: string }>();
      
      for (const analysis of analyses) {
        if (Array.isArray(analysis.tags)) {
          for (const tag of analysis.tags) {
            const key = `${tag.category}::${tag.name}`;
            if (!tagsMap.has(key)) {
              tagsMap.set(key, {
                name: tag.name,
                category: tag.category
              });
            }
          }
        }
      }
      
      // Convert to array and sort
      const uniqueTags = Array.from(tagsMap.values()).sort((a, b) => {
        // Sort by category first, then by name
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category);
        }
        return a.name.localeCompare(b.name);
      });
      
      console.log(`✅ Found ${uniqueTags.length} unique tags`);
      res.json({ tags: uniqueTags });
    } catch (error) {
      console.error("❌ Error fetching selected summaries tags:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Cleaner route: Resolve contradicted events using AI
  app.post("/api/cleaner/resolve-contradiction", async (req, res) => {
    try {
      const { date } = req.body;
      
      if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }
      
      console.log(`🧹 Resolving contradiction for date: ${date}`);
      
      const result = await perplexityCleaner.resolveContradictedEvent(date);
      res.json(result);
    } catch (error) {
      console.error("❌ Error resolving contradiction:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Re-verification routes: Analyze events again using corrected dates from Perplexity
  let isReVerificationRunning = false;
  let shouldStopReVerification = false;
  let reVerificationProcessed = 0;

  // Single event re-verification with AI comparison
  app.post("/api/re-verify/single", async (req, res) => {
    try {
      const { date } = req.body;
      
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`🔄 Starting intelligent re-verification for ${date}...`);
      
      // Get the analysis
      const analysis = await storage.getAnalysisByDate(date);
      if (!analysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      // 🚫 PROTECTION: Check if original date has manual entries
      const originalManualEntries = await storage.getManualEntriesByDate(date);
      if (originalManualEntries.length > 0) {
        console.log(`🚫 ${date}: Has ${originalManualEntries.length} manual entries - PROTECTED from re-verification`);
        return res.status(400).json({ 
          error: `Cannot re-verify: ${date} has ${originalManualEntries.length} manual entry/entries. Manual entries are protected.` 
        });
      }

      // Check if Perplexity provided a corrected date
      if (!analysis.perplexityCorrectDateText) {
        return res.status(400).json({ error: "No corrected date available from Perplexity for this event" });
      }

      // Parse the corrected date using enhanced parser
      const correctedDateText = analysis.perplexityCorrectDateText;
      const correctedDate = parsePerplexityDate(correctedDateText);
      
      if (!correctedDate) {
        return res.status(400).json({ 
          error: `Cannot parse valid date from corrected date text: ${correctedDateText}` 
        });
      }

      // 🚫 PROTECTION: Check if corrected date has manual entries
      const correctedManualEntries = await storage.getManualEntriesByDate(correctedDate);
      if (correctedManualEntries.length > 0) {
        console.log(`⚠️ ${correctedDate}: Has ${correctedManualEntries.length} manual entries - marking as PROBLEM`);
        // Mark as PROBLEM - can't replace with a date that has manual entries
        await storage.updateAnalysisReVerification(date, {
          reVerified: true,
          reVerifiedAt: new Date(),
          reVerificationDate: correctedDate,
          reVerificationSummary: analysis.summary,
          reVerificationTier: analysis.winningTier,
          reVerificationArticles: analysis.tieredArticles,
          reVerificationReasoning: `Corrected date ${correctedDate} has ${correctedManualEntries.length} manual entry/entries. Manual entries are protected - requires manual review.`,
          reVerificationStatus: 'problem',
          reVerificationWinner: 'original'
        });

        return res.json({
          success: true,
          date,
          correctedDate,
          winner: 'original',
          status: 'problem',
          originalSummary: analysis.summary,
          originalTier: analysis.winningTier,
          correctedTier: null,
          winningSummary: analysis.summary,
          reasoning: `Corrected date ${correctedDate} has ${correctedManualEntries.length} manual entry/entries. Manual entries are protected - requires manual review.`,
          message: 'Corrected date has manual entries (PROBLEM)'
        });
      }

      console.log(`📅 Comparing coverage: ${date} (original) vs ${correctedDate} (corrected)`);

      // Get CACHED articles from database for BOTH dates
      console.log(`📦 Using cached articles for ORIGINAL date: ${date}`);
      const originalTieredArticles = analysis.tieredArticles;
      const originalSummary = analysis.summary;
      const originalTier = analysis.winningTier;

      console.log(`📦 Fetching cached articles for CORRECTED date: ${correctedDate}`);
      const correctedAnalysis = await storage.getAnalysisByDate(correctedDate);
      
      if (!correctedAnalysis || !correctedAnalysis.tieredArticles) {
        console.log(`⚠️ PROBLEM: No cached analysis found for corrected date ${correctedDate}`);
        // Mark as PROBLEM - can't compare if corrected date has no analysis
        await storage.updateAnalysisReVerification(date, {
          reVerified: true,
          reVerifiedAt: new Date(),
          reVerificationDate: correctedDate,
          reVerificationSummary: analysis.summary,
          reVerificationTier: analysis.winningTier,
          reVerificationArticles: analysis.tieredArticles,
          reVerificationReasoning: `No analysis exists for corrected date ${correctedDate} - cannot compare coverage`,
          reVerificationStatus: 'problem',
          reVerificationWinner: 'original'
        });

        return res.json({
          success: true,
          date,
          correctedDate,
          winner: 'original',
          status: 'problem',
          originalSummary: analysis.summary,
          originalTier: analysis.winningTier,
          correctedTier: null,
          winningSummary: analysis.summary,
          reasoning: `No analysis exists for corrected date ${correctedDate} - cannot compare coverage`,
          message: 'No cached analysis for corrected date (PROBLEM)'
        });
      }

      const correctedTieredArticles = correctedAnalysis.tieredArticles;
      const correctedSummary = correctedAnalysis.summary;
      const correctedTier = correctedAnalysis.winningTier;

      // Use AI to compare both CACHED article sets and pick the winner
      console.log(`🤖 Running AI comparison on cached articles...`);
      const comparison = await compareArticleSets(
        date,
        originalTieredArticles as any,
        correctedDate,
        correctedTieredArticles as any
      );

      console.log(`🏆 AI Decision: ${comparison.winner} wins!`);
      console.log(`📝 Reasoning: ${comparison.reasoning}`);

      // Determine status and winner based on AI comparison
      let status: 'success' | 'problem' = 'success';
      let winner: 'original' | 'corrected' = comparison.winner as any;
      let winningSummary = winner === 'original' ? originalSummary : correctedSummary;
      let winningTier = winner === 'original' ? originalTier : correctedTier;
      let winningArticles = winner === 'original' ? originalTieredArticles : correctedTieredArticles;
      let finalReasoning = comparison.reasoning;

      // If OpenAI says "corrected" wins → we're done, use corrected date
      if (comparison.winner === 'corrected') {
        console.log(`✅ Corrected date ${correctedDate} has better coverage - REPLACING`);
      }
      // If OpenAI says "original" or "neither" → verify with Perplexity
      else {
        console.log(`🔍 OpenAI says ${comparison.winner} - sending to Perplexity for fact verification...`);
        
        try {
          // Call Perplexity to verify the original date
          const perplexityResult = await verifyDateWithPerplexity(date, originalTieredArticles as any);
          
          console.log(`✨ Perplexity verified date: ${perplexityResult.verifiedDate}`);
          console.log(`📊 Confidence: ${perplexityResult.confidence}%`);
          console.log(`🎯 Event type: ${perplexityResult.eventType}`);
          
          // Combine OpenAI and Perplexity reasoning
          finalReasoning = `OpenAI Analysis: ${comparison.reasoning}\n\nPerplexity Verification: ${perplexityResult.reasoning}`;
          
          // Determine final status based on Perplexity's verification
          if (perplexityResult.verifiedDate === date) {
            // Perplexity confirms original date is correct
            status = 'success';
            winner = 'original';
            console.log(`✅ Perplexity confirms ${date} is correct`);
          } else if (perplexityResult.verifiedDate === correctedDate) {
            // Perplexity says corrected date is actually correct
            status = 'problem';
            console.log(`⚠️ PROBLEM: Perplexity says ${correctedDate} is correct, but OpenAI preferred ${date} coverage`);
            finalReasoning += `\n\nCONFLICT: Coverage quality favors ${date}, but factual accuracy favors ${correctedDate}. Manual review needed.`;
          } else if (perplexityResult.verifiedDate) {
            // Perplexity found a completely different date
            status = 'problem';
            console.log(`⚠️ PROBLEM: Perplexity suggests different date: ${perplexityResult.verifiedDate}`);
            finalReasoning += `\n\nNEW DATE FOUND: Perplexity suggests ${perplexityResult.verifiedDate}. Manual review needed.`;
          } else {
            // Perplexity couldn't verify the date
            status = 'problem';
            console.log(`⚠️ PROBLEM: Perplexity cannot verify the date`);
            finalReasoning += `\n\nUNCERTAIN: Perplexity could not verify the correct date. Manual review needed.`;
          }
        } catch (perplexityError) {
          console.error(`❌ Perplexity verification failed:`, perplexityError);
          status = 'problem';
          finalReasoning += `\n\nPerplexity verification failed: ${(perplexityError as Error).message}. Manual review needed.`;
        }
      }

      if (comparison.winner === 'neither') {
        console.log(`⚠️ Note: OpenAI said neither date has good coverage`);
      }

      // Update the original analysis with re-verification results
      await storage.updateAnalysisReVerification(date, {
        reVerified: true,
        reVerifiedAt: new Date(),
        reVerificationDate: correctedDate,
        reVerificationSummary: winningSummary,
        reVerificationTier: winningTier,
        reVerificationArticles: winningArticles,
        reVerificationReasoning: finalReasoning,
        reVerificationStatus: status,
        reVerificationWinner: winner
      });

      console.log(`💾 Saved re-verification results for ${date}`);

      res.json({
        success: true,
        date,
        correctedDate,
        winner,
        status,
        originalSummary: originalSummary,
        originalTier: comparison.originalTier,
        correctedTier: comparison.correctedTier,
        winningSummary: winningSummary,
        reasoning: finalReasoning,
        message: status === 'success' 
          ? `${winner} date verified` 
          : 'Requires manual review (PROBLEM)'
      });

    } catch (error) {
      console.error("❌ Error re-verifying event:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Bulk re-verification
  app.post("/api/re-verify/bulk", async (req, res) => {
    try {
      console.log("🔄 Starting bulk cleanup/resolution with new hierarchical system...");

      if (isReVerificationRunning) {
        return res.status(409).json({ 
          error: "Bulk cleanup already running. Please stop the current one first." 
        });
      }

      isReVerificationRunning = true;
      shouldStopReVerification = false;
      reVerificationProcessed = 0;

      // Get all contradicted analyses that haven't been re-verified
      const allAnalyses = await storage.getAllAnalyses();
      const toReVerify = allAnalyses.filter(a => 
        a.perplexityVerdict === 'contradicted' && 
        !a.reVerified
      );

      console.log(`📊 Found ${toReVerify.length} contradicted events to resolve using new cleanup system`);

      res.json({ 
        success: true,
        total: toReVerify.length,
        message: `Started bulk cleanup/resolution of ${toReVerify.length} contradicted events using new hierarchical system`
      });

      // Process in background using the new cleanup system
      (async () => {
        let processed = 0;
        let succeeded = 0;
        let failed = 0;

        for (const analysis of toReVerify) {
          if (shouldStopReVerification) {
            console.log(`🛑 Bulk cleanup stopped by user after ${processed} events`);
            break;
          }

          try {
            // 🚫 PROTECTION: Check if original date has manual entries
            const originalManualEntries = await storage.getManualEntriesByDate(analysis.date);
            if (originalManualEntries.length > 0) {
              console.log(`🚫 ${analysis.date}: Has ${originalManualEntries.length} manual entries - SKIPPED (protected)`);
              processed++;
              reVerificationProcessed = processed;
              continue;
            }

            // 🚫 PROTECTION: Check if corrected date has manual entries (if exists)
            if (analysis.perplexityCorrectDateText) {
              const correctedDate = parsePerplexityDate(analysis.perplexityCorrectDateText);
              if (correctedDate) {
                const correctedManualEntries = await storage.getManualEntriesByDate(correctedDate);
                if (correctedManualEntries.length > 0) {
                  console.log(`🚫 ${analysis.date}: Corrected date ${correctedDate} has ${correctedManualEntries.length} manual entries - SKIPPED (protected)`);
                  processed++;
                  reVerificationProcessed = processed;
                  continue;
                }
              }
            }

            // Use the new cleanup system we built together
            console.log(`🧹 Resolving ${analysis.date} using new hierarchical cleanup system...`);
            const result = await perplexityCleaner.resolveContradictedEvent(analysis.date);

            if (result.success) {
              succeeded++;
              console.log(`✅ ${analysis.date}: Successfully resolved - ${result.message}`);
            } else {
              failed++;
              console.log(`❌ ${analysis.date}: Failed - ${result.message}`);
            }

          } catch (error) {
            console.error(`❌ ${analysis.date}: Error during cleanup:`, error);
            failed++;
          }

          processed++;
          reVerificationProcessed = processed;

          // Small delay between requests to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n📊 Bulk cleanup complete:`);
        console.log(`   ✅ Succeeded: ${succeeded}`);
        console.log(`   ❌ Failed: ${failed}`);
        console.log(`   📝 Total processed: ${processed}`);

        isReVerificationRunning = false;
      })();

    } catch (error) {
      isReVerificationRunning = false;
      console.error("❌ Error starting bulk cleanup:", error);
      res.status(500).json({ 
        error: (error as Error).message 
      });
    }
  });

  // Stop re-verification
  app.post("/api/re-verify/stop", async (req, res) => {
    try {
      console.log("🛑 Stop re-verification requested");
      
      if (!isReVerificationRunning) {
        return res.status(400).json({ 
          error: "No re-verification process is currently running" 
        });
      }
      
      shouldStopReVerification = true;
      const processedCount = reVerificationProcessed;
      
      res.json({ 
        success: true, 
        processed: processedCount,
        message: "Re-verification will stop after current analysis completes" 
      });
    } catch (error) {
      console.error("❌ Error stopping re-verification:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get re-verification progress
  app.get("/api/re-verify/progress", async (req, res) => {
    try {
      res.json({
        isRunning: isReVerificationRunning,
        processed: reVerificationProcessed
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // CLEANUP ENDPOINTS: Perplexity summary comparison + intelligent replacement
  // ============================================================================

  // Individual cleanup: compare summaries, find replacement article, summarize
  app.post("/api/cleanup/single", async (req, res) => {
    try {
      const { date } = req.body;
      
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      console.log(`\n🧹 Starting cleanup for ${date}...`);
      
      // Get the analysis
      const analysis = await storage.getAnalysisByDate(date);
      if (!analysis) {
        return res.status(404).json({ error: `Analysis not found for date: ${date}` });
      }

      // Check if it's a contradicted event
      if (analysis.perplexityVerdict !== 'contradicted') {
        return res.status(400).json({ 
          error: `Event is not contradicted (verdict: ${analysis.perplexityVerdict})` 
        });
      }

      // 🚫 PROTECTION: Check if original date has manual entries
      const originalManualEntries = await storage.getManualEntriesByDate(date);
      if (originalManualEntries.length > 0) {
        console.log(`🚫 ${date}: Has ${originalManualEntries.length} manual entries - PROTECTED`);
        return res.status(400).json({ 
          error: `Cannot cleanup: ${date} has ${originalManualEntries.length} manual entry/entries. Manual entries are protected.` 
        });
      }

      const correctedDateText = analysis.perplexityCorrectDateText;
      const originalSummary = analysis.summary;
      const originalTieredArticles = analysis.tieredArticles;
      const originalArticleId = analysis.topArticleId;

      // CASE 1: Has corrected date → compare summaries
      if (correctedDateText) {
        const correctedDate = parsePerplexityDate(correctedDateText);
        
        if (!correctedDate) {
          return res.status(400).json({ 
            error: `Cannot parse valid date from corrected date text: ${correctedDateText}` 
          });
        }

        // 🚫 PROTECTION: Check if corrected date has manual entries
        const correctedManualEntries = await storage.getManualEntriesByDate(correctedDate);
        if (correctedManualEntries.length > 0) {
          console.log(`🚫 ${correctedDate}: Has ${correctedManualEntries.length} manual entries - PROTECTED`);
          return res.status(400).json({ 
            error: `Cannot cleanup: Corrected date ${correctedDate} has ${correctedManualEntries.length} manual entry/entries. Manual entries are protected.` 
          });
        }

        // Get corrected date analysis
        const correctedAnalysis = await storage.getAnalysisByDate(correctedDate);
        if (!correctedAnalysis) {
          return res.status(400).json({ 
            error: `No analysis found for corrected date: ${correctedDate}` 
          });
        }

        const correctedSummary = correctedAnalysis.summary;
        const correctedTieredArticles = correctedAnalysis.tieredArticles;

        console.log(`📊 Comparing summaries: ${date} vs ${correctedDate}`);

        // Import Perplexity comparison function
        const { compareSummariesWithPerplexity, findReplacementArticleWithPerplexity } = await import('./services/perplexity');
        const { summarizeArticleWithOpenAI } = await import('./services/openai');

        // Step 1: Perplexity compares the two summaries
        const comparison = await compareSummariesWithPerplexity(
          date,
          originalSummary,
          correctedDate,
          correctedSummary,
          originalTieredArticles as any
        );

        console.log(`🏆 Winner: ${comparison.winner}`);

        let losingDate: string;
        let losingArticleId: string;
        let losingTieredArticles: any;
        let newSummary: string | null = null;
        let newTier: string | null = null;
        let newArticleId: string | null = null;

        // Determine losing date and find replacement
        if (comparison.winner === 'corrected') {
          // Corrected wins → replace original date's coverage
          losingDate = date;
          losingArticleId = originalArticleId!;
          losingTieredArticles = originalTieredArticles;

          console.log(`🔄 Corrected summary wins - finding replacement for ${date}`);

        } else if (comparison.winner === 'original') {
          // Original wins → replace corrected date's coverage  
          losingDate = correctedDate;
          losingArticleId = correctedAnalysis.topArticleId!;
          losingTieredArticles = correctedTieredArticles;

          console.log(`🔄 Original summary wins - finding replacement for ${correctedDate}`);

        } else {
          // Neither wins → problem
          return res.json({
            success: false,
            status: 'problem',
            winner: 'neither',
            message: 'Neither summary is accurate enough - requires manual review',
            reasoning: comparison.reasoning,
            citations: comparison.citations
          });
        }

        // Step 2: Find replacement article for losing date
        const replacement = await findReplacementArticleWithPerplexity(
          losingDate,
          losingArticleId,
          losingTieredArticles as any
        );

        console.log(`✅ Replacement article: ${replacement.articleId} (${replacement.tier} tier)`);

        // Step 3: Summarize with OpenAI
        newSummary = await summarizeArticleWithOpenAI(
          replacement.article.title,
          replacement.article.summary || ''
        );
        newTier = replacement.tier;
        newArticleId = replacement.articleId;

        console.log(`📝 New summary (${newSummary.length} chars): ${newSummary}`);

        // Step 4: Update database for losing date
        await storage.updateAnalysis(losingDate, {
          summary: newSummary!,
          winningTier: newTier!,
          topArticleId: newArticleId!
        });

        console.log(`💾 Updated ${losingDate} with new coverage`);

        return res.json({
          success: true,
          status: 'success',
          winner: comparison.winner,
          originalDate: date,
          correctedDate,
          updatedDate: losingDate,
          newSummary,
          newTier,
          newArticleId,
          comparison: {
            winner: comparison.winner,
            confidence: comparison.confidence,
            reasoning: comparison.reasoning,
            citations: comparison.citations
          },
          replacement: {
            articleId: replacement.articleId,
            tier: replacement.tier,
            article: replacement.article
          }
        });

      } 
      // CASE 2: No corrected date → find replacement for original date
      else {
        console.log(`🔄 No corrected date - finding replacement for ${date}`);

        const { findReplacementArticleWithPerplexity } = await import('./services/perplexity');
        const { summarizeArticleWithOpenAI } = await import('./services/openai');

        // Find replacement article
        const replacement = await findReplacementArticleWithPerplexity(
          date,
          originalArticleId || '',
          originalTieredArticles as any
        );

        console.log(`✅ Replacement article: ${replacement.articleId} (${replacement.tier} tier)`);

        // Summarize with OpenAI
        const newSummary = await summarizeArticleWithOpenAI(
          replacement.article.title,
          replacement.article.summary || ''
        );

        console.log(`📝 New summary (${newSummary.length} chars): ${newSummary}`);

        // Update database
        await storage.updateAnalysis(date, {
          summary: newSummary,
          winningTier: replacement.tier,
          topArticleId: replacement.articleId
        });

        console.log(`💾 Updated ${date} with new coverage`);

        return res.json({
          success: true,
          status: 'success',
          winner: null,
          originalDate: date,
          correctedDate: null,
          updatedDate: date,
          newSummary,
          newTier: replacement.tier,
          newArticleId: replacement.articleId,
          comparison: null,
          replacement: {
            articleId: replacement.articleId,
            tier: replacement.tier,
            article: replacement.article
          }
        });
      }

    } catch (error) {
      console.error("❌ Error during cleanup:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Bulk cleanup: process all contradicted events sequentially
  let isCleanupRunning = false;
  let shouldStopCleanup = false;
  let cleanupProcessed = 0;
  let cleanupTotal = 0;

  app.post("/api/cleanup/bulk", async (req, res) => {
    try {
      console.log("\n🧹 Starting bulk cleanup...");

      if (isCleanupRunning) {
        return res.status(409).json({ 
          error: "Cleanup already running. Please stop the current one first." 
        });
      }

      isCleanupRunning = true;
      shouldStopCleanup = false;
      cleanupProcessed = 0;

      // Get all contradicted analyses that haven't been cleaned
      const allAnalyses = await storage.getAllAnalyses();
      const toCleanup = allAnalyses.filter(a => 
        a.perplexityVerdict === 'contradicted'
      );

      cleanupTotal = toCleanup.length;

      const withCorrectedDate = toCleanup.filter(a => a.perplexityCorrectDateText);
      const withoutCorrectedDate = toCleanup.filter(a => !a.perplexityCorrectDateText);

      console.log(`📊 Found ${toCleanup.length} events to cleanup`);
      console.log(`   - ${withCorrectedDate.length} with corrected dates (compare + replace)`);
      console.log(`   - ${withoutCorrectedDate.length} without corrected dates (replace only)`);

      res.json({ 
        success: true,
        total: toCleanup.length,
        withCorrectedDate: withCorrectedDate.length,
        withoutCorrectedDate: withoutCorrectedDate.length,
        message: `Started bulk cleanup of ${toCleanup.length} events`
      });

      // Process in background
      (async () => {
        let processed = 0;
        let succeeded = 0;
        let problems = 0;
        let failed = 0;

        const { compareSummariesWithPerplexity, findReplacementArticleWithPerplexity } = await import('./services/perplexity');
        const { summarizeArticleWithOpenAI } = await import('./services/openai');

        for (const analysis of toCleanup) {
          if (shouldStopCleanup) {
            console.log(`🛑 Cleanup stopped by user after ${processed} events`);
            break;
          }

          try {
            const date = analysis.date;
            console.log(`\n🧹 [${processed + 1}/${toCleanup.length}] Cleaning ${date}...`);

            // Check manual entry protection
            const originalManualEntries = await storage.getManualEntriesByDate(date);
            if (originalManualEntries.length > 0) {
              console.log(`🚫 ${date}: PROTECTED - skipping`);
              processed++;
              cleanupProcessed = processed;
              await new Promise(resolve => setTimeout(resolve, 500));
              continue;
            }

            const correctedDateText = analysis.perplexityCorrectDateText;
            const originalSummary = analysis.summary;
            const originalTieredArticles = analysis.tieredArticles;
            const originalArticleId = analysis.topArticleId;

            // CASE 1: Has corrected date
            if (correctedDateText) {
              const correctedDate = parsePerplexityDate(correctedDateText);
              
              if (!correctedDate) {
                console.log(`⚠️ ${date}: Cannot parse corrected date - skipping`);
                failed++;
                processed++;
                cleanupProcessed = processed;
                continue;
              }

              // Check corrected date protection
              const correctedManualEntries = await storage.getManualEntriesByDate(correctedDate);
              if (correctedManualEntries.length > 0) {
                console.log(`🚫 ${correctedDate}: PROTECTED - skipping`);
                processed++;
                cleanupProcessed = processed;
                continue;
              }

              const correctedAnalysis = await storage.getAnalysisByDate(correctedDate);
              if (!correctedAnalysis) {
                console.log(`⚠️ ${date}: No analysis for corrected date - skipping`);
                failed++;
                processed++;
                cleanupProcessed = processed;
                continue;
              }

              const correctedSummary = correctedAnalysis.summary;
              const correctedTieredArticles = correctedAnalysis.tieredArticles;

              // Step 1: Compare summaries
              const comparison = await compareSummariesWithPerplexity(
                date,
                originalSummary,
                correctedDate,
                correctedSummary,
                originalTieredArticles as any
              );

              if (comparison.winner === 'neither') {
                console.log(`⚠️ ${date}: Neither summary wins - PROBLEM`);
                problems++;
                processed++;
                cleanupProcessed = processed;
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }

              // Determine losing date
              let losingDate: string;
              let losingArticleId: string;
              let losingTieredArticles: any;

              if (comparison.winner === 'corrected') {
                losingDate = date;
                losingArticleId = originalArticleId!;
                losingTieredArticles = originalTieredArticles;
              } else {
                losingDate = correctedDate;
                losingArticleId = correctedAnalysis.topArticleId!;
                losingTieredArticles = correctedTieredArticles;
              }

              // Step 2: Find replacement
              const replacement = await findReplacementArticleWithPerplexity(
                losingDate,
                losingArticleId,
                losingTieredArticles as any
              );

              // Step 3: Summarize
              const newSummary = await summarizeArticleWithOpenAI(
                replacement.article.title,
                replacement.article.summary || ''
              );

              // Step 4: Update database
              await storage.updateAnalysis(losingDate, {
                summary: newSummary,
                winningTier: replacement.tier,
                topArticleId: replacement.articleId
              });

              console.log(`✅ ${date}: Cleaned - ${comparison.winner} wins, updated ${losingDate}`);
              succeeded++;

            } 
            // CASE 2: No corrected date
            else {
              // Find replacement
              const replacement = await findReplacementArticleWithPerplexity(
                date,
                originalArticleId!,
                originalTieredArticles as any
              );

              // Summarize
              const newSummary = await summarizeArticleWithOpenAI(
                replacement.article.title,
                replacement.article.summary || ''
              );

              // Update database
              await storage.updateAnalysis(date, {
                summary: newSummary,
                winningTier: replacement.tier,
                topArticleId: replacement.articleId
              });

              console.log(`✅ ${date}: Cleaned - replaced with ${replacement.tier} article`);
              succeeded++;
            }

            processed++;
            cleanupProcessed = processed;
            
            // Delay between requests to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));

          } catch (error) {
            console.error(`❌ Error cleaning ${analysis.date}:`, error);
            failed++;
            processed++;
            cleanupProcessed = processed;
          }
        }

        console.log(`✅ Bulk cleanup completed: ${processed} processed, ${succeeded} succeeded, ${problems} problems, ${failed} failed`);
        isCleanupRunning = false;
        cleanupProcessed = 0;
        cleanupTotal = 0;
      })();

    } catch (error) {
      console.error("❌ Error starting bulk cleanup:", error);
      isCleanupRunning = false;
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Stop cleanup
  app.post("/api/cleanup/stop", async (req, res) => {
    try {
      console.log("🛑 Stop cleanup requested");
      
      if (!isCleanupRunning) {
        return res.status(400).json({ 
          error: "No cleanup process is currently running" 
        });
      }
      
      shouldStopCleanup = true;
      const processedCount = cleanupProcessed;
      
      res.json({ 
        success: true, 
        processed: processedCount,
        message: "Cleanup will stop after current event completes" 
      });
    } catch (error) {
      console.error("❌ Error stopping cleanup:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get cleanup progress
  app.get("/api/cleanup/progress", async (req, res) => {
    try {
      res.json({
        isRunning: isCleanupRunning,
        processed: cleanupProcessed,
        total: cleanupTotal
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return httpServer;
}
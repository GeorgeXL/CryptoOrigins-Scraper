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
import { db } from "../db";
import { findSimilarTags, calculateSimilarity, normalizeTagName } from "../services/tag-similarity";
import { categorizeTag, categorizeTags } from "../services/tag-categorizer";
import { getCategoryDisplayMeta, getCategoryKeyFromPath, getTaxonomyLabel, TAXONOMY_TREE } from "@shared/taxonomy";

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

// Global state to control AI categorization process
let shouldStopAiCategorization = false;
let isAiCategorizationRunning = false;
let aiCategorizationProcessed = 0;
let aiCategorizationTotal = 0;
let aiCategorizationCurrentTag = '';

const router = Router();

router.post("/api/batch-tagging/start", async (req, res) => {
  try {
    const { dates } = req.body; // Optional array of specific dates to process
    
    // Check if already running
    if (isBatchTaggingRunning) {
      return res.status(409).json({ 
        error: "Batch tagging already running. Please stop the current one first." 
      });
    }
    
    let eligibleAnalyses;
    let allAnalyses;
    
    if (dates && Array.isArray(dates) && dates.length > 0) {
      // Process only selected dates
      console.log(`🏷️ Starting batch tagging for ${dates.length} selected dates...`);
      allAnalyses = await storage.getAllAnalyses();
      eligibleAnalyses = allAnalyses.filter(a => 
        dates.includes(a.date) &&
        a.summary && 
        a.summary.trim().length > 0 &&
        (!a.tagsVersion2 || (Array.isArray(a.tagsVersion2) && a.tagsVersion2.length === 0))
      );
      const alreadyTaggedInSelection = dates.length - eligibleAnalyses.length;
      batchTaggingTotal = eligibleAnalyses.length;
      console.log(`✅ Found ${batchTaggingTotal} untagged analyses in selection (${alreadyTaggedInSelection} already tagged, will be skipped)`);
      console.log(`📊 Processing ${batchTaggingTotal} selected analyses with max 8 concurrent requests at a time`);
    } else {
      // Process all untagged analyses
      console.log("🏷️ Starting batch tagging of entire database...");
      allAnalyses = await storage.getAllAnalyses();
      eligibleAnalyses = allAnalyses.filter(a => 
        a.summary && 
        a.summary.trim().length > 0 &&
        (!a.tagsVersion2 || (Array.isArray(a.tagsVersion2) && a.tagsVersion2.length === 0))
      );
      const alreadyTagged = allAnalyses.filter(a => 
        a.summary && 
        a.summary.trim().length > 0 &&
        a.tagsVersion2 && 
        Array.isArray(a.tagsVersion2) &&
        a.tagsVersion2.length > 0
      ).length;
      batchTaggingTotal = eligibleAnalyses.length;
      console.log(`✅ Found ${batchTaggingTotal} untagged analyses to process (${alreadyTagged} already tagged, will be skipped)`);
      console.log(`📊 Processing ${batchTaggingTotal} analyses with max 8 concurrent requests at a time`);
    }
    
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
    
    // Start background processing with 8-at-a-time concurrent processing
    (async () => {
      let processed = 0;
      let failed = 0;
      const failedDates: string[] = [];
      const MAX_CONCURRENT = 8;
      const running = new Map<string, Promise<{ success: boolean; date: string }>>();
      let index = 0;
      
      // Helper function to process a single analysis
      const processAnalysis = async (analysis: typeof eligibleAnalyses[0]): Promise<{ success: boolean; date: string }> => {
        try {
          const currentIndex = processed + failed + 1;
          console.log(`🏷️ [${currentIndex}/${batchTaggingTotal}] Extracting tags for ${analysis.date}...`);
          
          // Extract tag names from summary (returns simple string array)
          const tagNames = await entityExtractor.extractEntities(analysis.summary);
          
          // Update analysis with tags_version2 (empty array is valid - means no entities found)
          await storage.updateAnalysis(analysis.date, {
            tagsVersion2: tagNames
          });
          
          processed++;
          batchTaggingProcessed = processed + failed;
          
          console.log(`✅ Tagged ${analysis.date} with ${tagNames.length} tags: ${tagNames.slice(0, 5).join(', ')}${tagNames.length > 5 ? '...' : ''}`);
          
          return { success: true, date: analysis.date };
        } catch (error) {
          console.error(`❌ Error tagging ${analysis.date}:`, error);
          failed++;
          failedDates.push(analysis.date);
          batchTaggingProcessed = processed + failed;
          
          return { success: false, date: analysis.date };
        }
      };
      
      // Process analyses with 8-at-a-time batching
      while (index < eligibleAnalyses.length || running.size > 0) {
        // Check if stop was requested
        if (shouldStopBatchTagging) {
          console.log(`🛑 Batch tagging stopped by user after ${processed} analyses (${failed} failed)`);
          break;
        }
        
        // Start new analyses until we have MAX_CONCURRENT running
        while (running.size < MAX_CONCURRENT && index < eligibleAnalyses.length) {
          const analysis = eligibleAnalyses[index];
          const promise = processAnalysis(analysis);
          running.set(analysis.date, promise);
          index++;
        }
        
        // Wait for at least one to complete
        if (running.size > 0) {
          const completed = await Promise.race(
            Array.from(running.entries()).map(([date, promise]) =>
              promise.then(result => ({ result, date })).catch(error => {
                console.error(`Promise error for ${date}:`, error);
                return {
                  result: { success: false, date },
                  date
                };
              })
            )
          );
          running.delete(completed.date);
          
          // Small delay before starting next batch (reduced from 1000ms to 200ms since we're doing concurrent)
          if (index < eligibleAnalyses.length && running.size < MAX_CONCURRENT) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }
      
      console.log(`✅ Batch tagging completed: ${processed} successful, ${failed} failed`);
      if (failedDates.length > 0) {
        console.log(`❌ Failed dates: ${failedDates.join(', ')}`);
      }
      
      // Invalidate catalog cache since tags were updated (both regular and manual-only)
      cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
      cacheManager.invalidate('tags:catalog:manual');
      
      isBatchTaggingRunning = false;
    })();
    
  } catch (error) {
    console.error("❌ Error starting batch tagging:", error);
    isBatchTaggingRunning = false;
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/batch-tagging/stop", async (req, res) => {
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

// Tagging with context (summary + article)
let isContextTaggingRunning = false;
let shouldStopContextTagging = false;
let contextTaggingProcessed = 0;
let contextTaggingTotal = 0;

router.post("/api/tagging/with-context", async (req, res) => {
  try {
    const { dates } = req.body; // Array of specific dates to process
    
    // Check if already running
    if (isContextTaggingRunning) {
      return res.status(409).json({ 
        error: "Context tagging already running. Please stop the current one first." 
      });
    }
    
    let eligibleAnalyses;
    let allAnalyses;
    
    if (dates && Array.isArray(dates) && dates.length > 0) {
      // Process only selected dates
      console.log(`🏷️ Starting context tagging for ${dates.length} selected dates...`);
      allAnalyses = await storage.getAllAnalyses();
      eligibleAnalyses = allAnalyses.filter(a => 
        dates.includes(a.date) &&
        a.summary && 
        a.summary.trim().length > 0 &&
        (!a.tagsVersion2 || (Array.isArray(a.tagsVersion2) && a.tagsVersion2.length === 0))
      );
      const alreadyTaggedInSelection = dates.length - eligibleAnalyses.length;
      contextTaggingTotal = eligibleAnalyses.length;
      console.log(`✅ Found ${contextTaggingTotal} untagged analyses in selection (${alreadyTaggedInSelection} already tagged, will be skipped)`);
      console.log(`📊 Processing ${contextTaggingTotal} selected analyses with max 8 concurrent requests at a time`);
    } else {
      // Process all untagged analyses
      console.log("🏷️ Starting context tagging of entire database...");
      allAnalyses = await storage.getAllAnalyses();
      eligibleAnalyses = allAnalyses.filter(a => 
        a.summary && 
        a.summary.trim().length > 0 &&
        (!a.tagsVersion2 || (Array.isArray(a.tagsVersion2) && a.tagsVersion2.length === 0))
      );
      const alreadyTagged = allAnalyses.filter(a => 
        a.summary && 
        a.summary.trim().length > 0 &&
        a.tagsVersion2 && 
        Array.isArray(a.tagsVersion2) &&
        a.tagsVersion2.length > 0
      ).length;
      contextTaggingTotal = eligibleAnalyses.length;
      console.log(`✅ Found ${contextTaggingTotal} untagged analyses to process (${alreadyTagged} already tagged, will be skipped)`);
      console.log(`📊 Processing ${contextTaggingTotal} analyses with max 8 concurrent requests at a time`);
    }
    
    // Send initial response
    res.json({ 
      success: true, 
      total: contextTaggingTotal,
      message: `Starting context tagging of ${contextTaggingTotal} analyses` 
    });
    
    // Mark as running
    isContextTaggingRunning = true;
    shouldStopContextTagging = false;
    contextTaggingProcessed = 0;
    
    // Start background processing with 8-at-a-time concurrent processing
    (async () => {
      let processed = 0;
      let failed = 0;
      const failedDates: string[] = [];
      const MAX_CONCURRENT = 8;
      const running = new Map<string, Promise<{ success: boolean; date: string }>>();
      let index = 0;
      
      // Helper function to get article content
      const getArticleContent = async (analysis: typeof eligibleAnalyses[0]): Promise<string | null> => {
        try {
          if (!analysis.topArticleId || analysis.topArticleId === 'none') {
            return null;
          }
          
          // Try to find article in tieredArticles
          const tieredArticles = analysis.tieredArticles as any;
          if (tieredArticles && typeof tieredArticles === 'object') {
            const tiers = ['bitcoin', 'crypto', 'macro'] as const;
            for (const tier of tiers) {
              const tierArticles = tieredArticles[tier] || [];
              const article = tierArticles.find((a: any) => a.id === analysis.topArticleId);
              if (article) {
                return article.text || article.summary || article.content || null;
              }
            }
          }
          
          // Fallback to analyzedArticles
          if (analysis.analyzedArticles && Array.isArray(analysis.analyzedArticles)) {
            const article = analysis.analyzedArticles.find((a: any) => a.id === analysis.topArticleId);
            if (article) {
              return article.text || article.summary || article.content || null;
            }
          }
          
          return null;
        } catch (error) {
          console.error(`Error fetching article for ${analysis.date}:`, error);
          return null;
        }
      };
      
      // Helper function to process a single analysis
      const processAnalysis = async (analysis: typeof eligibleAnalyses[0]): Promise<{ success: boolean; date: string }> => {
        try {
          const currentIndex = processed + failed + 1;
          console.log(`🏷️ [${currentIndex}/${contextTaggingTotal}] Extracting tags with context for ${analysis.date}...`);
          
          // Get article content
          const articleContent = await getArticleContent(analysis);
          
          let tagNames: string[];
          if (articleContent && articleContent.trim().length > 0) {
            // Use context-based extraction
            tagNames = await entityExtractor.extractEntitiesWithContext(analysis.summary, articleContent);
            console.log(`   📰 Using article context (${articleContent.length} chars)`);
          } else {
            // Fallback to regular extraction if no article found
            console.log(`   ⚠️ No article content found, using summary only`);
            tagNames = await entityExtractor.extractEntities(analysis.summary);
          }
          
          // Update analysis with tags_version2
          await storage.updateAnalysis(analysis.date, {
            tagsVersion2: tagNames
          });
          
          processed++;
          contextTaggingProcessed = processed + failed;
          
          console.log(`✅ Tagged ${analysis.date} with ${tagNames.length} tags: ${tagNames.slice(0, 5).join(', ')}${tagNames.length > 5 ? '...' : ''}`);
          
          return { success: true, date: analysis.date };
        } catch (error) {
          console.error(`❌ Error tagging ${analysis.date}:`, error);
          failed++;
          failedDates.push(analysis.date);
          contextTaggingProcessed = processed + failed;
          
          return { success: false, date: analysis.date };
        }
      };
      
      // Process analyses with 8-at-a-time batching
      while (index < eligibleAnalyses.length || running.size > 0) {
        // Check if stop was requested
        if (shouldStopContextTagging) {
          console.log(`🛑 Context tagging stopped by user after ${processed} analyses (${failed} failed)`);
          break;
        }
        
        // Start new analyses until we have MAX_CONCURRENT running
        while (running.size < MAX_CONCURRENT && index < eligibleAnalyses.length) {
          const analysis = eligibleAnalyses[index];
          const promise = processAnalysis(analysis);
          running.set(analysis.date, promise);
          index++;
        }
        
        // Wait for at least one to complete
        if (running.size > 0) {
          const completed = await Promise.race(
            Array.from(running.entries()).map(([date, promise]) =>
              promise.then(result => ({ result, date })).catch(error => {
                console.error(`Promise error for ${date}:`, error);
                return {
                  result: { success: false, date },
                  date
                };
              })
            )
          );
          running.delete(completed.date);
          
          // Small delay before starting next batch
          if (index < eligibleAnalyses.length && running.size < MAX_CONCURRENT) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }
      
      console.log(`✅ Context tagging completed: ${processed} successful, ${failed} failed`);
      if (failedDates.length > 0) {
        console.log(`❌ Failed dates: ${failedDates.join(', ')}`);
      }
      
      // Invalidate caches
      cacheManager.invalidate('tags:catalog');
      cacheManager.invalidate('tags:catalog:manual');
      cacheManager.invalidate('tags:catalog-v2');
      cacheManager.invalidate('tags:catalog-v2:manual');
      cacheManager.invalidate('tags:hierarchy');
      cacheManager.invalidate('tags:filter-tree');
      cacheManager.invalidate('tags:manage');
      cacheManager.invalidate('tags:analyses:all');
      cacheManager.invalidate('tags:analyses:manual');
      
      isContextTaggingRunning = false;
    })();
    
  } catch (error) {
    console.error("❌ Error starting context tagging:", error);
    isContextTaggingRunning = false;
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tagging/with-context/stop", async (req, res) => {
  try {
    console.log("🛑 Stop context tagging requested");
    
    if (!isContextTaggingRunning) {
      return res.status(400).json({ 
        error: "No context tagging process is currently running" 
      });
    }
    
    shouldStopContextTagging = true;
    const processedCount = contextTaggingProcessed;
    
    res.json({ 
      success: true, 
      processed: processedCount,
      total: contextTaggingTotal,
      message: `Context tagging will stop after current analysis completes` 
    });
  } catch (error) {
    console.error("❌ Error stopping context tagging:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/tagging/with-context/status", async (req, res) => {
  try {
    res.json({
      isRunning: isContextTaggingRunning,
      processed: contextTaggingProcessed,
      total: contextTaggingTotal,
      progress: contextTaggingTotal > 0 ? Math.round((contextTaggingProcessed / contextTaggingTotal) * 100) : 0
    });
  } catch (error) {
    console.error("❌ Error getting context tagging status:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/batch-tagging/status", async (req, res) => {
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

router.get("/api/tags/catalog", async (req, res) => {
  try {
    const { manualOnly } = req.query;
    const isManualOnly = manualOnly === 'true';
    
    // Check cache first (5 minute TTL) - cache key includes manualOnly filter
    const cacheKey = isManualOnly ? 'tags:catalog:manual' : 'tags:catalog';
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      console.log(`📊 Returning cached tag catalog${isManualOnly ? ' (manual only)' : ''}`);
      return res.json(cached);
    }
    
    console.log(`📊 Fetching tag catalog (optimized)${isManualOnly ? ' - manual only' : ''}`);
    
    // Use PostgreSQL JSONB functions to extract and count in database
    // This is much faster than loading all records into memory
    // Build SQL query conditionally based on manualOnly filter
    let result;
    if (isManualOnly) {
      result = await db.execute(sql`
        WITH tag_expanded AS (
          SELECT 
            jsonb_array_elements(tags) as tag
          FROM historical_news_analyses
          WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
            AND is_manual_override = true
        ),
        tag_counts AS (
          SELECT 
            tag->>'category' as category,
            tag->>'name' as name,
            COUNT(*)::integer as count
          FROM tag_expanded
          GROUP BY tag->>'category', tag->>'name'
        ),
        category_groups AS (
          SELECT 
            category,
            jsonb_agg(
              jsonb_build_object('category', category, 'name', name, 'count', count)
              ORDER BY count DESC
            ) as entities
          FROM tag_counts
          GROUP BY category
        ),
        counts AS (
          SELECT 
            COUNT(*)::integer as total_analyses,
            COUNT(*) FILTER (WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array')::integer as tagged_count,
            COUNT(*) FILTER (WHERE tags IS NULL OR jsonb_typeof(tags) != 'array')::integer as untagged_count
          FROM historical_news_analyses
          WHERE is_manual_override = true
        )
        SELECT 
          COALESCE(jsonb_object_agg(category, entities), '{}'::jsonb) as entities_by_category,
          (SELECT tagged_count FROM counts) as tagged_count,
          (SELECT untagged_count FROM counts) as untagged_count,
          (SELECT total_analyses FROM counts) as total_analyses
        FROM category_groups;
      `);
    } else {
      result = await db.execute(sql`
        WITH tag_expanded AS (
          SELECT 
            jsonb_array_elements(tags) as tag
          FROM historical_news_analyses
          WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
        ),
        tag_counts AS (
          SELECT 
            tag->>'category' as category,
            tag->>'name' as name,
            COUNT(*)::integer as count
          FROM tag_expanded
          GROUP BY tag->>'category', tag->>'name'
        ),
        category_groups AS (
          SELECT 
            category,
            jsonb_agg(
              jsonb_build_object('category', category, 'name', name, 'count', count)
              ORDER BY count DESC
            ) as entities
          FROM tag_counts
          GROUP BY category
        ),
        counts AS (
          SELECT 
            COUNT(*)::integer as total_analyses,
            COUNT(*) FILTER (WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array')::integer as tagged_count,
            COUNT(*) FILTER (WHERE tags IS NULL OR jsonb_typeof(tags) != 'array')::integer as untagged_count
          FROM historical_news_analyses
        )
        SELECT 
          COALESCE(jsonb_object_agg(category, entities), '{}'::jsonb) as entities_by_category,
          (SELECT tagged_count FROM counts) as tagged_count,
          (SELECT untagged_count FROM counts) as untagged_count,
          (SELECT total_analyses FROM counts) as total_analyses
        FROM category_groups;
      `);
    }
    
    const data = result.rows[0];
    let entitiesByCategory = data.entities_by_category || {};
    
    // Apply hierarchy transformation: reorganize currencies into subcategories
    const { tagMetadata } = await import("@shared/schema");
    const { eq, and, or } = await import("drizzle-orm");
    
    // Get Currency parent tag
    const currencyTag = await db.select()
      .from(tagMetadata)
      .where(and(eq(tagMetadata.name, 'Currency'), eq(tagMetadata.category, 'currency')))
      .limit(1);
    
    // Get the three subcategory parent tags
    const subcategoryTags = await db.select()
      .from(tagMetadata)
      .where(
        and(
          or(
            eq(tagMetadata.name, 'Commodity Money'),
            eq(tagMetadata.name, 'Cryptocurrency'),
            eq(tagMetadata.name, 'Fiat Currency')
          ),
          or(
            eq(tagMetadata.category, 'currency'),
            eq(tagMetadata.category, 'crypto')
          )
        )
      );
    
    // If hierarchy exists, reorganize currencies into subcategories
    if (currencyTag.length > 0 && subcategoryTags.length > 0) {
      const subcategoryMap = new Map<string, string>();
      subcategoryTags.forEach(tag => {
        subcategoryMap.set(tag.name.toLowerCase(), tag.id);
      });
      
      // Get all tags that are children of the subcategories
      const subcategoryIds = Array.from(subcategoryMap.values());
      let allChildren: any[] = [];
      if (subcategoryIds.length > 0) {
        // Use Drizzle's inArray for multiple parent IDs
        const { inArray } = await import("drizzle-orm");
        allChildren = await db.select()
          .from(tagMetadata)
          .where(inArray(tagMetadata.parentTagId, subcategoryIds));
      }
      
      // Create a map: tag name -> parent subcategory name
      // Get all tags from tag_metadata that belong to currency/crypto categories
      const allTagMetadata = await db.select()
        .from(tagMetadata)
        .where(
          or(
            eq(tagMetadata.category, 'crypto'),
            eq(tagMetadata.category, 'currency')
          )
        );
      
      const tagToSubcategory = new Map<string, string>();
      
      // Build map: for each tag, find its parent subcategory
      allTagMetadata.forEach(tag => {
        if (!tag.parentTagId) return;
        
        const parent = subcategoryTags.find(p => p.id === tag.parentTagId);
        if (parent) {
          tagToSubcategory.set(tag.name.toLowerCase(), parent.name.toLowerCase());
        }
      });
      
      // Organize entities from all categories based on their parent in tag_metadata
      const commodityEntities: any[] = [];
      const cryptoEntities: any[] = [];
      const fiatEntities: any[] = [];
      const bitcoinEntities: any[] = [];
      
      // Get Bitcoin tag to identify Bitcoin-related tags
      const bitcoinTag = await db.select()
        .from(tagMetadata)
        .where(
          and(
            eq(tagMetadata.name, 'Bitcoin'),
            or(
              eq(tagMetadata.category, 'crypto'),
              eq(tagMetadata.category, 'cryptocurrency')
            )
          )
        )
        .limit(1);
      
      let bitcoinChildren = new Set<string>();
      let bitcoinTagId: string | null = null;
      if (bitcoinTag.length > 0) {
        bitcoinTagId = bitcoinTag[0].id;
        const bitcoinChildrenTags = await db.select()
          .from(tagMetadata)
          .where(eq(tagMetadata.parentTagId, bitcoinTagId));
        bitcoinChildren = new Set(bitcoinChildrenTags.map(t => t.name.toLowerCase()));
        console.log(`📊 Found Bitcoin with ${bitcoinChildren.size} children`);
      }
      
      // Process all categories and reorganize currencies
      const allCategories = Object.keys(entitiesByCategory);
      for (const cat of allCategories) {
        entitiesByCategory[cat].forEach((entity: any) => {
          const nameLower = entity.name.toLowerCase();
          const parentSubcat = tagToSubcategory.get(nameLower);
          
          // Check if it's a Bitcoin-related tag (child of Bitcoin)
          if (bitcoinChildren.has(nameLower)) {
            bitcoinEntities.push(entity);
          } else if (parentSubcat === 'commodity money') {
            commodityEntities.push(entity);
          } else if (parentSubcat === 'cryptocurrency') {
            cryptoEntities.push(entity);
          } else if (parentSubcat === 'fiat currency') {
            fiatEntities.push(entity);
          }
        });
      }
      
      // If we have Bitcoin entities, create a nested structure
      if (bitcoinEntities.length > 0 && bitcoinTagId) {
        // Calculate total count for Bitcoin parent (sum of all children)
        const bitcoinTotalCount = bitcoinEntities.reduce((sum: number, e: any) => sum + e.count, 0);
        
        // Add Bitcoin as a parent entry in cryptocurrency category
        if (!entitiesByCategory.cryptocurrency) {
          entitiesByCategory.cryptocurrency = [];
        }
        
        // Find and remove existing Bitcoin entry (if any) and Bitcoin-related children
        const beforeFilter = entitiesByCategory.cryptocurrency.length;
        entitiesByCategory.cryptocurrency = entitiesByCategory.cryptocurrency.filter(
          (e: any) => {
            const nameLower = e.name.toLowerCase();
            return nameLower !== 'bitcoin' && !bitcoinChildren.has(nameLower);
          }
        );
        const afterFilter = entitiesByCategory.cryptocurrency.length;
        console.log(`📊 Filtered cryptocurrency category: ${beforeFilter} -> ${afterFilter}, removed ${beforeFilter - afterFilter} Bitcoin-related items`);
        
        // Add Bitcoin as parent at the beginning with its children
        entitiesByCategory.cryptocurrency.unshift({
          category: 'crypto',
          name: 'Bitcoin',
          count: bitcoinTotalCount,
          isParent: true,
          children: bitcoinEntities.sort((a: any, b: any) => b.count - a.count)
        });
        console.log(`✅ Added Bitcoin parent with ${bitcoinEntities.length} children to cryptocurrency category`);
      }
      
      // Create nested structure: Currency -> Subcategories -> Entities
      // For now, we'll create separate top-level categories for each subcategory
      // The frontend can display them nested if needed
      if (commodityEntities.length > 0) {
        entitiesByCategory['commodity money'] = commodityEntities.sort((a: any, b: any) => b.count - a.count);
      }
      if (cryptoEntities.length > 0) {
        entitiesByCategory['cryptocurrency'] = cryptoEntities.sort((a: any, b: any) => b.count - a.count);
      }
      if (fiatEntities.length > 0) {
        entitiesByCategory['fiat currency'] = fiatEntities.sort((a: any, b: any) => b.count - a.count);
      }
      
      // Remove original crypto category if all items were moved
      if (cryptoEntities.length > 0 && entitiesByCategory.crypto) {
        const remainingCrypto = entitiesByCategory.crypto.filter((e: any) => 
          !cryptoEntities.some(ce => ce.name.toLowerCase() === e.name.toLowerCase())
        );
        if (remainingCrypto.length === 0) {
          delete entitiesByCategory.crypto;
        } else {
          entitiesByCategory.crypto = remainingCrypto;
        }
      }
      
      // Keep currency category but it should be empty or contain only unclassified items
      if (entitiesByCategory.currency) {
        const remainingCurrency = entitiesByCategory.currency.filter((e: any) => {
          const nameLower = e.name.toLowerCase();
          return !commodityEntities.some(ce => ce.name.toLowerCase() === nameLower) &&
                 !fiatEntities.some(fe => fe.name.toLowerCase() === nameLower);
        });
        if (remainingCurrency.length === 0) {
          delete entitiesByCategory.currency;
        } else {
          entitiesByCategory.currency = remainingCurrency;
        }
      }
    }
    
    const response = {
      entitiesByCategory,
      taggedCount: parseInt(data.tagged_count) || 0,
      untaggedCount: parseInt(data.untagged_count) || 0,
      totalAnalyses: parseInt(data.total_analyses) || 0
    };
    
    // Cache for 5 minutes (300 seconds)
    cacheManager.set(cacheKey, response, 300000);
    
    console.log(`✅ Catalog: ${response.taggedCount} tagged, ${response.untaggedCount} untagged, ${Object.keys(response.entitiesByCategory).length} categories`);
    
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching tag catalog:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// New simplified catalog endpoint - returns flat tags for frontend grouping
router.get("/api/tags/catalog-v2", async (req, res) => {
  try {
    const { manualOnly } = req.query;
    const isManualOnly = manualOnly === 'true';
    
    // Check cache first (5 minute TTL)
    const cacheKey = isManualOnly ? 'tags:catalog-v2:manual' : 'tags:catalog-v2';
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      console.log(`📊 Returning cached tag catalog v2${isManualOnly ? ' (manual only)' : ''}`);
      return res.json(cached);
    }
    
    console.log(`📊 Fetching tag catalog v2 (flat tags)${isManualOnly ? ' - manual only' : ''}`);
    
    // Use new tag_names column - simple array of tag names without categories
    // Frontend will determine categories based on tag names
    let result;
    if (isManualOnly) {
      result = await db.execute(sql`
        WITH tag_expanded AS (
          SELECT 
            unnest(tag_names) as tag_name
          FROM historical_news_analyses
          WHERE tag_names IS NOT NULL AND array_length(tag_names, 1) > 0
            AND is_manual_override = true
        ),
        tag_counts AS (
          SELECT 
            tag_name as name,
            COUNT(*)::integer as count
          FROM tag_expanded
          WHERE tag_name IS NOT NULL
          GROUP BY tag_name
        ),
        counts AS (
          SELECT 
            COUNT(*)::integer as total_analyses,
            COUNT(*) FILTER (WHERE tag_names IS NOT NULL AND array_length(tag_names, 1) > 0)::integer as tagged_count,
            COUNT(*) FILTER (WHERE tag_names IS NULL OR array_length(tag_names, 1) = 0)::integer as untagged_count
          FROM historical_news_analyses
          WHERE is_manual_override = true
        )
        SELECT 
          jsonb_agg(
            jsonb_build_object('name', name, 'count', count)
            ORDER BY count DESC
          ) as tags,
          (SELECT tagged_count FROM counts) as tagged_count,
          (SELECT untagged_count FROM counts) as untagged_count,
          (SELECT total_analyses FROM counts) as total_analyses
        FROM tag_counts;
      `);
    } else {
      result = await db.execute(sql`
        WITH tag_expanded AS (
          SELECT 
            unnest(tag_names) as tag_name
          FROM historical_news_analyses
          WHERE tag_names IS NOT NULL AND array_length(tag_names, 1) > 0
        ),
        tag_counts AS (
          SELECT 
            tag_name as name,
            COUNT(*)::integer as count
          FROM tag_expanded
          WHERE tag_name IS NOT NULL
          GROUP BY tag_name
        ),
        counts AS (
          SELECT 
            COUNT(*)::integer as total_analyses,
            COUNT(*) FILTER (WHERE tag_names IS NOT NULL AND array_length(tag_names, 1) > 0)::integer as tagged_count,
            COUNT(*) FILTER (WHERE tag_names IS NULL OR array_length(tag_names, 1) = 0)::integer as untagged_count
          FROM historical_news_analyses
        )
        SELECT 
          jsonb_agg(
            jsonb_build_object('name', name, 'count', count)
            ORDER BY count DESC
          ) as tags,
          (SELECT tagged_count FROM counts) as tagged_count,
          (SELECT untagged_count FROM counts) as untagged_count,
          (SELECT total_analyses FROM counts) as total_analyses
        FROM tag_counts;
      `);
    }
    
    const data = result.rows[0];
    
    const response = {
      tags: data.tags || [],
      taggedCount: parseInt(data.tagged_count) || 0,
      untaggedCount: parseInt(data.untagged_count) || 0,
      totalAnalyses: parseInt(data.total_analyses) || 0
    };
    
    // Cache for 5 minutes (300 seconds)
    cacheManager.set(cacheKey, response, 300000);
    
    console.log(`✅ Catalog v2: ${response.tags.length} unique tags, ${response.taggedCount} tagged, ${response.untaggedCount} untagged`);
    
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching tag catalog v2:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get tag hierarchy from tag_metadata table
// Returns the complete taxonomy tree structure
router.get("/api/tags/hierarchy", async (req, res) => {
  try {
    // Check cache first (hierarchy changes rarely, cache for 1 hour)
    const cacheKey = 'tags:hierarchy';
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      console.log('📊 Returning cached tag hierarchy');
      return res.json(cached);
    }
    
    console.log('📊 Fetching tag hierarchy from tag_metadata...');
    
    const { tagMetadata } = await import("@shared/schema");
    const { asc, isNull } = await import("drizzle-orm");
    
    // Get all tags from metadata table
    const allTags = await db.select().from(tagMetadata).orderBy(asc(tagMetadata.category), asc(tagMetadata.name));
    
    if (allTags.length === 0) {
      return res.json({ 
        categories: [],
        totalTags: 0,
        message: 'No hierarchy found. Run migration script first.'
      });
    }
    
    // Build tree structure
    const tagMap = new Map<string, any>();
    const rootNodes: any[] = [];
    
    // First pass: create all nodes
    for (const tag of allTags) {
      tagMap.set(tag.id, {
        id: tag.id,
        name: tag.name,
        category: tag.category,
        normalizedName: tag.normalizedName,
        parentTagId: tag.parentTagId,
        usageCount: tag.usageCount || 0,
        children: []
      });
    }
    
    // Second pass: build tree
    for (const tag of allTags) {
      const node = tagMap.get(tag.id);
      if (tag.parentTagId && tagMap.has(tag.parentTagId)) {
        const parent = tagMap.get(tag.parentTagId);
        parent.children.push(node);
      } else {
        // Root node (main category)
        rootNodes.push(node);
      }
    }
    
    // Sort children by name
    const sortChildren = (node: any) => {
      if (node.children && node.children.length > 0) {
        node.children.sort((a: any, b: any) => a.name.localeCompare(b.name));
        node.children.forEach(sortChildren);
      }
    };
    rootNodes.forEach(sortChildren);
    
    const response = {
      categories: rootNodes,
      totalTags: allTags.length
    };
    
    // Cache for 1 hour
    cacheManager.set(cacheKey, response, 3600000);
    
    console.log(`✅ Hierarchy: ${rootNodes.length} main categories, ${allTags.length} total entries`);
    
    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching tag hierarchy:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// New filter tree endpoint using normalized tags table with subcategoryPath
router.get("/api/tags/filter-tree", async (req, res) => {
  try {
    // Check cache first (hierarchy changes rarely, cache for 1 hour)
    const cacheKey = 'tags:filter-tree';
    const cached = cacheManager.get(cacheKey);
    if (cached) {
      console.log('📊 Returning cached filter tree');
      return res.json(cached);
    }
    
    console.log('📊 Building filter tree from normalized tags table...');
    
    const { tags: tagsTable, pagesAndTags, subcategoryLabels } = await import("@shared/schema");
    const { asc, sql: drizzleSql } = await import("drizzle-orm");
    
    // Get all tags with their usage counts from join table
    const allTags = await db.execute(drizzleSql`
      SELECT 
        t.id,
        t.name,
        t.category,
        t.normalized_name,
        t.subcategory_path,
        t.parent_tag_id,
        COALESCE(COUNT(pt.id), 0)::integer as usage_count
      FROM tags t
      LEFT JOIN pages_and_tags pt ON t.id = pt.tag_id
      GROUP BY t.id, t.name, t.category, t.normalized_name, t.subcategory_path, t.parent_tag_id
      ORDER BY t.category, t.name
    `);
    
    if (allTags.rows.length === 0) {
      return res.json({ 
        categories: [],
        totalTags: 0,
        message: 'No tags found. Run migration script first.'
      });
    }
    
    // Load custom labels from subcategory_labels table
    const customLabelsResult = await db.select().from(subcategoryLabels);
    const customLabels = new Map<string, string>();
    for (const row of customLabelsResult) {
      customLabels.set(row.path, row.label);
    }
    console.log(`📝 Loaded ${customLabels.size} custom subcategory labels`);
    
    // Build tree structure using subcategoryPath
    const categoryMap = new Map<string, any>();

    for (const row of allTags.rows as any[]) {
      // Skip legacy label tags (from old approach)
      if (row.name.startsWith('_subcategory_')) continue;

      const subcategoryPath = row.subcategory_path || [];
      const categoryKey = getCategoryKeyFromPath(subcategoryPath, row.category) || row.category || "miscellaneous";
      const categoryMeta = getCategoryDisplayMeta(categoryKey);
      
      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, {
          category: categoryKey,
          name: categoryMeta.name || categoryKey,
          emoji: categoryMeta.emoji,
          tags: [],
          subcategories: {},
          totalTags: 0,
        });
      }
      
      const categoryNode = categoryMap.get(categoryKey)!;
      categoryNode.totalTags++;
      
      // Build nested structure based on subcategoryPath (now single-element)
      if (subcategoryPath.length === 0) {
        // Tag at root level of category
        categoryNode.tags.push({
          id: row.id,
          name: row.name,
          normalizedName: row.normalized_name,
          usageCount: row.usage_count || 0,
        });
      } else {
        // Single-element path like ["1.2.3"] - derive hierarchy from key
        const finalKey = subcategoryPath[0]; // e.g., "1.2.3"
        const parts = finalKey.split('.'); // ["1", "2", "3"]
        
        // Build ancestry: "1.2.3" -> ["1.2", "1.2.3"] for 3-part keys
        // "1.2" -> ["1.2"] for 2-part keys
        const ancestryKeys: string[] = [];
        if (parts.length >= 2) {
          // First level is always X.Y (e.g., "1.2")
          ancestryKeys.push(parts.slice(0, 2).join('.'));
        }
        if (parts.length >= 3) {
          // Second level is X.Y.Z (e.g., "1.2.3")
          ancestryKeys.push(parts.slice(0, 3).join('.'));
        }
        if (parts.length >= 4) {
          // Third level is X.Y.Z.W (e.g., "1.2.3.4")
          ancestryKeys.push(parts.slice(0, 4).join('.'));
        }
        
        // Navigate/create nested structure
        let current = categoryNode;
        for (let i = 0; i < ancestryKeys.length; i++) {
          const pathKey = ancestryKeys[i];
          
          if (!current.subcategories[pathKey]) {
            // Use custom label if available, otherwise fallback to default
            const defaultName = getTaxonomyLabel(pathKey) || pathKey;
            const name = customLabels.get(pathKey) || defaultName;
            
            current.subcategories[pathKey] = {
              key: pathKey,
              name: name,
              tags: [],
              subcategories: {},
              totalTags: 0,
            };
          }
          
          current = current.subcategories[pathKey];
          current.totalTags++;
          
          // If this is the final key, add the tag
          if (pathKey === finalKey) {
            current.tags.push({
              id: row.id,
              name: row.name,
              normalizedName: row.normalized_name,
              usageCount: row.usage_count || 0,
            });
          }
        }
      }
    }
    
    // Convert category map to array and sort by taxonomy order
    const categoryOrder = new Map<string, number>();
    TAXONOMY_TREE.forEach((node, index) => {
      categoryOrder.set(node.key, index);
    });
    
    const categories = Array.from(categoryMap.values())
      .map(cat => {
        // Recursively sort subcategories and tags
        const sortNode = (node: any) => {
          if (node.tags) {
            node.tags.sort((a: any, b: any) => a.name.localeCompare(b.name));
          }
          if (node.subcategories) {
            const sortedSubcats = Object.keys(node.subcategories)
              .sort()
              .map(key => {
                const subcat = node.subcategories[key];
                sortNode(subcat);
                return { key, ...subcat };
              });
            node.subcategories = sortedSubcats;
          }
        };
        sortNode(cat);
        return cat;
      })
      .sort((a, b) => {
        // Sort by taxonomy order (bitcoin=0, blockchain-platforms=1, etc.)
        const orderA = categoryOrder.get(a.category) ?? 999;
        const orderB = categoryOrder.get(b.category) ?? 999;
        return orderA - orderB;
      });
    
    const response = {
      categories,
      totalTags: allTags.rows.length,
      builtFrom: 'normalized-tags-table'
    };
    
    // Cache for 1 hour
    cacheManager.set(cacheKey, response, 3600000);
    
    console.log(`✅ Filter tree: ${categories.length} categories, ${allTags.rows.length} total tags`);
    
    res.json(response);
  } catch (error) {
    console.error("❌ Error building filter tree:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Cache flush endpoint
router.post("/api/tags/flush-cache", async (req, res) => {
  try {
    console.log("🧹 Flushing tags cache...");
    
    // Invalidate all tag-related caches
    cacheManager.invalidate('tags:catalog-v2');
    cacheManager.invalidate('tags:catalog-v2:manual');
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    console.log("✅ Tags cache flushed successfully");
    
    res.json({ 
      success: true, 
      message: "Cache flushed successfully",
      flushed: ['catalog-v2', 'catalog-v2:manual', 'filter-tree', 'hierarchy']
    });
  } catch (error) {
    console.error("❌ Error flushing cache:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/tags/analyses", async (req, res) => {
  try {
    const { 
      entities, 
      untagged, 
      search, 
      page = '1', 
      pageSize = '50',
      all,
      manualOnly 
    } = req.query;
    
    console.log("🔍 Fetching filtered analyses:", { entities, untagged, search, page, pageSize, all, manualOnly });
    if (manualOnly === 'true') {
      console.log("📋 Filtering for manually imported events only");
    }
    
    // If manualOnly filter is active, use database-level filtering for better performance
    let allAnalyses: HistoricalNewsAnalysis[];
    if (manualOnly === 'true') {
      // Check cache first (30 second TTL for manual-only queries)
      const manualCacheKey = 'tags:analyses:manual';
      const cachedManual = cacheManager.get(manualCacheKey);
      if (cachedManual) {
        console.log(`📊 Using cached manual analyses (${cachedManual.length} items)`);
        allAnalyses = cachedManual;
      } else {
        // Use direct SQL query to filter at database level
        const { historicalNewsAnalyses } = await import("@shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        allAnalyses = await db
          .select()
          .from(historicalNewsAnalyses)
          .where(eq(historicalNewsAnalyses.isManualOverride, true))
          .orderBy(desc(historicalNewsAnalyses.date));
        console.log(`📊 Database query returned ${allAnalyses.length} manually imported analyses`);
        // Cache for 30 seconds
        cacheManager.set(manualCacheKey, allAnalyses, 30000);
      }
    } else {
      // Check cache first (30 second TTL for base dataset)
      const baseCacheKey = 'tags:analyses:all';
      const cached = cacheManager.get(baseCacheKey);
      if (cached) {
        console.log(`📊 Using cached analyses (${cached.length} items)`);
        allAnalyses = cached;
      } else {
        allAnalyses = await storage.getAllAnalyses();
        // Cache for 30 seconds
        cacheManager.set(baseCacheKey, allAnalyses, 30000);
      }
    }
    
    // Debug: Count manually imported events and check data types
    if (manualOnly === 'true') {
      const manualCount = allAnalyses.filter(a => a.isManualOverride === true).length;
      const totalCount = allAnalyses.length;
      const nullCount = allAnalyses.filter(a => a.isManualOverride === null || a.isManualOverride === undefined).length;
      const falseCount = allAnalyses.filter(a => a.isManualOverride === false).length;
      const trueCount = allAnalyses.filter(a => a.isManualOverride === true).length;
      console.log(`📊 Total analyses: ${totalCount}`);
      console.log(`   - isManualOverride = true: ${trueCount}`);
      console.log(`   - isManualOverride = false: ${falseCount}`);
      console.log(`   - isManualOverride = null/undefined: ${nullCount}`);
      console.log(`   - Manual override (true or 'true'): ${manualCount}`);
      
      // Sample a few to see actual values
      const samples = allAnalyses.slice(0, 5).map(a => ({
        date: a.date,
        isManualOverride: a.isManualOverride,
        type: typeof a.isManualOverride
      }));
      console.log(`📋 Sample values:`, JSON.stringify(samples, null, 2));
    }
    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);
    const returnAll = all === 'true';
    
    // Parse entity filters (format: "category::name,category::name,...")
    const entityFilters = entities 
      ? (entities as string).split(',').filter(e => e.trim())
      : [];
    
    // Filter analyses
    // Note: manualOnly filtering is now done at database level, so we skip it here
    let filtered = allAnalyses.filter((analysis: HistoricalNewsAnalysis) => {
      // Manual override filter is handled at database level when manualOnly=true
      // No need to filter here since allAnalyses already contains only manual entries
      
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
          return (analysis.tags as any[]).some(tag => 
            tag.category === category && tag.name === name
          );
        });
        if (!hasAllEntities) return false;
      }
      
      // Filter by search query
      if (search) {
        const searchLower = (search as string).toLowerCase();
        const matchesSummary = analysis.summary.toLowerCase().includes(searchLower);
        const matchesTag = (analysis.tags as any[]).some(tag => 
          tag.name.toLowerCase().includes(searchLower)
        );
        const matchesDate = analysis.date.includes(search as string);
        if (!matchesSummary && !matchesTag && !matchesDate) return false;
      }
      
      return true;
    });
    
    // Sort by date descending
    filtered.sort((a, b) => b.date.localeCompare(a.date));
    
    // Debug: Log filter results
    if (manualOnly === 'true') {
      console.log(`🔍 After manual filter: ${filtered.length} analyses remain (from ${allAnalyses.length} total)`);
      if (filtered.length > 0) {
        console.log(`📅 Sample dates: ${filtered.slice(0, 3).map(a => a.date).join(', ')}`);
        console.log(`✅ Sample isManualOverride values: ${filtered.slice(0, 3).map(a => a.isManualOverride).join(', ')}`);
      }
    }
    
    // If 'all' parameter is set, return all results without pagination
    if (returnAll) {
      console.log(`✅ Found ${filtered.length} results, returning all (no pagination)`);
      
      res.json({
        analyses: filtered.map((a: HistoricalNewsAnalysis) => ({
          date: a.date,
          summary: a.summary,
          winningTier: a.winningTier,
          tags: a.tags || [],
          analyzedArticles: a.analyzedArticles || [],
          isManualOverride: a.isManualOverride || false
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
    
    console.log(`✅ Found ${totalCount} results, returning page ${pageNum} of ${totalPages}${manualOnly === 'true' ? ' (manual only)' : ''}`);
    if (manualOnly === 'true' && totalCount === 0) {
      console.log('⚠️ No manually imported events found in database');
    }
    
    res.json({
      analyses: paginatedResults.map((a: HistoricalNewsAnalysis) => ({
        date: a.date,
        summary: a.summary,
        winningTier: a.winningTier,
        tags: a.tags || [],
        analyzedArticles: a.analyzedArticles || [],
        isManualOverride: a.isManualOverride || false
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

router.post("/api/tags/bulk-add", async (req, res) => {
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
          // Add the new tag to JSONB (old structure - backward compatibility)
          await storage.updateAnalysis(date, {
            tags: [...currentTags, tag]
          });
          
          // Also add to normalized structure (new structure)
          try {
            const { tags: tagsTable } = await import("@shared/schema");
            const normalizedTag = await storage.findOrCreateTag({
              name: tag.name,
              category: tag.category,
            });
            await storage.addTagToAnalysis(analysis.id, normalizedTag.id);
          } catch (error) {
            console.warn(`⚠️ Failed to add tag to normalized structure for ${date}:`, error);
            // Continue - old structure still works
          }
          
          updated++;
        }
      } catch (error) {
        console.error(`❌ Error adding tag to ${date}:`, error);
      }
    }
    
    console.log(`✅ Added tag to ${updated} analyses`);
    
    // Invalidate caches since tags changed
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
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

router.post("/api/tags/bulk-remove", async (req, res) => {
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
          // Remove from JSONB (old structure - backward compatibility)
          await storage.updateAnalysis(date, {
            tags: newTags
          });
          
          // Also remove from normalized structure (new structure)
          try {
            const { tags: tagsTable } = await import("@shared/schema");
            const normalizedTag = await db.select()
              .from(tagsTable)
              .where(and(
                eq(tagsTable.name, tag.name),
                eq(tagsTable.category, tag.category)
              ))
              .limit(1);
            
            if (normalizedTag.length > 0) {
              await storage.removeTagFromAnalysis(analysis.id, normalizedTag[0].id);
            }
          } catch (error) {
            console.warn(`⚠️ Failed to remove tag from normalized structure for ${date}:`, error);
            // Continue - old structure still works
          }
          
          updated++;
        }
      } catch (error) {
        console.error(`❌ Error removing tag from ${date}:`, error);
      }
    }
    
    console.log(`✅ Removed tag from ${updated} analyses`);
    
    // Invalidate caches since tags changed
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
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

router.post("/api/tags/selected-summaries-tags", async (req, res) => {
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

router.get("/api/tags/manage", async (req, res) => {
  try {
    const { tagMetadata } = await import("@shared/schema");
    
    // Get all tags from metadata table
    const { asc } = await import("drizzle-orm");
    const allTags = await db.select().from(tagMetadata).orderBy(asc(tagMetadata.category), asc(tagMetadata.name));
    
    // Get all unique tags from analyses for similarity detection
    const { historicalNewsAnalyses } = await import("@shared/schema");
    const allAnalyses = await db.select({ tags: historicalNewsAnalyses.tags }).from(historicalNewsAnalyses);
    
    // Extract unique tags from analyses
    const uniqueTagsFromAnalyses = new Set<string>();
    const tagMap = new Map<string, { name: string; category: string }>();
    
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        for (const tag of (analysis.tags as any[])) {
          if (tag.name && tag.category) {
            const key = `${tag.category}::${tag.name}`;
            if (!tagMap.has(key)) {
              tagMap.set(key, { name: tag.name, category: tag.category });
              uniqueTagsFromAnalyses.add(tag.name);
            }
          }
        }
      }
    }
    
    // Build hierarchy structure
    const tagById = new Map(allTags.map((t: any) => [t.id, t]));
    const childrenByParent = new Map<string, typeof allTags>();
    
    for (const tag of allTags) {
      if (tag.parentTagId) {
        const parentId = tag.parentTagId;
        if (!childrenByParent.has(parentId)) {
          childrenByParent.set(parentId, []);
        }
        childrenByParent.get(parentId)!.push(tag);
      }
    }
    
    // Find similar tags for each tag
    const tagsWithSimilarity = allTags.map((tag: any) => {
      const candidateTags = Array.from(tagMap.values()).filter(t => t.name !== tag.name);
      const similar = findSimilarTags(tag.name, candidateTags, 0.7);
      
      return {
        ...tag,
        children: childrenByParent.get(tag.id) || [],
        similarTags: similar.slice(0, 5), // Top 5 similar tags
      };
    });
    
    // Group by category
    const byCategory = new Map<string, typeof tagsWithSimilarity>();
    for (const tag of tagsWithSimilarity) {
      if (!tag.parentTagId) { // Only show top-level tags in category groups
        if (!byCategory.has(tag.category)) {
          byCategory.set(tag.category, []);
        }
        byCategory.get(tag.category)!.push(tag);
      }
    }
    
    // Return empty structure if no tags
    if (allTags.length === 0) {
      return res.json({
        tags: [],
        byCategory: {},
        totalTags: 0,
      });
    }
    
    res.json({
      tags: tagsWithSimilarity,
      byCategory: Object.fromEntries(byCategory),
      totalTags: allTags.length,
    });
  } catch (error) {
    console.error("❌ Error fetching tag management data:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/move", async (req, res) => {
  try {
    const { tagId, newCategory } = req.body;
    if (!tagId || !newCategory) {
      return res.status(400).json({ error: "tagId and newCategory are required" });
    }
    
    const { tagMetadata, historicalNewsAnalyses } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    
    // Get the tag
    const [tag] = await db.select().from(tagMetadata).where(eq(tagMetadata.id, tagId));
    if (!tag) {
      return res.status(404).json({ error: "Tag not found" });
    }
    
    // Update tag metadata
    await db
      .update(tagMetadata)
      .set({
        category: newCategory,
        normalizedName: normalizeTagName(tag.name),
        updatedAt: new Date(),
      })
      .where(eq(tagMetadata.id, tagId));
    
    // Update all analyses that use this tag
    const allAnalyses = await db.select().from(historicalNewsAnalyses);
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        let updated = false;
        const updatedTags = analysis.tags.map((t: any) => {
          if (t.name === tag.name && t.category === tag.category) {
            updated = true;
            return { ...t, category: newCategory };
          }
          return t;
        });
        
        if (updated) {
          await db
            .update(historicalNewsAnalyses)
            .set({ tags: updatedTags })
            .where(eq(historicalNewsAnalyses.date, analysis.date));
        }
      }
    }
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    
    res.json({ success: true, message: `Tag moved to ${newCategory}` });
  } catch (error) {
    console.error("❌ Error moving tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/nest", async (req, res) => {
  try {
    const { tagId, parentTagId } = req.body;
    if (!tagId) {
      return res.status(400).json({ error: "tagId is required" });
    }
    
    const { tagMetadata } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    // Prevent circular references
    if (parentTagId) {
      const [parent] = await db.select().from(tagMetadata).where(eq(tagMetadata.id, parentTagId));
      if (!parent) {
        return res.status(404).json({ error: "Parent tag not found" });
      }
      
      // Check for circular reference
      let currentParentId = parent.parentTagId;
      while (currentParentId) {
        if (currentParentId === tagId) {
          return res.status(400).json({ error: "Cannot create circular reference" });
        }
        const [currentParent] = await db.select().from(tagMetadata).where(eq(tagMetadata.id, currentParentId));
        currentParentId = currentParent?.parentTagId || null;
      }
    }
    
    // Update tag
    await db
      .update(tagMetadata)
      .set({
        parentTagId: parentTagId || null,
        updatedAt: new Date(),
      })
      .where(eq(tagMetadata.id, tagId));
    
    res.json({ success: true, message: "Tag nested successfully" });
  } catch (error) {
    console.error("❌ Error nesting tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/merge", async (req, res) => {
  try {
    const { sourceTagId, targetTagId } = req.body;
    if (!sourceTagId || !targetTagId) {
      return res.status(400).json({ error: "sourceTagId and targetTagId are required" });
    }
    
    const { tagMetadata, historicalNewsAnalyses } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    // Get both tags
    const [sourceTag] = await db.select().from(tagMetadata).where(eq(tagMetadata.id, sourceTagId));
    const [targetTag] = await db.select().from(tagMetadata).where(eq(tagMetadata.id, targetTagId));
    
    if (!sourceTag || !targetTag) {
      return res.status(404).json({ error: "One or both tags not found" });
    }
    
    // Update all analyses: replace source tag with target tag
    const allAnalyses = await db.select().from(historicalNewsAnalyses);
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        let updated = false;
        const updatedTags = analysis.tags
          .map((t: any) => {
            if (t.name === sourceTag.name && t.category === sourceTag.category) {
              updated = true;
              return { name: targetTag.name, category: targetTag.category };
            }
            return t;
          })
          .filter((t: any, index: number, arr: any[]) => {
            // Remove duplicates
            return arr.findIndex((other: any) => other.name === t.name && other.category === t.category) === index;
          });
        
        if (updated) {
          await db
            .update(historicalNewsAnalyses)
            .set({ tags: updatedTags })
            .where(eq(historicalNewsAnalyses.date, analysis.date));
        }
      }
    }
    
    // Update usage count
    await db
      .update(tagMetadata)
      .set({
        usageCount: targetTag.usageCount + sourceTag.usageCount,
        updatedAt: new Date(),
      })
      .where(eq(tagMetadata.id, targetTagId));
    
    // Delete source tag
    await db.delete(tagMetadata).where(eq(tagMetadata.id, sourceTagId));
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    
    res.json({ success: true, message: "Tags merged successfully" });
  } catch (error) {
    console.error("❌ Error merging tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/tags/similarity", async (req, res) => {
  try {
    const { tagName, threshold = '0.7' } = req.query;
    if (!tagName) {
      return res.status(400).json({ error: "tagName is required" });
    }
    
    const { historicalNewsAnalyses } = await import("@shared/schema");
    
    // Get all unique tags from analyses
    const allAnalyses = await db.select({ tags: historicalNewsAnalyses.tags }).from(historicalNewsAnalyses);
    const tagMap = new Map<string, { name: string; category: string }>();
    
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        for (const tag of analysis.tags) {
          if (tag.name && tag.category) {
            const key = `${tag.category}::${tag.name}`;
            if (!tagMap.has(key)) {
              tagMap.set(key, { name: tag.name, category: tag.category });
            }
          }
        }
      }
    }
    
    const candidateTags = Array.from(tagMap.values());
    const similar = findSimilarTags(tagName as string, candidateTags, parseFloat(threshold as string));
    
    res.json({ similarTags: similar });
  } catch (error) {
    console.error("❌ Error finding similar tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/initialize", async (req, res) => {
  try {
    const { tagMetadata, historicalNewsAnalyses } = await import("@shared/schema");
    const { sql: drizzleSql } = await import("drizzle-orm");
    
    // Get all unique tags from analyses
    const result = await db.execute(drizzleSql`
      WITH tag_expanded AS (
        SELECT DISTINCT
          tag->>'name' as name,
          tag->>'category' as category,
          COUNT(*)::integer as usage_count
        FROM historical_news_analyses,
          jsonb_array_elements(tags) as tag
        WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array'
        GROUP BY tag->>'name', tag->>'category'
      )
      SELECT name, category, usage_count
      FROM tag_expanded
      ORDER BY category, name;
    `);
    
    // Insert into tag_metadata (ignore duplicates)
    let inserted = 0;
    let skipped = 0;
    
    // Use raw SQL for better conflict handling
    for (const row of result.rows) {
      try {
        const insertResult = await db.execute(drizzleSql`
          INSERT INTO tag_metadata (name, category, normalized_name, usage_count)
          VALUES (${row.name}, ${row.category}, ${normalizeTagName(row.name as string)}, ${parseInt(String(row.usage_count)) || 0})
          ON CONFLICT (name, category) DO NOTHING
          RETURNING id;
        `);
        
        if (insertResult.rows && insertResult.rows.length > 0) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (error: any) {
        // Ignore duplicates - check if it's a unique constraint violation
        if (error?.code === '23505') {
          skipped++;
        } else {
          console.error(`Error inserting tag ${row.name}:`, error);
          // Continue with next tag
        }
      }
    }
    
    console.log(`✅ Tag initialization: ${inserted} inserted, ${skipped} skipped (duplicates), ${result.rows.length} total`);
    
    res.json({ success: true, inserted, skipped, total: result.rows.length });
  } catch (error) {
    console.error("❌ Error initializing tag metadata:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// AI CATEGORIZATION ENDPOINTS
// ============================================================================

router.post("/api/tags/ai-categorize/start", async (req, res) => {
  try {
    console.log("🤖 Starting AI categorization for tags WITHOUT subcategory_path...");
    
    // Check if already running
    if (isAiCategorizationRunning) {
      return res.status(409).json({ 
        error: "AI categorization already running. Please stop the current one first." 
      });
    }
    
    // Get tags that currently have no subcategory_path (matches Quality Check UI)
    const uncategorized = await db.execute(sql`
      SELECT id, name, category
      FROM tags
      WHERE subcategory_path IS NULL OR array_length(subcategory_path, 1) IS NULL
      ORDER BY name;
    `);
    
    const allTags = (uncategorized.rows as any[]).map((row) => ({
      id: row.id as string,
      name: row.name as string
    }));
    
    aiCategorizationTotal = allTags.length;
    
    if (aiCategorizationTotal === 0) {
      console.log("ℹ️ No tags without subcategory_path to categorize.");
      return res.json({ 
        success: true, 
        total: 0,
        message: "No tags without subcategory_path to categorize" 
      });
    }
    
    console.log(`✅ Found ${aiCategorizationTotal} tags without subcategory_path to categorize`);
    
    // Send initial response
    res.json({ 
      success: true, 
      total: aiCategorizationTotal,
      message: `Starting AI categorization of ${aiCategorizationTotal} tags without subcategory_path` 
    });
    
    // Mark as running
    isAiCategorizationRunning = true;
    shouldStopAiCategorization = false;
    aiCategorizationProcessed = 0;
    
    // Start background processing
    (async () => {
      try {
      console.log(`🚀 Background processing started for ${aiCategorizationTotal} tags`);
      const { tags: tagsTable, pagesAndTags, historicalNewsAnalyses } = await import("@shared/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const { categorizeTagWithContext } = await import("../services/tag-categorizer");
      const { normalizeTagName } = await import("../services/tag-similarity");
      let processed = 0;
      let failed = 0;
      const failedTags: string[] = [];
      
      const MAX_CONCURRENT = 8;
      const running = new Map<string, Promise<{ success: boolean; tagName: string }>>();
      let index = 0;
      
      console.log(`📋 Starting to process ${allTags.length} tags`);
      console.log(`   First few tags: ${allTags.slice(0, 5).map(t => t.name).join(', ')}`);
      
      if (!allTags || allTags.length === 0) {
        console.error('❌ allTags is empty or undefined!');
        isAiCategorizationRunning = false;
        return;
      }
      
      // Helper function to get sample summaries for a tag
      const getTagSummaries = async (tagName: string): Promise<string[]> => {
        const { sql } = await import("drizzle-orm");
        const result = await db.execute(sql`
          SELECT summary
          FROM historical_news_analyses
          WHERE tags_version2 IS NOT NULL 
            AND array_length(tags_version2, 1) > 0
            AND ${tagName} = ANY(tags_version2)
            AND summary IS NOT NULL
            AND summary != ''
          ORDER BY date DESC
          LIMIT 3
        `);
        return result.rows.map((row: any) => row.summary as string);
      };
      
      // Helper function to process a single tag
      const processTag = async (tag: { id: string; name: string }): Promise<{ success: boolean; tagName: string }> => {
        try {
          const tagName = tag.name;
          aiCategorizationCurrentTag = tagName;
          const currentIndex = processed + failed + 1;
          console.log(`🤖 [${currentIndex}/${aiCategorizationTotal}] Categorizing "${tagName}"...`);
          
          // Get sample summaries for context
          const summaries = await getTagSummaries(tagName);
          
          // Categorize with context using Gemini
          const categorization = await categorizeTagWithContext(tagName, summaries, undefined, 'gemini');
          
          console.log(`   → Categorized as: ${categorization.category} ${categorization.subcategoryPath.join(' -> ')} (confidence: ${(categorization.confidence * 100).toFixed(1)}%)`);
          
          // Find or create tag in tags table (match by name only, then update category/path)
          let tagId: string = tag.id;
          const existingTag = await db.select()
            .from(tagsTable)
            .where(eq(tagsTable.id, tag.id))
            .limit(1);
          
          if (existingTag.length > 0) {
            // Update the original uncategorized tag row
            await db.update(tagsTable)
              .set({
                category: categorization.category,
                subcategoryPath: categorization.subcategoryPath,
                normalizedName: normalizeTagName(tagName),
                updatedAt: new Date()
              })
              .where(eq(tagsTable.id, tag.id));
          } else {
            // Fallback: create new tag if the original was not found
            const [newTag] = await db.insert(tagsTable).values({
              name: tagName,
              category: categorization.category,
              normalizedName: normalizeTagName(tagName),
              subcategoryPath: categorization.subcategoryPath,
              usageCount: 0
            }).returning();
            tagId = newTag.id;
          }
          
          // Get all analyses that have this tag
          const { sql } = await import("drizzle-orm");
          const analysesWithTag = await db.execute(sql`
            SELECT id
            FROM historical_news_analyses
            WHERE tags_version2 IS NOT NULL 
              AND array_length(tags_version2, 1) > 0
              AND ${tagName} = ANY(tags_version2)
          `);
          
          // Create pages_and_tags entries
          let linkedCount = 0;
          for (const row of analysesWithTag.rows) {
            const analysisId = (row as any).id;
            try {
              await db.insert(pagesAndTags).values({
                analysisId,
                tagId
              }).onConflictDoNothing();
              linkedCount++;
            } catch (error) {
              // Ignore duplicate key errors
            }
          }
          
          // Update usage count
          await db.update(tagsTable)
            .set({
              usageCount: linkedCount
            })
            .where(eq(tagsTable.id, tagId));
          
          console.log(`   ✅ Linked to ${linkedCount} analyses`);
          
          processed++;
          aiCategorizationProcessed = processed + failed;
          
          return { success: true, tagName };
        } catch (error) {
          const errorTagName = tag.name; // Use tag.name from outer scope
          console.error(`❌ Error categorizing "${errorTagName}":`, error);
          failed++;
          failedTags.push(errorTagName);
          aiCategorizationProcessed = processed + failed;
          return { success: false, tagName: errorTagName };
        }
      };
      
      // Process tags with 8-at-a-time batching
      console.log(`🔄 Entering processing loop: ${allTags.length} tags to process`);
      console.log(`   Initial state: index=${index}, running.size=${running.size}, allTags.length=${allTags.length}`);
      
      if (allTags.length === 0) {
        console.log('⚠️ No tags to process - exiting early');
        isAiCategorizationRunning = false;
        return;
      }
      
      while (index < allTags.length || running.size > 0) {
        // Check if stop was requested
        if (shouldStopAiCategorization) {
          console.log(`🛑 AI categorization stopped by user after ${processed} tags (${failed} failed)`);
          break;
        }
        
        // Start new tags until we have MAX_CONCURRENT running
        while (running.size < MAX_CONCURRENT && index < allTags.length) {
          const tag = allTags[index];
          console.log(`▶️ Starting processing for tag ${index + 1}/${allTags.length}: "${tag.name}"`);
          const promise = processTag(tag);
          running.set(tag.id, promise);
          index++;
        }
        
        // Wait for at least one to complete
        if (running.size > 0) {
          try {
            const completed = await Promise.race(
              Array.from(running.entries()).map(([tagId, promise]) =>
                promise.then(result => ({ result, tagId })).catch(error => {
                  console.error(`Promise error for tag ${tagId}:`, error);
                  return {
                    result: { success: false, tagName: tagId },
                    tagId
                  };
                })
              )
            );
            running.delete(completed.tagId);
            
            // Small delay before starting next batch
            if (index < allTags.length && running.size < MAX_CONCURRENT) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          } catch (error) {
            console.error('❌ Error in Promise.race:', error);
            // Clear running map on error to prevent infinite loop
            running.clear();
            break;
          }
        } else if (index >= allTags.length) {
          // No more tags to start and nothing running - we're done
          console.log('✅ All tags processed, exiting loop');
          break;
        }
      }
      
      console.log(`✅ AI categorization completed: ${processed} successful, ${failed} failed`);
      if (failedTags.length > 0) {
        console.log(`❌ Failed tags: ${failedTags.slice(0, 20).join(', ')}${failedTags.length > 20 ? '...' : ''}`);
      }
      
      // Invalidate caches
      cacheManager.invalidate('tags:catalog');
      cacheManager.invalidate('tags:catalog:manual');
      cacheManager.invalidate('tags:catalog-v2');
      cacheManager.invalidate('tags:catalog-v2:manual');
      cacheManager.invalidate('tags:hierarchy');
      cacheManager.invalidate('tags:filter-tree');
      cacheManager.invalidate('tags:manage');
      cacheManager.invalidate('tags:analyses:all');
      cacheManager.invalidate('tags:analyses:manual');
      
      isAiCategorizationRunning = false;
      } catch (error) {
        console.error("❌ Fatal error in AI categorization background process:", error);
        isAiCategorizationRunning = false;
        aiCategorizationProcessed = aiCategorizationTotal; // Mark as complete to prevent hanging
      }
    })();
    
  } catch (error) {
    console.error("❌ Error starting AI categorization:", error);
    isAiCategorizationRunning = false;
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/ai-categorize/stop", async (req, res) => {
  try {
    console.log("🛑 Stop AI categorization requested");
    
    if (!isAiCategorizationRunning) {
      return res.status(400).json({ 
        error: "No AI categorization process is currently running" 
      });
    }
    
    shouldStopAiCategorization = true;
    const processedCount = aiCategorizationProcessed;
    
    res.json({ 
      success: true, 
      processed: processedCount,
      total: aiCategorizationTotal,
      message: "AI categorization will stop after current tag completes" 
    });
  } catch (error) {
    console.error("❌ Error stopping AI categorization:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get("/api/tags/ai-categorize/status", async (req, res) => {
  try {
    res.json({
      isRunning: isAiCategorizationRunning,
      processed: aiCategorizationProcessed,
      total: aiCategorizationTotal,
      currentTag: aiCategorizationCurrentTag,
      progress: aiCategorizationTotal > 0 ? Math.round((aiCategorizationProcessed / aiCategorizationTotal) * 100) : 0
    });
  } catch (error) {
    console.error("❌ Error getting AI categorization status:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get recently categorized tags (what changed)
router.get("/api/tags/ai-categorize/recent-changes", async (req, res) => {
  try {
    const { tagMetadata } = await import("@shared/schema");
    const { desc, sql: drizzleSql } = await import("drizzle-orm");
    
    // Get tags updated in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const recentlyUpdated = await db.select({
      id: tagMetadata.id,
      name: tagMetadata.name,
      category: tagMetadata.category,
      parentTagId: tagMetadata.parentTagId,
      updatedAt: tagMetadata.updatedAt,
      createdAt: tagMetadata.createdAt
    })
    .from(tagMetadata)
    .where(drizzleSql`updated_at > ${oneHourAgo}`)
    .orderBy(desc(tagMetadata.updatedAt))
    .limit(100);
    
    // Get parent tag names for context
    const parentIds = recentlyUpdated
      .map(t => t.parentTagId)
      .filter(Boolean) as string[];
    
    const parentTags = parentIds.length > 0 
      ? await db.select({
          id: tagMetadata.id,
          name: tagMetadata.name,
          category: tagMetadata.category
        })
        .from(tagMetadata)
        .where(drizzleSql`id = ANY(${parentIds})`)
      : [];
    
    const parentMap = new Map(parentTags.map(p => [p.id, p]));
    
    // Get usage counts from analyses
    const changes = await Promise.all(
      recentlyUpdated.map(async (tag) => {
        // Count how many analyses have this tag with the new category
        const countResult = await db.execute(drizzleSql`
          SELECT COUNT(*)::integer as count
          FROM historical_news_analyses
          WHERE tags @> ${JSON.stringify([{ name: tag.name, category: tag.category }])}::jsonb
        `);
        
        const usageCount = countResult.rows[0]?.count || 0;
        const parent = tag.parentTagId ? parentMap.get(tag.parentTagId) : null;
        
        return {
          tagName: tag.name,
          newCategory: tag.category,
          parentTag: parent ? { name: parent.name, category: parent.category } : null,
          usageCount,
          updatedAt: tag.updatedAt,
          createdAt: tag.createdAt,
          isNew: tag.createdAt && tag.updatedAt && 
                 Math.abs(tag.createdAt.getTime() - tag.updatedAt.getTime()) < 1000
        };
      })
    );
    
    res.json({
      success: true,
      count: changes.length,
      changes,
      message: `Found ${changes.length} recently categorized tags`
    });
  } catch (error) {
    console.error("❌ Error getting recent changes:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// TAG MANAGER CRUD ENDPOINTS (for normalized tags table)
// ============================================================================

// Get all tags from normalized tags table
router.get("/api/tags", async (req, res) => {
  try {
    const { tags: tagsTable } = await import("@shared/schema");
    const { asc } = await import("drizzle-orm");
    
    const allTags = await db.select()
      .from(tagsTable)
      .orderBy(asc(tagsTable.category), asc(tagsTable.name));
    
    console.log(`📊 Fetched ${allTags.length} tags from normalized table`);
    res.json(allTags);
  } catch (error) {
    console.error("❌ Error fetching tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create a new tag
router.post("/api/tags", async (req, res) => {
  try {
    const { name, category, subcategoryPath } = req.body;
    
    if (!name || !category) {
      return res.status(400).json({ error: "name and category are required" });
    }
    
    const { tags: tagsTable } = await import("@shared/schema");
    
    const [newTag] = await db.insert(tagsTable).values({
      name: name.trim(),
      category: category.trim(),
      normalizedName: normalizeTagName(name.trim()),
      subcategoryPath: subcategoryPath || [],
      usageCount: 0,
    }).returning();
    
    console.log(`✅ Created new tag: "${name}" in category "${category}" path: ${subcategoryPath?.join(' → ') || 'root'}`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json(newTag);
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: "Tag already exists in this category" });
    }
    console.error("❌ Error creating tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Move a tag to a different category/subcategory
router.post("/api/tags/:id/move", async (req, res) => {
  try {
    const { id } = req.params;
    const { category, subcategoryKey } = req.body;
    
    if (!id || !category) {
      return res.status(400).json({ error: "tag id and category are required" });
    }
    
    const { tags: tagsTable } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    // Store just the single subcategory key (simplified approach)
    // Tree-builder derives hierarchy from the key itself
    // Key "root" or empty means no subcategory
    let subcategoryPath: string[] = [];
    if (subcategoryKey && subcategoryKey !== 'root') {
      subcategoryPath = [subcategoryKey]; // Just store the final key
    }
    
    const [updatedTag] = await db.update(tagsTable)
      .set({ 
        category: category.trim(),
        subcategoryPath: subcategoryPath.length > 0 ? subcategoryPath : null,
        updatedAt: new Date()
      })
      .where(eq(tagsTable.id, id))
      .returning();
    
    if (!updatedTag) {
      return res.status(404).json({ error: "Tag not found" });
    }
    
    console.log(`✅ Moved tag "${updatedTag.name}" to category "${category}" path: ${subcategoryPath.join(' → ') || 'root'}`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json(updatedTag);
  } catch (error) {
    console.error("❌ Error moving tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update a tag
router.patch("/api/tags/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: "tag id is required" });
    }
    
    const { tags: tagsTable } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    const updates: any = { updatedAt: new Date() };
    if (name) {
      updates.name = name.trim();
      updates.normalizedName = normalizeTagName(name.trim());
    }
    if (category) {
      updates.category = category.trim();
    }
    
    const [updatedTag] = await db.update(tagsTable)
      .set(updates)
      .where(eq(tagsTable.id, id))
      .returning();
    
    if (!updatedTag) {
      return res.status(404).json({ error: "Tag not found" });
    }
    
    console.log(`✅ Updated tag ${id}: ${JSON.stringify(updates)}`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json(updatedTag);
  } catch (error) {
    console.error("❌ Error updating tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete a tag
router.delete("/api/tags/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: "tag id is required" });
    }
    
    const { tags: tagsTable, pagesAndTags, historicalNewsAnalyses } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    // Get the tag before deleting to know its name
    const [tagToDelete] = await db.select()
      .from(tagsTable)
      .where(eq(tagsTable.id, id))
      .limit(1);
    
    if (!tagToDelete) {
      return res.status(404).json({ error: "Tag not found" });
    }
    
    // First delete all associations in pages_and_tags
    await db.delete(pagesAndTags).where(eq(pagesAndTags.tagId, id));
    
    // Remove tag name from all tags_version2 arrays in analyses
    await db.execute(sql`
      UPDATE historical_news_analyses
      SET tags_version2 = array_remove(tags_version2, ${tagToDelete.name})
      WHERE ${tagToDelete.name} = ANY(tags_version2)
    `);
    
    // Then delete the tag
    const [deletedTag] = await db.delete(tagsTable)
      .where(eq(tagsTable.id, id))
      .returning();
    
    console.log(`✅ Deleted tag: "${deletedTag.name}" (${deletedTag.category})`);
    console.log(`✅ Removed tag from tags_version2 arrays in analyses`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
    res.json({ success: true, deleted: deletedTag });
  } catch (error) {
    console.error("❌ Error deleting tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete a tag by name and category (used by tag manager UI)
router.post("/api/tags-manager/delete", async (req, res) => {
  try {
    const { tagName, category } = req.body;
    
    if (!tagName || !category) {
      return res.status(400).json({ error: "tagName and category are required" });
    }
    
    const { tags: tagsTable, pagesAndTags, historicalNewsAnalyses } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    
    // Find the tag by name and category
    const [tagToDelete] = await db.select()
      .from(tagsTable)
      .where(and(
        eq(tagsTable.name, tagName),
        eq(tagsTable.category, category)
      ))
      .limit(1);
    
    if (!tagToDelete) {
      return res.status(404).json({ error: `Tag "${tagName}" in category "${category}" not found` });
    }
    
    // Count how many analyses have this tag in tags_version2
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM historical_news_analyses
      WHERE ${tagName} = ANY(tags_version2)
    `);
    const affectedCount = countResult.rows[0]?.count || 0;
    
    // First delete all associations in pages_and_tags
    await db.delete(pagesAndTags).where(eq(pagesAndTags.tagId, tagToDelete.id));
    
    // Remove tag name from all tags_version2 arrays in analyses
    await db.execute(sql`
      UPDATE historical_news_analyses
      SET tags_version2 = array_remove(tags_version2, ${tagName})
      WHERE ${tagName} = ANY(tags_version2)
    `);
    
    // Then delete the tag
    const [deletedTag] = await db.delete(tagsTable)
      .where(eq(tagsTable.id, tagToDelete.id))
      .returning();
    
    console.log(`✅ Deleted tag: "${deletedTag.name}" (${deletedTag.category})`);
    console.log(`✅ Removed tag from ${affectedCount} analyses' tags_version2 arrays`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    
    res.json({ 
      success: true, 
      deleted: deletedTag,
      updated: parseInt(affectedCount.toString(), 10)
    });
  } catch (error) {
    console.error("❌ Error deleting tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Tag quality check endpoint
router.get("/api/tags/quality-check", async (req, res) => {
  try {
    const { tags: tagsTable } = await import("@shared/schema");
    
    // 1. Get all tags without subcategory_path (tags at root level)
    const tagsWithoutPath = await db.execute(sql`
      SELECT id, name, category, usage_count
      FROM tags
      WHERE subcategory_path IS NULL OR array_length(subcategory_path, 1) IS NULL
      ORDER BY category, name
    `);
    
    // 2. Get all tag names from tags table
    const allTagNames = await db.execute(sql`
      SELECT id, name, category, usage_count
      FROM tags
      ORDER BY name
    `);
    
    // 3. Get all unique tag names actually used in tags_version2 arrays
    const usedTagNames = await db.execute(sql`
      SELECT DISTINCT unnest(tags_version2) as tag_name
      FROM historical_news_analyses
      WHERE tags_version2 IS NOT NULL AND array_length(tags_version2, 1) > 0
    `);
    
    const usedTagNamesSet = new Set((usedTagNames.rows as any[]).map(r => r.tag_name));
    
    // 4. Find tags in database that are never used in summaries
    const unusedTags = (allTagNames.rows as any[]).filter(tag => !usedTagNamesSet.has(tag.name));
    
    console.log(`📊 Quality check: ${tagsWithoutPath.rows.length} tags without path, ${unusedTags.length} unused tags`);
    
    res.json({
      tagsWithoutPath: tagsWithoutPath.rows,
      unusedTags: unusedTags,
      totalTags: allTagNames.rows.length,
      totalUsedInSummaries: usedTagNamesSet.size,
    });
  } catch (error) {
    console.error("❌ Error in tag quality check:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Rename a category (update all tags in that category)
router.post("/api/tags/category/rename", async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    
    if (!oldName || !newName) {
      return res.status(400).json({ error: "oldName and newName are required" });
    }
    
    const { tags: tagsTable } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    const result = await db.update(tagsTable)
      .set({ 
        category: newName.trim(),
        updatedAt: new Date()
      })
      .where(eq(tagsTable.category, oldName))
      .returning();
    
    console.log(`✅ Renamed category "${oldName}" to "${newName}" (${result.length} tags updated)`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json({ success: true, updated: result.length });
  } catch (error) {
    console.error("❌ Error renaming category:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// DATA CLEANUP ENDPOINT
// ============================================================================

// Fix broken subcategory paths (one-time cleanup)
router.post("/api/tags/fix-broken-paths", async (req, res) => {
  try {
    console.log("🔧 Fixing broken subcategory paths...");
    
    const { tags: tagsTable } = await import("@shared/schema");
    const { sql: drizzleSql } = await import("drizzle-orm");
    
    // Fix paths that have wrong format (e.g., ["1", "2", "1"] instead of ["1.2", "1.2.1"])
    // A proper path element should contain a dot like "1.2"
    const result = await db.execute(drizzleSql`
      UPDATE tags 
      SET subcategory_path = NULL, updated_at = NOW()
      WHERE subcategory_path IS NOT NULL 
        AND array_length(subcategory_path, 1) > 0
        AND subcategory_path[1] ~ '^[0-9]+$'
      RETURNING id, name, category
    `);
    
    console.log(`✅ Fixed ${result.rows.length} tags with broken paths`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json({ 
      success: true, 
      fixed: result.rows.length,
      tags: result.rows 
    });
  } catch (error) {
    console.error("❌ Error fixing broken paths:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// ============================================================================
// SUBCATEGORY MANAGEMENT ENDPOINTS
// ============================================================================

// Create a new subcategory (creates a placeholder tag entry)
router.post("/api/tags/subcategory", async (req, res) => {
  try {
    const { category, parentPath, name } = req.body;
    
    if (!category || !name) {
      return res.status(400).json({ error: "category and name are required" });
    }
    
    // Generate a new key based on parent path
    // If parentPath is ["1", "2"], new subcategory would be "1.2.X" where X is next available
    const { tags: tagsTable } = await import("@shared/schema");
    const { sql: drizzleSql } = await import("drizzle-orm");
    
    // Find existing subcategories at this level to determine next key
    const parentPathStr = (parentPath || []).join('.');
    const prefix = parentPathStr ? `${parentPathStr}.` : '';
    
    // Get all existing keys at this level
    const existingKeys = await db.execute(drizzleSql`
      SELECT DISTINCT subcategory_path
      FROM tags
      WHERE category = ${category}
        AND array_length(subcategory_path, 1) = ${(parentPath || []).length + 1}
        ${parentPath && parentPath.length > 0 
          ? drizzleSql`AND subcategory_path[1:${parentPath.length}] = ${parentPath}::text[]` 
          : drizzleSql``}
    `);
    
    // Find next available number
    let nextNum = 1;
    const existingNums = new Set<number>();
    for (const row of existingKeys.rows) {
      const path = (row as any).subcategory_path as string[];
      if (path && path.length > 0) {
        const lastPart = path[path.length - 1];
        const num = parseInt(lastPart.split('.').pop() || '0');
        if (!isNaN(num)) existingNums.add(num);
      }
    }
    while (existingNums.has(nextNum)) nextNum++;
    
    // Generate new subcategory key
    const newKey = parentPath && parentPath.length > 0 
      ? [...parentPath, `${parentPath[parentPath.length - 1]}.${nextNum}`]
      : [`${nextNum}`];
    
    // Create a placeholder tag with this subcategory path
    // The name becomes the subcategory "label" and we create a special marker
    const [newTag] = await db.insert(tagsTable).values({
      name: `_subcategory_${name}`,
      category: category,
      normalizedName: normalizeTagName(name),
      subcategoryPath: newKey,
      usageCount: 0,
    }).returning();
    
    console.log(`✅ Created subcategory "${name}" in ${category} with path: ${newKey.join(' → ')}`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json({ success: true, subcategoryKey: newKey.join('.'), name });
  } catch (error) {
    console.error("❌ Error creating subcategory:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Rename a subcategory (persists name in subcategory_labels table)
router.post("/api/tags/subcategory/rename", async (req, res) => {
  try {
    const { category, subcategoryKey, newName } = req.body;
    
    if (!subcategoryKey || !newName) {
      return res.status(400).json({ error: "subcategoryKey and newName are required" });
    }
    
    const { subcategoryLabels } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    console.log(`📝 Renaming subcategory "${subcategoryKey}" to "${newName}"`);
    
    // Upsert: insert or update the label
    await db.insert(subcategoryLabels)
      .values({
        path: subcategoryKey,
        label: newName.trim(),
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: subcategoryLabels.path,
        set: {
          label: newName.trim(),
          updatedAt: new Date()
        }
      });
    
    console.log(`✅ Saved custom label for "${subcategoryKey}" as "${newName}"`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json({ success: true, message: `Subcategory renamed to "${newName}"` });
  } catch (error) {
    console.error("❌ Error renaming subcategory:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete a subcategory
router.post("/api/tags/subcategory/delete", async (req, res) => {
  try {
    const { category, subcategoryKey, action } = req.body;
    
    if (!category || !subcategoryKey || !action) {
      return res.status(400).json({ error: "category, subcategoryKey, and action are required" });
    }
    
    const { tags: tagsTable, pagesAndTags } = await import("@shared/schema");
    const { eq, and, sql: drizzleSql } = await import("drizzle-orm");
    
    // Parse the subcategory key into path array
    const subcategoryPath = subcategoryKey.split('.');
    
    // Find all tags in this subcategory (and nested subcategories)
    const tagsInSubcategory = await db.execute(drizzleSql`
      SELECT id, name, subcategory_path
      FROM tags
      WHERE category = ${category}
        AND subcategory_path IS NOT NULL
        AND array_length(subcategory_path, 1) >= ${subcategoryPath.length}
        AND subcategory_path[1:${subcategoryPath.length}] = ${subcategoryPath}::text[]
    `);
    
    const tagIds = tagsInSubcategory.rows.map((r: any) => r.id as string);
    
    if (action === 'delete') {
      // Delete all tags in this subcategory
      if (tagIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        
        // Delete associations
        await db.delete(pagesAndTags).where(inArray(pagesAndTags.tagId, tagIds));
        
        // Delete tags
        await db.delete(tagsTable).where(inArray(tagsTable.id, tagIds));
      }
      
      console.log(`✅ Deleted subcategory ${subcategoryKey} and ${tagIds.length} tags`);
    } else if (action === 'move_to_parent') {
      // Move tags to parent category (remove one level from subcategoryPath)
      const parentPath = subcategoryPath.slice(0, -1);
      
      for (const row of tagsInSubcategory.rows) {
        const tag = row as any;
        const currentPath = tag.subcategory_path as string[];
        
        // Remove the deleted subcategory level from the path
        const newPath = currentPath.length > subcategoryPath.length 
          ? [...parentPath, ...currentPath.slice(subcategoryPath.length)]
          : parentPath;
        
        await db.update(tagsTable)
          .set({ 
            subcategoryPath: newPath.length > 0 ? newPath : null,
            updatedAt: new Date()
          })
          .where(eq(tagsTable.id, tag.id));
      }
      
      console.log(`✅ Moved ${tagIds.length} tags from ${subcategoryKey} to parent`);
    }
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json({ success: true, affected: tagIds.length });
  } catch (error) {
    console.error("❌ Error deleting subcategory:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete a category (delete all tags in that category)
router.post("/api/tags/category/delete", async (req, res) => {
  try {
    const { category } = req.body;
    
    if (!category) {
      return res.status(400).json({ error: "category is required" });
    }
    
    const { tags: tagsTable, pagesAndTags } = await import("@shared/schema");
    const { eq, inArray } = await import("drizzle-orm");
    
    // Get all tag IDs in this category
    const tagsInCategory = await db.select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.category, category));
    
    const tagIds = tagsInCategory.map(t => t.id);
    
    if (tagIds.length > 0) {
      // Delete all associations first
      await db.delete(pagesAndTags).where(inArray(pagesAndTags.tagId, tagIds));
      
      // Then delete all tags in the category
      await db.delete(tagsTable).where(eq(tagsTable.category, category));
    }
    
    console.log(`✅ Deleted category "${category}" (${tagIds.length} tags removed)`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:hierarchy');
    
    res.json({ success: true, deleted: tagIds.length });
  } catch (error) {
    console.error("❌ Error deleting category:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete all unused tags (aligns with quality-check: tags not present in tags_version2)
router.post("/api/tags/delete-unused", async (req, res) => {
  try {
    console.log("🧹 Deleting unused tags based on tags_version2 usage...");
    
    const { tags: tagsTable, pagesAndTags } = await import("@shared/schema");
    const { inArray, not } = await import("drizzle-orm");
    const { sql } = await import("drizzle-orm");
    
    // Get all unique tag names actually used in summaries (tags_version2)
    const usedTagNames = await db.execute(sql`
      SELECT DISTINCT unnest(tags_version2) as tag_name
      FROM historical_news_analyses
      WHERE tags_version2 IS NOT NULL AND array_length(tags_version2, 1) > 0
    `);
    const usedNames = (usedTagNames.rows as any[]).map(r => r.tag_name as string);
    
    // Find tags whose names are NOT used in summaries
    const unusedTags = usedNames.length > 0
      ? await db.select().from(tagsTable).where(not(inArray(tagsTable.name, usedNames)))
      : await db.select().from(tagsTable); // if no used tags, everything is unused
    
    if (unusedTags.length === 0) {
      return res.json({ success: true, deletedCount: 0, message: "No unused tags to delete" });
    }
    
    console.log(`🗑️ Found ${unusedTags.length} unused tags to delete (not present in tags_version2)`);
    
    // Collect IDs to clean up join table first
    const unusedIds = unusedTags.map(t => t.id);
    
    // Delete any lingering page/tag associations (defensive)
    await db.delete(pagesAndTags).where(inArray(pagesAndTags.tagId, unusedIds));
    
    // Delete unused tags
    await db.delete(tagsTable).where(inArray(tagsTable.id, unusedIds));
    
    console.log(`✅ Deleted ${unusedTags.length} unused tags`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:catalog-v2');
    cacheManager.invalidate('tags:catalog-v2:manual');
    cacheManager.invalidate('tags:hierarchy');
    cacheManager.invalidate('tags:filter-tree');
    cacheManager.invalidate('tags:manage');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
    res.json({ 
      success: true, 
      deletedCount: unusedTags.length,
      message: `Deleted ${unusedTags.length} unused tags`
    });
  } catch (error) {
    console.error("❌ Error deleting unused tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Allocate unmatched tags to categories based on similarity
router.post("/api/tags/allocate-unmatched", async (req, res) => {
  try {
    console.log("🚀 Starting unmatched tag allocation via API...");
    const { historicalNewsAnalyses } = await import("@shared/schema");
    const { findSimilarTags, normalizeTagName } = await import("../services/tag-similarity");
    const { sql } = await import("drizzle-orm");
    
    // Get all tags from analyses
    console.log("📊 Fetching all tags from analyses...");
    const allAnalyses = await db
      .select({ tags: historicalNewsAnalyses.tags })
      .from(historicalNewsAnalyses);
    
    const analysisTagMap = new Map<string, { name: string; category?: string; count: number }>();
    
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        for (const tag of analysis.tags as any[]) {
          if (tag.name) {
            const key = tag.name.toLowerCase().trim();
            if (!analysisTagMap.has(key)) {
              analysisTagMap.set(key, {
                name: tag.name,
                category: tag.category,
                count: 0,
              });
            }
            analysisTagMap.get(key)!.count++;
          }
        }
      }
    }
    
    // Get all tags from metadata
    console.log("📊 Fetching all tags from tag_metadata...");
    const allMetadataTags = await db.select().from(tagMetadata);
    const metadataTagMap = new Map<string, { name: string; category: string; id: string; parentTagId: string | null }>();
    
    for (const tag of allMetadataTags) {
      const key = tag.name.toLowerCase().trim();
      metadataTagMap.set(key, {
        name: tag.name,
        category: tag.category,
        id: tag.id,
        parentTagId: tag.parentTagId,
      });
    }
    
    // Find unmatched tags
    const unmatchedTags: Array<{ name: string; category?: string; count: number }> = [];
    for (const [key, tag] of analysisTagMap) {
      if (!metadataTagMap.has(key)) {
        unmatchedTags.push(tag);
      }
    }
    
    if (unmatchedTags.length === 0) {
      return res.json({
        success: true,
        message: "No unmatched tags found. All tags are already allocated!",
        allocated: 0,
        skipped: 0,
        unallocatable: 0,
      });
    }
    
    // Convert metadata tags to array for similarity matching
    const matchedTagsArray = Array.from(metadataTagMap.values()).map(t => ({
      name: t.name,
      category: t.category,
    }));
    
    console.log(`🔍 Finding similar tags for ${unmatchedTags.length} unmatched tags...`);
    
    const allocations: Array<{
      unmatchedTag: { name: string; category?: string; count: number };
      matchedTag: { name: string; category: string; id: string; parentTagId: string | null } | null;
      similarity: number;
    }> = [];
    
    // Find best match for each unmatched tag
    for (const unmatchedTag of unmatchedTags) {
      const similar = findSimilarTags(unmatchedTag.name, matchedTagsArray, 0.6);
      
      if (similar.length > 0) {
        const bestMatch = similar[0];
        const matchedTag = metadataTagMap.get(bestMatch.name!.toLowerCase().trim());
        
        if (matchedTag) {
          allocations.push({
            unmatchedTag,
            matchedTag,
            similarity: bestMatch.similarity,
          });
        }
      } else {
        allocations.push({
          unmatchedTag,
          matchedTag: null,
          similarity: 0,
        });
      }
    }
    
    // Sort by similarity
    allocations.sort((a, b) => b.similarity - a.similarity);
    
    // Filter high confidence matches (≥0.7)
    const toAllocate = allocations.filter(a => a.matchedTag !== null && a.similarity >= 0.7);
    const lowConfidence = allocations.filter(a => a.matchedTag !== null && a.similarity >= 0.6 && a.similarity < 0.7);
    const unallocatable = allocations.filter(a => a.matchedTag === null || a.similarity < 0.6);
    
    if (toAllocate.length === 0) {
      return res.json({
        success: true,
        message: "No tags with high confidence matches found.",
        allocated: 0,
        skipped: 0,
        lowConfidence: lowConfidence.length,
        unallocatable: unallocatable.length,
        unallocatableTags: unallocatable.slice(0, 50).map(a => ({
          name: a.unmatchedTag.name,
          count: a.unmatchedTag.count,
        })),
      });
    }
    
    console.log(`💾 Creating ${toAllocate.length} tag_metadata entries...`);
    
    let created = 0;
    let skipped = 0;
    const createdTags: string[] = [];
    
    for (const alloc of toAllocate) {
      try {
        // Check if tag already exists
        const existing = await db
          .select()
          .from(tagMetadata)
          .where(
            sql`LOWER(TRIM(${tagMetadata.name})) = LOWER(TRIM(${alloc.unmatchedTag.name}))`
          )
          .limit(1);
        
        if (existing.length > 0) {
          skipped++;
          continue;
        }
        
        // Create new tag_metadata entry
        await db.insert(tagMetadata).values({
          name: alloc.unmatchedTag.name,
          category: alloc.matchedTag!.category,
          normalizedName: normalizeTagName(alloc.unmatchedTag.name),
          usageCount: alloc.unmatchedTag.count,
          parentTagId: alloc.matchedTag!.parentTagId || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        
        createdTags.push(`${alloc.unmatchedTag.name} → ${alloc.matchedTag!.category} (${(alloc.similarity * 100).toFixed(1)}%)`);
        created++;
      } catch (error: any) {
        if (error.code === '23505') {
          skipped++;
        } else {
          console.error(`❌ Error creating "${alloc.unmatchedTag.name}":`, error.message);
        }
      }
    }
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:catalog-v2');
    cacheManager.invalidate('tags:catalog-v2:manual');
    cacheManager.invalidate('tags:hierarchy');
    
    console.log(`✅ Allocation complete! Created: ${created}, Skipped: ${skipped}`);
    
    res.json({
      success: true,
      message: `Allocated ${created} unmatched tags`,
      allocated: created,
      skipped: skipped,
      lowConfidence: lowConfidence.length,
      unallocatable: unallocatable.length,
      createdTags: createdTags.slice(0, 50),
      unallocatableTags: unallocatable.slice(0, 50).map(a => ({
        name: a.unmatchedTag.name,
        count: a.unmatchedTag.count,
      })),
    });
  } catch (error) {
    console.error("❌ Error allocating unmatched tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;

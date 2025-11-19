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
import { tagSimilarity } from "../services/tag-similarity";

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

router.post("/api/batch-tagging/start", async (req, res) => {
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
    
    const response = {
      entitiesByCategory: data.entities_by_category || {},
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
      const similar = tagSimilarity.findSimilarTags(tag.name, candidateTags, 0.7);
      
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
        normalizedName: tagSimilarity.normalizeTagName(tag.name),
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
    const similar = tagSimilarity.findSimilarTags(tagName as string, candidateTags, parseFloat(threshold as string));
    
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
          VALUES (${row.name}, ${row.category}, ${tagSimilarity.normalizeTagName(row.name as string)}, ${parseInt(String(row.usage_count)) || 0})
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

export default router;

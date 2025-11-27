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

// Tags Manager API endpoints
router.get("/api/tags-manager/stats", async (req, res) => {
  try {
    console.log("📊 Fetching tags manager stats");
    
    // Use PostgreSQL to get tag statistics
    const result = await db.execute(sql`
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
      )
      SELECT 
        category,
        name,
        count
      FROM tag_counts
      ORDER BY category, count DESC, name;
    `);
    
    // Group by category
    const tagsByCategory: Record<string, Array<{ name: string; count: number; category: string }>> = {};
    let totalTags = 0;
    let totalOccurrences = 0;
    
    for (const row of result.rows) {
      const category = row.category as string;
      const name = row.name as string;
      const count = parseInt(String(row.count)) || 0;
      
      if (!tagsByCategory[category]) {
        tagsByCategory[category] = [];
      }
      
      tagsByCategory[category].push({ name, count, category });
      totalTags++;
      totalOccurrences += count;
    }
    
    console.log(`✅ Found ${totalTags} unique tags across ${Object.keys(tagsByCategory).length} categories`);
    
    res.json({
      tagsByCategory,
      totalTags,
      totalOccurrences,
      categories: Object.keys(tagsByCategory).sort()
    });
  } catch (error) {
    console.error("❌ Error fetching tags manager stats:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/rename", async (req, res) => {
  try {
    const { oldName, newName, category } = req.body;
    
    if (!oldName || !newName || !category) {
      return res.status(400).json({ error: "oldName, newName, and category are required" });
    }
    
    console.log(`🏷️ Renaming tag "${oldName}" to "${newName}" in category "${category}"`);
    
    // Update all analyses that use this tag
    const { historicalNewsAnalyses } = await import("@shared/schema");
    const allAnalyses = await db.select().from(historicalNewsAnalyses);
    
    let updated = 0;
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        let hasTag = false;
        const updatedTags = analysis.tags.map((t: any) => {
          if (t.name === oldName && t.category === category) {
            hasTag = true;
            return { ...t, name: newName };
          }
          return t;
        });
        
        if (hasTag) {
          const { eq } = await import("drizzle-orm");
          await db
            .update(historicalNewsAnalyses)
            .set({ tags: updatedTags })
            .where(eq(historicalNewsAnalyses.date, analysis.date));
          updated++;
        }
      }
    }
    
    console.log(`✅ Renamed tag in ${updated} analyses`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
    res.json({ 
      success: true, 
      updated,
      message: `Tag renamed in ${updated} analyses` 
    });
  } catch (error) {
    console.error("❌ Error renaming tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/merge", async (req, res) => {
  try {
    const { sourceTag, targetTag } = req.body;
    
    if (!sourceTag?.name || !sourceTag?.category || !targetTag?.name || !targetTag?.category) {
      return res.status(400).json({ error: "sourceTag and targetTag with name and category are required" });
    }
    
    console.log(`🏷️ Merging tag "${sourceTag.name}" (${sourceTag.category}) into "${targetTag.name}" (${targetTag.category})`);
    
    // Update all analyses: replace source tag with target tag
    const { historicalNewsAnalyses } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const allAnalyses = await db.select().from(historicalNewsAnalyses);
    
    let updated = 0;
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        let hasSourceTag = false;
        const updatedTags = analysis.tags
          .map((t: any) => {
            if (t.name === sourceTag.name && t.category === sourceTag.category) {
              hasSourceTag = true;
              return { name: targetTag.name, category: targetTag.category };
            }
            return t;
          })
          .filter((t: any, index: number, arr: any[]) => {
            // Remove duplicates (in case target tag already exists)
            return arr.findIndex((other: any) => 
              other.name === t.name && other.category === t.category
            ) === index;
          });
        
        if (hasSourceTag) {
          await db
            .update(historicalNewsAnalyses)
            .set({ tags: updatedTags })
            .where(eq(historicalNewsAnalyses.date, analysis.date));
          updated++;
        }
      }
    }
    
    console.log(`✅ Merged tags in ${updated} analyses`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
    res.json({ 
      success: true, 
      updated,
      message: `Tags merged in ${updated} analyses` 
    });
  } catch (error) {
    console.error("❌ Error merging tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/change-category", async (req, res) => {
  try {
    const { tagName, oldCategory, newCategory } = req.body;
    
    if (!tagName || !oldCategory || !newCategory) {
      return res.status(400).json({ error: "tagName, oldCategory, and newCategory are required" });
    }
    
    console.log(`🏷️ Moving tag "${tagName}" from "${oldCategory}" to "${newCategory}"`);
    
    // Update all analyses that use this tag
    const { historicalNewsAnalyses } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const allAnalyses = await db.select().from(historicalNewsAnalyses);
    
    let updated = 0;
    for (const analysis of allAnalyses) {
      if (analysis.tags && Array.isArray(analysis.tags)) {
        let hasTag = false;
        const updatedTags = analysis.tags.map((t: any) => {
          if (t.name === tagName && t.category === oldCategory) {
            hasTag = true;
            return { ...t, category: newCategory };
          }
          return t;
        });
        
        if (hasTag) {
          await db
            .update(historicalNewsAnalyses)
            .set({ tags: updatedTags })
            .where(eq(historicalNewsAnalyses.date, analysis.date));
          updated++;
        }
      }
    }
    
    console.log(`✅ Changed category for ${updated} analyses`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
    res.json({ 
      success: true, 
      updated,
      message: `Tag category changed in ${updated} analyses` 
    });
  } catch (error) {
    console.error("❌ Error changing tag category:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/categorize-currencies", async (req, res) => {
  try {
    console.log("🏗️ Categorizing currencies into Commodity Money, Cryptocurrency, and Fiat Currency...");
    
    const { tagMetadata } = await import("@shared/schema");
    const { eq, and, or, inArray } = await import("drizzle-orm");
    const { normalizeTagName } = await import("../services/tag-similarity");
    
    // Helper function to categorize a currency name
    const categorizeCurrency = (name: string): 'commodity' | 'cryptocurrency' | 'fiat' | null => {
      const normalized = name.toLowerCase().trim();
      
      // Skip non-currency tags (amounts, generic terms)
      if (normalized.includes('billion') || normalized.includes('million') || 
          normalized.includes('trillion') || normalized.startsWith('$') ||
          normalized === 'abc' || normalized === 'bit' || normalized === 'eco' ||
          normalized === 'etf' || normalized === 'ico' || normalized === 'nft') {
        return null; // Skip these
      }
      
      // Known fiat currencies (ISO 4217 codes and common names)
      const fiatCurrencies = new Set([
        'usd', 'eur', 'gbp', 'jpy', 'cny', 'inr', 'cad', 'aud', 'chf', 'nzd',
        'sek', 'nok', 'dkk', 'pln', 'czk', 'huf', 'ron', 'bgn', 'hrk',
        'rub', 'try', 'zar', 'mxn', 'brl', 'ars', 'clp', 'cop', 'pen',
        'krw', 'sgd', 'hkd', 'twd', 'thb', 'myr', 'idr', 'php', 'vnd',
        'us dollar', 'u.s. dollar', 'us dollars', 'euro', 'euros', 'pound', 'pounds',
        'yen', 'yuan', 'rupee', 'dollar', 'sterling', 'franc', 'francs',
        'krona', 'peso', 'real', 'won', 'ringgit', 'bolivar', 'bolivars',
        'british pound', 'pounds sterling', 'swiss franc', 'swiss francs',
        'singapore dollar', 'singapore dollars', 'australian dollar',
        'cfa franc', 'congolese franc', 'linden dollars'
      ]);
      
      // Known cryptocurrencies (including stablecoins)
      const cryptocurrencies = new Set([
        'bitcoin', 'btc', 'ethereum', 'eth', 'litecoin', 'ltc', 'bitcoin cash', 'bch',
        'bitcoin sv', 'bsv', 'bitcoin gold', 'btg', 'dogecoin', 'doge', 'cardano', 'ada',
        'solana', 'sol', 'xrp', 'ripple', 'usdc', 'usdt', 'tether', 'dash', 'monero', 'xmr',
        'zcash', 'zec', 'stellar', 'xlm', 'polkadot', 'dot', 'chainlink', 'link',
        'uniswap', 'uni', 'aave', 'compound', 'comp', 'maker', 'mkr', 'sushi', 'sushiswap',
        'pancakeswap', 'cake', 'avalanche', 'avax', 'polygon', 'matic', 'cosmos', 'atom',
        'algorand', 'algo', 'tezos', 'xtz', 'eos', 'tron', 'trx', 'vechain', 'vet',
        'filecoin', 'fil', 'the graph', 'grt', 'decentraland', 'mana', 'sandbox', 'sand',
        'axie infinity', 'axs', 'gala', 'enjin', 'enj', 'chiliz', 'chz', 'flow',
        'near', 'near protocol', 'fantom', 'ftm', 'harmony', 'one', 'celo', 'cgld',
        'hedera', 'hbar', 'iota', 'miota', 'icon', 'icx', 'zilliqa', 'zil',
        'altcoins', 'crypto', 'cryptocurrency', 'defi', 'stablecoin', 'stablecoins',
        // Stablecoins
        'dai', 'pax', 'pax dollar', 'ust', 'usdt', 'usdc', 'tusd', 'busd', 'gusd',
        // Other crypto tokens
        'bal', 'bfx', 'btu', 'crv', 'fet', 'gho', 'icp', 'jto', 'kin', 'leo', 'nem', 'neo',
        'prq', 'sky', 'vrc', 'wct', 'xec', 'xem', 'yfi', 'zcl', 'kmd', 'pol'
      ]);
      
      // Known commodity money (precious metals)
      const commodityMoney = new Set([
        'gold', 'silver', 'platinum', 'palladium', 'copper', 'bronze',
        'gold-backed', 'gold-backed assets'
      ]);
      
      // Check exact matches first
      if (fiatCurrencies.has(normalized)) {
        return 'fiat';
      }
      if (cryptocurrencies.has(normalized)) {
        return 'cryptocurrency';
      }
      if (commodityMoney.has(normalized)) {
        return 'commodity';
      }
      
      // Check partial matches
      if (normalized.includes('bitcoin') || normalized.includes('btc') || 
          normalized.includes('ethereum') || normalized.includes('eth') ||
          normalized.includes('crypto') || (normalized.includes('coin') && !normalized.includes('dollar')) ||
          normalized.includes('token') || normalized.includes('defi') ||
          normalized.includes('blockchain')) {
        return 'cryptocurrency';
      }
      
      if (normalized.includes('dollar') || normalized.includes('euro') ||
          normalized.includes('pound') || normalized.includes('yen') ||
          normalized.includes('yuan') || normalized.includes('rupee') ||
          normalized.includes('peso') || normalized.includes('franc') ||
          normalized.includes('krona') || normalized.includes('won') ||
          normalized.includes('bolivar')) {
        return 'fiat';
      }
      
      if (normalized.includes('gold') || normalized.includes('silver') ||
          normalized.includes('platinum') || normalized.includes('palladium')) {
        return 'commodity';
      }
      
      // Default: if it's a 3-letter code, likely fiat; otherwise, likely crypto
      if (/^[a-z]{3}$/.test(normalized)) {
        return 'fiat';
      }
      
      // Default to cryptocurrency for unknown currencies (most are crypto in this context)
      return 'cryptocurrency';
    };
    
    // Step 1: Get Currency parent tag
    let currencyTag = await db.select()
      .from(tagMetadata)
      .where(
        and(
          eq(tagMetadata.name, 'Currency'),
          eq(tagMetadata.category, 'currency')
        )
      )
      .limit(1);
    
    if (currencyTag.length === 0) {
      // Create Currency parent tag if it doesn't exist
      const [newCurrency] = await db.insert(tagMetadata)
        .values({
          name: 'Currency',
          category: 'currency',
          parentTagId: null,
          normalizedName: normalizeTagName('Currency'),
          usageCount: 0,
        })
        .returning();
      currencyTag = [newCurrency];
      console.log(`✅ Created "Currency" parent tag (ID: ${newCurrency.id})`);
    }
    
    const currencyId = currencyTag[0].id;
    
    // Step 2: Create or find the three subcategory tags
    const subcategories = [
      { name: 'Commodity Money', category: 'currency' },
      { name: 'Cryptocurrency', category: 'crypto' },
      { name: 'Fiat Currency', category: 'currency' }
    ];
    
    const subcategoryIds: Record<string, string> = {};
    
    for (const subcat of subcategories) {
      let existing = await db.select()
        .from(tagMetadata)
        .where(
          and(
            eq(tagMetadata.name, subcat.name),
            eq(tagMetadata.category, subcat.category)
          )
        )
        .limit(1);
      
      if (existing.length === 0) {
        const [newSubcat] = await db.insert(tagMetadata)
          .values({
            name: subcat.name,
            category: subcat.category,
            parentTagId: currencyId,
            normalizedName: normalizeTagName(subcat.name),
            usageCount: 0,
          })
          .returning();
        subcategoryIds[subcat.name] = newSubcat.id;
        console.log(`✅ Created "${subcat.name}" tag under Currency (ID: ${newSubcat.id})`);
      } else {
        // Update existing tag to be under Currency
        await db.update(tagMetadata)
          .set({
            parentTagId: currencyId,
            updatedAt: new Date(),
          })
          .where(eq(tagMetadata.id, existing[0].id));
        subcategoryIds[subcat.name] = existing[0].id;
        console.log(`✅ Updated "${subcat.name}" tag to be under Currency (ID: ${existing[0].id})`);
      }
    }
    
    // Step 3: Get all currency tags (from crypto and currency categories)
    const allCurrencyTags = await db.select()
      .from(tagMetadata)
      .where(
        or(
          eq(tagMetadata.category, 'crypto'),
          eq(tagMetadata.category, 'currency')
        )
      );
    
    // Filter out the parent tags themselves
    const parentTagNames = new Set(['Currency', 'Commodity Money', 'Cryptocurrency', 'Fiat Currency']);
    const currencyTagsToCategorize = allCurrencyTags.filter(
      tag => !parentTagNames.has(tag.name) && tag.parentTagId !== currencyId
    );
    
    console.log(`📊 Found ${currencyTagsToCategorize.length} currency tags to categorize`);
    
    // Step 4: Categorize each currency tag
    const categorized: Record<string, string[]> = {
      'Commodity Money': [],
      'Cryptocurrency': [],
      'Fiat Currency': []
    };
    
    let updated = 0;
    
    for (const tag of currencyTagsToCategorize) {
      const category = categorizeCurrency(tag.name);
      
      // Skip if categorization returned null (non-currency tag)
      if (!category) {
        continue;
      }
      
      let parentId: string | null = null;
      let categoryName = '';
      
      if (category === 'commodity') {
        parentId = subcategoryIds['Commodity Money'];
        categoryName = 'Commodity Money';
      } else if (category === 'cryptocurrency') {
        parentId = subcategoryIds['Cryptocurrency'];
        categoryName = 'Cryptocurrency';
      } else if (category === 'fiat') {
        parentId = subcategoryIds['Fiat Currency'];
        categoryName = 'Fiat Currency';
      }
      
      if (parentId && tag.parentTagId !== parentId) {
        await db.update(tagMetadata)
          .set({
            parentTagId: parentId,
            updatedAt: new Date(),
          })
          .where(eq(tagMetadata.id, tag.id));
        
        categorized[categoryName].push(tag.name);
        updated++;
      }
    }
    
    console.log(`✅ Categorized ${updated} currency tags:`);
    console.log(`   Commodity Money: ${categorized['Commodity Money'].length}`);
    console.log(`   Cryptocurrency: ${categorized['Cryptocurrency'].length}`);
    console.log(`   Fiat Currency: ${categorized['Fiat Currency'].length}`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:manage');
    
    res.json({
      success: true,
      message: `Categorized ${updated} currencies into Commodity Money (${categorized['Commodity Money'].length}), Cryptocurrency (${categorized['Cryptocurrency'].length}), and Fiat Currency (${categorized['Fiat Currency'].length})`,
      categorized,
      updated
    });
  } catch (error) {
    console.error("❌ Error categorizing currencies:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/organize-bitcoin", async (req, res) => {
  try {
    console.log("🏗️ Organizing Bitcoin-related tags under Bitcoin hierarchy...");
    
    const { tagMetadata } = await import("@shared/schema");
    const { eq, and, or, like, ilike } = await import("drizzle-orm");
    const { normalizeTagName } = await import("../services/tag-similarity");
    
    // Step 1: Get Cryptocurrency parent tag
    const cryptocurrencyTag = await db.select()
      .from(tagMetadata)
      .where(
        and(
          eq(tagMetadata.name, 'Cryptocurrency'),
          or(
            eq(tagMetadata.category, 'crypto'),
            eq(tagMetadata.category, 'cryptocurrency')
          )
        )
      )
      .limit(1);
    
    if (cryptocurrencyTag.length === 0) {
      return res.status(400).json({ 
        error: "Cryptocurrency parent tag not found. Please run /api/tags-manager/categorize-currencies first." 
      });
    }
    
    const cryptocurrencyId = cryptocurrencyTag[0].id;
    console.log(`✅ Found "Cryptocurrency" tag (ID: ${cryptocurrencyId})`);
    
    // Step 2: Create or find "Bitcoin" tag under Cryptocurrency
    let bitcoinTag = await db.select()
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
    
    let bitcoinId: string;
    
    if (bitcoinTag.length === 0) {
      // Create Bitcoin tag under Cryptocurrency
      const [newBitcoin] = await db.insert(tagMetadata)
        .values({
          name: 'Bitcoin',
          category: 'crypto',
          parentTagId: cryptocurrencyId,
          normalizedName: normalizeTagName('Bitcoin'),
          usageCount: 0,
        })
        .returning();
      bitcoinId = newBitcoin.id;
      console.log(`✅ Created "Bitcoin" tag under Cryptocurrency (ID: ${bitcoinId})`);
    } else {
      bitcoinId = bitcoinTag[0].id;
      // Update existing Bitcoin tag to be under Cryptocurrency if it's not already
      if (bitcoinTag[0].parentTagId !== cryptocurrencyId) {
        await db.update(tagMetadata)
          .set({
            parentTagId: cryptocurrencyId,
            updatedAt: new Date(),
          })
          .where(eq(tagMetadata.id, bitcoinId));
        console.log(`✅ Updated "Bitcoin" tag to be under Cryptocurrency (ID: ${bitcoinId})`);
      } else {
        console.log(`✅ Found existing "Bitcoin" tag under Cryptocurrency (ID: ${bitcoinId})`);
      }
    }
    
    // Step 3: Find all tags with "bitcoin" in the name (case-insensitive)
    // Exclude "Bitcoin" itself and tags that are already under Bitcoin
    const allCryptoTags = await db.select()
      .from(tagMetadata)
      .where(
        or(
          eq(tagMetadata.category, 'crypto'),
          eq(tagMetadata.category, 'cryptocurrency')
        )
      );
    
    // Filter tags that contain "bitcoin" (case-insensitive) but aren't "Bitcoin" itself
    const bitcoinRelatedTags = allCryptoTags.filter(tag => {
      const nameLower = tag.name.toLowerCase();
      return nameLower.includes('bitcoin') && 
             nameLower !== 'bitcoin' &&
             tag.id !== bitcoinId &&
             tag.parentTagId !== bitcoinId;
    });
    
    console.log(`📊 Found ${bitcoinRelatedTags.length} Bitcoin-related tags to organize`);
    
    // Step 4: Link all Bitcoin-related tags to Bitcoin parent
    let organized = 0;
    const organizedTags: string[] = [];
    
    for (const tag of bitcoinRelatedTags) {
      await db.update(tagMetadata)
        .set({
          parentTagId: bitcoinId,
          updatedAt: new Date(),
        })
        .where(eq(tagMetadata.id, tag.id));
      
      organizedTags.push(tag.name);
      organized++;
    }
    
    console.log(`✅ Organized ${organized} Bitcoin-related tags under Bitcoin`);
    if (organizedTags.length > 0) {
      console.log(`   Tags: ${organizedTags.slice(0, 20).join(', ')}${organizedTags.length > 20 ? '...' : ''}`);
    }
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:manage');
    
    res.json({
      success: true,
      message: `Organized ${organized} Bitcoin-related tags under Cryptocurrency → Bitcoin`,
      cryptocurrencyId,
      bitcoinId,
      organized,
      organizedTags: organizedTags.slice(0, 50) // Return first 50 for reference
    });
  } catch (error) {
    console.error("❌ Error organizing Bitcoin tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/organize-crypto", async (req, res) => {
  try {
    console.log("🏗️ Organizing cryptocurrency tags under Currency hierarchy...");
    
    const { tagMetadata } = await import("@shared/schema");
    const { eq, and, or } = await import("drizzle-orm");
    const { normalizeTagName } = await import("../services/tag-similarity");
    
    // Step 1: Get all crypto tags from tag_metadata
    const cryptoTags = await db.select()
      .from(tagMetadata)
      .where(
        or(
          eq(tagMetadata.category, 'crypto'),
          eq(tagMetadata.category, 'cryptocurrency')
        )
      );
    
    console.log(`📊 Found ${cryptoTags.length} crypto tags in metadata`);
    
    if (cryptoTags.length === 0) {
      return res.json({ 
        success: true, 
        message: "No crypto tags found to organize",
        currencyId: null,
        cryptocurrencyId: null,
        organized: 0
      });
    }
    
    // Step 2: Create or find "Currency" parent tag
    let currencyTag = await db.select()
      .from(tagMetadata)
      .where(
        and(
          eq(tagMetadata.name, 'Currency'),
          eq(tagMetadata.category, 'currency')
        )
      )
      .limit(1);
    
    let currencyId: string;
    if (currencyTag.length === 0) {
      // Create Currency parent tag
      const [newCurrency] = await db.insert(tagMetadata)
        .values({
          name: 'Currency',
          category: 'currency',
          parentTagId: null,
          normalizedName: normalizeTagName('Currency'),
          usageCount: 0,
        })
        .returning();
      currencyId = newCurrency.id;
      console.log(`✅ Created "Currency" parent tag (ID: ${currencyId})`);
    } else {
      currencyId = currencyTag[0].id;
      console.log(`✅ Found existing "Currency" tag (ID: ${currencyId})`);
    }
    
    // Step 3: Create or find "Cryptocurrency" intermediate tag under Currency
    let cryptocurrencyTag = await db.select()
      .from(tagMetadata)
      .where(
        and(
          eq(tagMetadata.name, 'Cryptocurrency'),
          or(
            eq(tagMetadata.category, 'crypto'),
            eq(tagMetadata.category, 'cryptocurrency'),
            eq(tagMetadata.category, 'currency')
          )
        )
      )
      .limit(1);
    
    let cryptocurrencyId: string;
    if (cryptocurrencyTag.length === 0) {
      // Create Cryptocurrency tag under Currency
      const [newCryptocurrency] = await db.insert(tagMetadata)
        .values({
          name: 'Cryptocurrency',
          category: 'crypto',
          parentTagId: currencyId,
          normalizedName: normalizeTagName('Cryptocurrency'),
          usageCount: 0,
        })
        .returning();
      cryptocurrencyId = newCryptocurrency.id;
      console.log(`✅ Created "Cryptocurrency" tag under Currency (ID: ${cryptocurrencyId})`);
    } else {
      // Update existing Cryptocurrency tag to be under Currency
      cryptocurrencyId = cryptocurrencyTag[0].id;
      await db.update(tagMetadata)
        .set({
          parentTagId: currencyId,
          updatedAt: new Date(),
        })
        .where(eq(tagMetadata.id, cryptocurrencyId));
      console.log(`✅ Updated "Cryptocurrency" tag to be under Currency (ID: ${cryptocurrencyId})`);
    }
    
    // Step 4: Link all crypto tags to Cryptocurrency parent
    let organized = 0;
    const organizedTags: string[] = [];
    
    for (const tag of cryptoTags) {
      // Skip the Cryptocurrency tag itself
      if (tag.id === cryptocurrencyId) continue;
      
      // Only update if it doesn't already have the correct parent
      if (tag.parentTagId !== cryptocurrencyId) {
        await db.update(tagMetadata)
          .set({
            parentTagId: cryptocurrencyId,
            updatedAt: new Date(),
          })
          .where(eq(tagMetadata.id, tag.id));
        organized++;
        organizedTags.push(tag.name);
      }
    }
    
    console.log(`✅ Organized ${organized} crypto tags under Cryptocurrency`);
    if (organizedTags.length > 0) {
      console.log(`   Tags: ${organizedTags.slice(0, 10).join(', ')}${organizedTags.length > 10 ? '...' : ''}`);
    }
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    
    res.json({
      success: true,
      message: `Organized ${organized} cryptocurrency tags under Currency → Cryptocurrency`,
      currencyId,
      cryptocurrencyId,
      organized,
      organizedTags: organizedTags.slice(0, 20) // Return first 20 for reference
    });
  } catch (error) {
    console.error("❌ Error organizing crypto tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/fix-country-tags", async (req, res) => {
  try {
    console.log("🌍 Fixing country tags in database...");
    
    const { historicalNewsAnalyses } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    // Comprehensive list of countries (same as frontend)
    const knownCountries = new Set([
      'united states', 'usa', 'u.s.', 'u.s.a.', 'america', 'us',
      'china', 'japan', 'germany', 'france', 'india', 'brazil', 'russia',
      'canada', 'australia', 'spain', 'italy', 'mexico', 'south korea',
      'indonesia', 'netherlands', 'turkey', 'saudi arabia', 'israel',
      'poland', 'argentina', 'belgium', 'sweden', 'thailand', 'vietnam',
      'philippines', 'bangladesh', 'egypt', 'pakistan', 'nigeria',
      'south africa', 'colombia', 'malaysia', 'romania', 'chile', 'peru',
      'ukraine', 'iraq', 'morocco', 'algeria', 'kazakhstan', 'greece',
      'czech republic', 'portugal', 'hungary', 'qatar', 'kuwait',
      'new zealand', 'ireland', 'denmark', 'singapore', 'finland',
      'norway', 'switzerland', 'austria', 'united kingdom', 'uk', 'u.k.',
      'england', 'scotland', 'wales', 'northern ireland', 'britain'
    ]);
    
    // US States
    const usStates = new Set([
      'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
      'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
      'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
      'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
      'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
      'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina',
      'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
      'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
      'utah', 'vermont', 'virginia', 'washington', 'west virginia',
      'wisconsin', 'wyoming', 'district of columbia', 'dc', 'washington dc'
    ]);
    
    const isCountry = (name: string): boolean => {
      const normalized = name.toLowerCase().trim();
      return knownCountries.has(normalized) || usStates.has(normalized);
    };
    
    // Use efficient SQL to update all country tags at once
    const allCountryNames = Array.from(knownCountries).concat(Array.from(usStates));
    
    // Process in batches for better performance
    const batchSize = 100;
    let updated = 0;
    const fixedTags: Set<string> = new Set();
    
    const allAnalyses = await db.select().from(historicalNewsAnalyses);
    
    for (let i = 0; i < allAnalyses.length; i += batchSize) {
      const batch = allAnalyses.slice(i, i + batchSize);
      
      for (const analysis of batch) {
        if (!analysis.tags || !Array.isArray(analysis.tags)) continue;
        
        let hasChanges = false;
        const updatedTags = analysis.tags.map((tag: any) => {
          if (!tag.name || !tag.category) return tag;
          
          if (isCountry(tag.name) && tag.category !== 'country') {
            hasChanges = true;
            fixedTags.add(tag.name);
            return { ...tag, category: 'country' };
          }
          return tag;
        });
        
        if (hasChanges) {
          const tagNames = updatedTags.map((t: any) => t.name).filter(Boolean);
          await db.update(historicalNewsAnalyses)
            .set({ 
              tags: updatedTags,
              tagNames: tagNames
            })
            .where(eq(historicalNewsAnalyses.id, analysis.id));
          updated++;
        }
      }
    }
    
    console.log(`✅ Fixed country tags in ${updated} analyses`);
    console.log(`   Fixed tags: ${fixedTags.slice(0, 20).join(', ')}${fixedTags.length > 20 ? '...' : ''}`);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:catalog-v2');
    cacheManager.invalidate('tags:catalog-v2:manual');
    cacheManager.invalidate('tags:manage');
    
    res.json({
      success: true,
      message: `Fixed country tags in ${updated} analyses. Updated ${fixedTags.size} unique tag names.`,
      updated,
      fixedTags: Array.from(fixedTags).slice(0, 50)
    });
  } catch (error) {
    console.error("❌ Error fixing country tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/delete", async (req, res) => {
  try {
    console.log("🗑️ DELETE request received");
    console.log("Request body:", req.body);
    
    const { tagName, category } = req.body;
    
    if (!tagName || !category) {
      console.error("❌ Missing required parameters:", { tagName, category });
      return res.status(400).json({ error: "tagName and category are required" });
    }
    
    console.log(`🗑️ Deleting tag "${tagName}" (${category})`);
    
    // Use direct SQL for performance optimization (avoid fetching all analyses)
    // This uses Postgres JSONB operators to filter and update in place
    const start = Date.now();
    
    // 1. Update historical_news_analyses
    // We use a subquery to rebuild the tags array excluding the target tag
    // ONLY for rows that actually contain the tag (using @> operator for index usage)
    const updateQuery = sql`
      UPDATE historical_news_analyses
      SET tags = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(tags) AS elem
        WHERE NOT (elem->>'name' = ${tagName} AND elem->>'category' = ${category})
      )
      WHERE tags @> ${JSON.stringify([{ name: tagName, category }])}::jsonb
    `;
    
    const result = await db.execute(updateQuery);
    const updated = result.rowCount || 0;
    
    console.log(`✅ Optimized delete took ${Date.now() - start}ms. Updated ${updated} analyses.`);
    
    // 2. Update tag_names array column (remove the tag name from all arrays)
    console.log("🗑️ Removing from tag_names array column...");
    try {
      const updateTagNamesQuery = sql`
        UPDATE historical_news_analyses
        SET tag_names = array_remove(tag_names, ${tagName})
        WHERE ${tagName} = ANY(tag_names)
      `;
      const tagNamesResult = await db.execute(updateTagNamesQuery);
      console.log(`✅ Removed "${tagName}" from tag_names in ${tagNamesResult.rowCount || 0} analyses`);
    } catch (dbError) {
      console.error("⚠️ Error updating tag_names:", dbError);
    }
    
    // 3. Delete from tag_metadata table
    console.log("🗑️ Deleting from tag_metadata table...");
    try {
      const { tagMetadata } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      
      const deleteResult = await db
        .delete(tagMetadata)
        .where(
          and(
            eq(tagMetadata.name, tagName),
            eq(tagMetadata.category, category)
          )
        );
      console.log(`✅ Deleted tag from tag_metadata table:`, deleteResult);
    } catch (dbError) {
      console.error("⚠️ Error deleting from tag_metadata:", dbError);
    }
    
    // Invalidate caches
    console.log("🔄 Invalidating caches...");
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:catalog-v2');
    cacheManager.invalidate('tags:catalog-v2:manual');
    cacheManager.invalidate('tags:hierarchy');
    cacheManager.invalidate('tags:analyses:all');
    cacheManager.invalidate('tags:analyses:manual');
    
    res.json({ 
      success: true, 
      updated,
      message: `Tag deleted from ${updated} analyses and removed from metadata` 
    });
  } catch (error) {
    console.error("❌ Error deleting tag:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : 'No stack trace');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Find actual categories for a tag from the database
router.get("/api/tags-manager/find-categories", async (req, res) => {
  try {
    const { tagName } = req.query;
    
    if (!tagName || typeof tagName !== 'string') {
      return res.status(400).json({ error: "tagName query parameter is required" });
    }
    
    console.log(`🔍 Finding categories for tag: "${tagName}"`);
    
    // Query the database to find all unique categories this tag has
    const result = await db.execute(sql`
      SELECT DISTINCT 
        elem->>'category' as category,
        COUNT(*)::integer as count
      FROM historical_news_analyses,
      LATERAL jsonb_array_elements(tags) AS elem
      WHERE elem->>'name' = ${tagName}
        AND tags IS NOT NULL
        AND jsonb_typeof(tags) = 'array'
      GROUP BY elem->>'category'
      ORDER BY count DESC
    `);
    
    const categories = result.rows.map((row: any) => ({
      category: row.category,
      count: parseInt(row.count) || 0
    }));
    
    console.log(`✅ Found ${categories.length} category(ies) for "${tagName}":`, categories);
    
    res.json({ 
      tagName,
      categories 
    });
  } catch (error) {
    console.error("❌ Error finding tag categories:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Cleanup endpoint: Remove a tag from tag_metadata by name only (useful for orphaned tags)
router.post("/api/tags-manager/cleanup-tag", async (req, res) => {
  try {
    const { tagName } = req.body;
    
    if (!tagName || typeof tagName !== 'string') {
      return res.status(400).json({ error: "tagName is required" });
    }
    
    console.log(`🧹 Cleaning up tag "${tagName}" from tag_metadata...`);
    
    const { tagMetadata } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    
    // Delete from tag_metadata by name only (regardless of category)
    const deleteResult = await db
      .delete(tagMetadata)
      .where(eq(tagMetadata.name, tagName));
    
    // Also remove from tag_names arrays
    const updateTagNamesQuery = sql`
      UPDATE historical_news_analyses
      SET tag_names = array_remove(tag_names, ${tagName})
      WHERE ${tagName} = ANY(tag_names)
    `;
    const tagNamesResult = await db.execute(updateTagNamesQuery);
    
    // Invalidate caches
    cacheManager.invalidate('tags:catalog');
    cacheManager.invalidate('tags:catalog:manual');
    cacheManager.invalidate('tags:catalog-v2');
    cacheManager.invalidate('tags:catalog-v2:manual');
    cacheManager.invalidate('tags:hierarchy');
    
    console.log(`✅ Cleaned up "${tagName}": removed from tag_metadata and ${tagNamesResult.rowCount || 0} tag_names arrays`);
    
    res.json({ 
      success: true, 
      removedFromMetadata: true,
      updatedTagNames: tagNamesResult.rowCount || 0,
      message: `Tag "${tagName}" cleaned up from metadata and tag_names` 
    });
  } catch (error) {
    console.error("❌ Error cleaning up tag:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post("/api/tags-manager/validate-crypto-tags", async (req, res) => {
  try {
    console.log("🔍 Validating crypto tags against taxonomy...");
    
    // Define the correct taxonomy based on user's structure
    const validTags = new Set<string>();
    
    // 1.1 Major Cryptocurrencies (ONLY these 2)
    // Note: Bitcoin Cash removed - redundant, primary subject of "1.6 Bitcoin Forks & Variants"
    // Note: Litecoin moved to 1.2 Altcoins - considered a major altcoin, not top five
    // Note: Bitcoin Gold and Bitcoin SV moved to 1.6 Bitcoin Forks & Variants
    const majorCryptos = ['Bitcoin', 'Ethereum'];
    majorCryptos.forEach(tag => validTags.add(tag.toLowerCase()));
    
    // 1.2 Altcoins
    // Note: Litecoin moved from 1.1 Major Cryptocurrencies
    const altcoins = [
      'Litecoin', 'Bitcoin Gold', 'Cardano', 'Dogecoin', 'Solana', 'Dash', 'Monero', 
      'Binance Coin', 'EOS', 'Polkadot', 'Ethereum Classic', 'Zcash', 'Tezos'
    ];
    altcoins.forEach(tag => validTags.add(tag.toLowerCase()));
    
    // 1.3 Stablecoins
    const stablecoins = ['USDT', 'USDC', 'Tether', 'DAI', 'GUSD', 'TUSD', 'Pax Dollar'];
    stablecoins.forEach(tag => validTags.add(tag.toLowerCase()));
    
    // 1.4 DeFi Tokens
    const defiTokens = [
      'Uniswap', 'AAVE', 'MKR', 'YFI', 'SUSHI', 'CRV', 'Chainlink', 'Synthetix', 'Balancer'
    ];
    defiTokens.forEach(tag => validTags.add(tag.toLowerCase()));
    
    // 1.5 NFTs & Digital Collectibles
    const nfts = ['NFT', 'Ordinals', 'CryptoPunks', 'Bored Ape'];
    nfts.forEach(tag => validTags.add(tag.toLowerCase()));
    
    // 1.6 Bitcoin Forks & Variants
    // Note: Bitcoin Cash removed - redundant (primary subject of this category)
    // Note: Bitcoin Classic and Bitcoin Unlimited removed - they're software implementations, not forks (see 7.1.1)
    // Note: Bitcoin Gold and Bitcoin SV moved from 1.1 Major Cryptocurrencies
    const bitcoinForks = [
      'Bitcoin SV', 'Bitcoin Gold', // Moved from 1.1 Major Cryptocurrencies
      'Bitcoin XT',
      'Bitcoin Private', 'Bitcoin Diamond', 'Bitcoin Atom'
    ];
    bitcoinForks.forEach(tag => validTags.add(tag.toLowerCase()));
    
    // Also add common variations and ticker symbols
    validTags.add('btc'); // Bitcoin
    validTags.add('eth'); // Ethereum
    validTags.add('bch'); // Bitcoin Cash
    validTags.add('ltc'); // Litecoin
    validTags.add('bsv'); // Bitcoin SV
    validTags.add('btg'); // Bitcoin Gold
    validTags.add('ada'); // Cardano
    validTags.add('doge'); // Dogecoin
    validTags.add('sol'); // Solana
    validTags.add('xmr'); // Monero
    validTags.add('bnb'); // Binance Coin
    validTags.add('dot'); // Polkadot
    validTags.add('etc'); // Ethereum Classic
    validTags.add('zec'); // Zcash
    validTags.add('xtz'); // Tezos
    validTags.add('uni'); // Uniswap
    validTags.add('link'); // Chainlink
    validTags.add('bored ape yacht club'); // Bored Ape variation
    validTags.add('bayc'); // Bored Ape Yacht Club
    
    // Get all tags from money-economics category (new taxonomy) or old categories (for backward compatibility)
    const result = await db.execute(sql`
      WITH tag_expanded AS (
        SELECT 
          tag->>'name' as name,
          tag->>'category' as category,
          COUNT(*)::integer as count
        FROM historical_news_analyses,
          jsonb_array_elements(tags) as tag
        WHERE tags IS NOT NULL 
          AND jsonb_typeof(tags) = 'array'
          AND (tag->>'category' = 'money-economics'
               OR tag->>'category' = 'digital-assets'
               OR tag->>'category' = 'crypto' 
               OR tag->>'category' = 'currency' 
               OR tag->>'category' = 'cryptocurrency')
        GROUP BY tag->>'name', tag->>'category'
      )
      SELECT name, category, count
      FROM tag_expanded
      ORDER BY count DESC;
    `);
    
    // Build map of crypto tags
    const cryptoTags = new Map<string, { name: string; category: string; count: number }>();
    for (const row of result.rows) {
      const name = row.name as string;
      const category = row.category as string;
      const count = parseInt(String(row.count)) || 0;
      const key = `${category}::${name}`;
      cryptoTags.set(key, { name, category, count });
    }
    
    console.log(`📊 Found ${cryptoTags.size} unique crypto/currency/money-economics tags`);
    console.log(`📋 Valid tags in taxonomy: ${validTags.size} entries`);
    
    // Tags that should be EXCLUDED (not in taxonomy) - these should go to miscellaneous
    // Note: Bitcoin Unlimited IS valid (in Bitcoin Forks), so don't exclude it
    const excludedTags = new Set<string>([
      'bitcoin price', // Not a cryptocurrency, should be in topics
      'bitcoin core', // Protocol/software, not a cryptocurrency (different from Bitcoin Classic)
      'bitcoin foundation', // Organization, not a cryptocurrency
      'bitcoin-qt', // Software, not a cryptocurrency
      'bitcoin qt', // Variation
      'bitcoin.org', // Website/organization
    ]);
    
    // Helper function to check if a tag is valid
    const isTagValid = (tagName: string): boolean => {
      const normalized = tagName.toLowerCase().trim();
      
      // First check if it's explicitly excluded
      if (excludedTags.has(normalized)) {
        return false;
      }
      
      // Check for excluded patterns (but allow Bitcoin Classic and Bitcoin Unlimited)
      if (normalized.includes('bitcoin price') || 
          normalized.includes('bitcoin foundation') ||
          (normalized.includes('bitcoin-qt') || normalized.includes('bitcoin qt')) ||
          (normalized.includes('bitcoin core') && !normalized.includes('bitcoin classic'))) {
        return false;
      }
      
      // Direct match
      if (validTags.has(normalized)) {
        return true;
      }
      
      // Check for partial matches (e.g., "Bitcoin Cash" contains "bitcoin cash")
      // But be careful - "Bitcoin Price" should NOT match "Bitcoin"
      for (const validTag of validTags) {
        // Only match if it's a complete word match or exact substring
        if (normalized === validTag || 
            (normalized.includes(validTag) && !normalized.includes('price') && !normalized.includes('foundation') && !normalized.includes('core') && !normalized.includes('-qt'))) {
          return true;
        }
      }
      
      // Check for common variations
      const variations: Record<string, string[]> = {
        'bitcoin': ['btc', 'bitcoin'],
        'ethereum': ['eth', 'ethereum'],
        'bitcoin cash': ['bch', 'bitcoin cash', 'bitcoincash'],
        'litecoin': ['ltc', 'litecoin'],
        'bitcoin sv': ['bsv', 'bitcoin sv', 'bitcoinsv'],
        'bitcoin gold': ['btg', 'bitcoin gold', 'bitcoingold'],
        'bitcoin classic': ['bitcoin classic'],
        'bitcoin unlimited': ['bitcoin unlimited'],
        'bitcoin xt': ['bitcoin xt'],
        'bitcoin private': ['bitcoin private'],
        'bitcoin diamond': ['bitcoin diamond'],
        'bitcoin atom': ['bitcoin atom'],
        'cardano': ['ada', 'cardano'],
        'dogecoin': ['doge', 'dogecoin'],
        'solana': ['sol', 'solana'],
        'monero': ['xmr', 'monero'],
        'binance coin': ['bnb', 'binance coin', 'binancecoin'],
        'polkadot': ['dot', 'polkadot'],
        'ethereum classic': ['etc', 'ethereum classic', 'ethereumclassic'],
        'zcash': ['zec', 'zcash'],
        'tezos': ['xtz', 'tezos'],
        'uniswap': ['uni', 'uniswap'],
        'chainlink': ['link', 'chainlink'],
        'tether': ['usdt', 'tether'],
        'usdc': ['usdc'],
        'dai': ['dai'],
        'gusd': ['gusd'],
        'tusd': ['tusd'],
        'pax dollar': ['pax', 'pax dollar', 'paxdollar'],
        'nft': ['nft', 'nfts'],
        'ordinals': ['ordinals', 'ordinal'],
        'cryptopunks': ['cryptopunks', 'cryptopunk'],
        'bored ape': ['bored ape', 'bored ape yacht club', 'bayc']
      };
      
      for (const [key, variants] of Object.entries(variations)) {
        if (variants.some(v => normalized === v || (normalized.includes(v) && !normalized.includes('price') && !normalized.includes('foundation')))) {
          return true;
        }
      }
      
      return false;
    };
    
    // Check which tags are invalid
    const invalidTags: Array<{ name: string; category: string; count: number }> = [];
    const validTagsFound: Array<{ name: string; category: string; count: number }> = [];
    
    for (const [key, tag] of cryptoTags.entries()) {
      if (isTagValid(tag.name)) {
        validTagsFound.push(tag);
      } else {
        invalidTags.push(tag);
      }
    }
    
    console.log(`✅ Found ${validTagsFound.length} valid tags`);
    console.log(`❌ Found ${invalidTags.length} invalid tags to move to miscellaneous`);
    
    // If requested, move invalid tags to miscellaneous
    const { moveToMiscellaneous } = req.body;
    
    if (moveToMiscellaneous === true) {
      console.log(`🔄 Moving ${invalidTags.length} invalid tags to miscellaneous...`);
      
      const { historicalNewsAnalyses } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const movedTags: string[] = [];
      let totalUpdated = 0;
      
      // Get all analyses that need updating
      const allAnalyses = await db.select().from(historicalNewsAnalyses);
      
      // Process in batches for better performance
      const batchSize = 100;
      for (let i = 0; i < allAnalyses.length; i += batchSize) {
        const batch = allAnalyses.slice(i, i + batchSize);
        
        for (const analysis of batch) {
          if (!analysis.tags || !Array.isArray(analysis.tags)) continue;
          
          let hasChanges = false;
          const updatedTags = analysis.tags.map((t: any) => {
            // Check if this tag should be moved to miscellaneous
            const shouldMove = invalidTags.some(
              it => t.name === it.name && t.category === it.category
            );
            
            if (shouldMove) {
              hasChanges = true;
              return { ...t, category: 'miscellaneous' };
            }
            return t;
          });
          
          if (hasChanges) {
            const tagNames = updatedTags.map((t: any) => t.name).filter(Boolean);
            await db.update(historicalNewsAnalyses)
              .set({ 
                tags: updatedTags,
                tagNames: tagNames
              })
              .where(eq(historicalNewsAnalyses.id, analysis.id));
            totalUpdated++;
          }
        }
      }
      
      // Track which tags were moved
      invalidTags.forEach(tag => {
        movedTags.push(`${tag.name} (${tag.category}) - ${tag.count} occurrences`);
      });
      
      console.log(`✅ Moved ${invalidTags.length} tags to miscellaneous in ${totalUpdated} analyses`);
      
      // Invalidate caches
      cacheManager.invalidate('tags:catalog');
      cacheManager.invalidate('tags:catalog:manual');
      cacheManager.invalidate('tags:catalog-v2');
      cacheManager.invalidate('tags:catalog-v2:manual');
      cacheManager.invalidate('tags:analyses:all');
      cacheManager.invalidate('tags:analyses:manual');
      
      res.json({
        success: true,
        message: `Moved ${invalidTags.length} invalid tags to miscellaneous`,
        validTags: validTagsFound.length,
        invalidTags: invalidTags.length,
        movedTags: movedTags.slice(0, 50), // Return first 50
        updatedAnalyses: totalUpdated
      });
    } else {
      // Just return the validation results
      res.json({
        success: true,
        message: `Found ${invalidTags.length} invalid tags (use moveToMiscellaneous: true to move them)`,
        validTags: validTagsFound.length,
        invalidTags: invalidTags.length,
        invalidTagList: invalidTags.slice(0, 100).map(t => `${t.name} (${t.category}) - ${t.count} occurrences`),
        validTagList: validTagsFound.slice(0, 50).map(t => `${t.name} (${t.category}) - ${t.count} occurrences`)
      });
    }
  } catch (error) {
    console.error("❌ Error validating crypto tags:", error);
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

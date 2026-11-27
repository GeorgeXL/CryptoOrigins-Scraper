import { Router } from "express";
import { sql } from "drizzle-orm";

import { storage } from "../storage";
import { cacheManager } from "../services/cache-manager";
import { db } from "../db";
import {
  getBatchTaggingStatus,
  getContextTaggingStatus,
  startBatchTagging,
  startContextTagging,
  stopBatchTagging,
  stopContextTagging,
} from "../services/batch-tagging";

const router = Router();

function invalidateTagCaches() {
  cacheManager.invalidate("tags:catalog-v2");
  cacheManager.invalidate("tags:catalog-v2:manual");
}

router.get("/api/tags/catalog-v2", async (_req, res) => {
  try {
    const cacheKey = "tags:catalog-v2";
    const cached = cacheManager.get(cacheKey);
    if (cached) return res.json(cached);

    const result = await db.execute(sql`
      WITH tag_expanded AS (
        SELECT unnest(tags_version2) AS tag_name
        FROM historical_news_analyses
        WHERE tags_version2 IS NOT NULL AND array_length(tags_version2, 1) > 0
      ),
      tag_counts AS (
        SELECT tag_name AS name, COUNT(*)::integer AS count
        FROM tag_expanded
        WHERE tag_name IS NOT NULL AND btrim(tag_name) <> ''
        GROUP BY tag_name
      ),
      counts AS (
        SELECT
          COUNT(*)::integer AS total_analyses,
          COUNT(*) FILTER (
            WHERE tags_version2 IS NOT NULL AND array_length(tags_version2, 1) > 0
          )::integer AS tagged_count,
          COUNT(*) FILTER (
            WHERE tags_version2 IS NULL OR array_length(tags_version2, 1) = 0
          )::integer AS untagged_count
        FROM historical_news_analyses
      )
      SELECT
        COALESCE(
          jsonb_agg(jsonb_build_object('name', name, 'count', count) ORDER BY count DESC, name ASC),
          '[]'::jsonb
        ) AS tags,
        (SELECT tagged_count FROM counts) AS tagged_count,
        (SELECT untagged_count FROM counts) AS untagged_count,
        (SELECT total_analyses FROM counts) AS total_analyses
      FROM tag_counts;
    `);

    const data = result.rows[0] as {
      tags: Array<{ name: string; count: number }>;
      tagged_count: number;
      untagged_count: number;
      total_analyses: number;
    };

    const response = {
      tags: data.tags ?? [],
      taggedCount: Number(data.tagged_count) || 0,
      untaggedCount: Number(data.untagged_count) || 0,
      totalAnalyses: Number(data.total_analyses) || 0,
    };

    cacheManager.set(cacheKey, response, 300_000);
    res.json(response);
  } catch (error) {
    console.error("Error fetching tag catalog v2:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/bulk-add", async (req, res) => {
  try {
    const { dates, tag } = req.body;
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: "dates must be a non-empty array" });
    }
    if (!tag || typeof tag.name !== "string" || !tag.name.trim()) {
      return res.status(400).json({ error: "tag.name is required" });
    }

    const tagName = tag.name.trim();
    let updated = 0;

    for (const date of dates) {
      const analysis = await storage.getAnalysisByDate(date);
      if (!analysis) continue;

      const current = Array.isArray(analysis.tagsVersion2) ? analysis.tagsVersion2 : [];
      if (current.includes(tagName)) continue;

      await storage.updateAnalysis(date, { tagsVersion2: [...current, tagName] });
      updated++;
    }

    invalidateTagCaches();
    res.json({ success: true, updated, message: `Tag added to ${updated} analyses` });
  } catch (error) {
    console.error("Error bulk adding tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/bulk-remove", async (req, res) => {
  try {
    const { dates, tag } = req.body;
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: "dates must be a non-empty array" });
    }
    if (!tag || typeof tag.name !== "string" || !tag.name.trim()) {
      return res.status(400).json({ error: "tag.name is required" });
    }

    const tagName = tag.name.trim();
    let updated = 0;

    for (const date of dates) {
      const analysis = await storage.getAnalysisByDate(date);
      if (!analysis) continue;

      const current = Array.isArray(analysis.tagsVersion2) ? analysis.tagsVersion2 : [];
      const next = current.filter((name) => name !== tagName);
      if (next.length === current.length) continue;

      await storage.updateAnalysis(date, { tagsVersion2: next });
      updated++;
    }

    invalidateTagCaches();
    res.json({ success: true, updated, message: `Tag removed from ${updated} analyses` });
  } catch (error) {
    console.error("Error bulk removing tags:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags-manager/delete", async (req, res) => {
  try {
    const { tagName } = req.body;
    if (!tagName || typeof tagName !== "string" || !tagName.trim()) {
      return res.status(400).json({ error: "tagName is required" });
    }

    const updated = await storage.removeTagFromAllAnalyses(tagName.trim());
    invalidateTagCaches();
    res.json({ success: true, updated });
  } catch (error) {
    console.error("Error deleting tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/rename-global", async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName || typeof oldName !== "string" || typeof newName !== "string") {
      return res.status(400).json({ error: "oldName and newName are required" });
    }

    const updated = await storage.renameTagInAllAnalyses(oldName.trim(), newName.trim());
    invalidateTagCaches();
    res.json({ success: true, updated });
  } catch (error) {
    console.error("Error renaming tag:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tags/flush-cache", async (_req, res) => {
  invalidateTagCaches();
  res.json({ success: true });
});

router.post("/api/batch-tagging/start", async (req, res) => {
  try {
    const { dates } = req.body;
    const result = await startBatchTagging(dates ?? null);
    res.json({
      success: true,
      total: result.total,
      message: `Starting batch tagging of ${result.total} analyses`,
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("already running") ? 409 : 500;
    console.error("Error starting batch tagging:", error);
    res.status(status).json({ error: message });
  }
});

router.post("/api/batch-tagging/stop", async (_req, res) => {
  try {
    const result = stopBatchTagging();
    res.json({
      success: true,
      processed: result.processed,
      total: result.total,
      message: "Batch tagging will stop after current analysis completes",
    });
  } catch (error) {
    console.error("Error stopping batch tagging:", error);
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/batch-tagging/status", async (_req, res) => {
  try {
    res.json(getBatchTaggingStatus());
  } catch (error) {
    console.error("Error getting batch tagging status:", error);
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post("/api/tagging/with-context/start", async (req, res) => {
  try {
    const { dates } = req.body;
    const result = await startContextTagging(dates ?? null);
    res.json({
      success: true,
      total: result.total,
      message: `Starting context tagging of ${result.total} analyses`,
    });
  } catch (error) {
    const message = (error as Error).message;
    const status = message.includes("already running") ? 409 : 500;
    console.error("Error starting context tagging:", error);
    res.status(status).json({ error: message });
  }
});

router.post("/api/tagging/with-context/stop", async (_req, res) => {
  try {
    const result = stopContextTagging();
    res.json({
      success: true,
      processed: result.processed,
      total: result.total,
      message: "Context tagging will stop after current analysis completes",
    });
  } catch (error) {
    console.error("Error stopping context tagging:", error);
    res.status(400).json({ error: (error as Error).message });
  }
});

router.get("/api/tagging/with-context/status", async (_req, res) => {
  try {
    res.json(getContextTaggingStatus());
  } catch (error) {
    console.error("Error getting context tagging status:", error);
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

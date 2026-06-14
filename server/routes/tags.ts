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

export default router;

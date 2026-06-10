import { Router } from "express";

import {
  cacheMainEventsGeminiForLeaf,
  backfillAllMainEventsSourceUrls,
  backfillMainEventsSourceUrls,
  getLeafCorpusStats,
  getMainEventsCacheOverview,
  getMainEventsCheckSnapshot,
  previewLeafCoverageCheck,
  runLeafCoverageCheck,
  setMainEventsDismissal,
} from "../services/leaf-agent/coverage";
import type { MainEventsDismissCategory } from "@shared/leaf-agent-config";

const router = Router();

router.get("/api/main-events-check/snapshot/:leaf", async (req, res) => {
  try {
    const snapshot = await getMainEventsCheckSnapshot(decodeURIComponent(req.params.leaf ?? ""));
    res.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load main events snapshot";
    const status = message.includes("Unknown") || message.includes("Ambiguous") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.get("/api/main-events-check/stats/:leaf", async (req, res) => {
  try {
    const stats = await getLeafCorpusStats(decodeURIComponent(req.params.leaf ?? ""));
    res.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load leaf stats";
    const status = message.includes("Unknown") || message.includes("Ambiguous") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

router.get("/api/main-events-check/preview/:leaf", async (req, res) => {
  try {
    const result = await previewLeafCoverageCheck(decodeURIComponent(req.params.leaf ?? ""));
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cached cross-check";
    const status =
      message.includes("No cached main events list")
        ? 404
        : message.includes("Unknown") || message.includes("Ambiguous")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

router.get("/api/main-events-check/cache-overview", async (_req, res) => {
  try {
    const overview = await getMainEventsCacheOverview();
    res.json(overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load cache overview";
    res.status(500).json({ error: message });
  }
});

router.post("/api/main-events-check/cache-gemini", async (req, res) => {
  try {
    const leaf = typeof req.body?.leaf === "string" ? req.body.leaf.trim() : "";
    if (!leaf) {
      res.status(400).json({ error: "leaf is required" });
      return;
    }

    const result = await cacheMainEventsGeminiForLeaf(leaf, {
      force: req.body?.force === true,
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cache Gemini list";
    const status =
      message.includes("Unknown") ||
      message.includes("Ambiguous") ||
      message.includes("GEMINI") ||
      message.includes("GOOGLE_API_KEY")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/api/main-events-check/run", async (req, res) => {
  try {
    const leaf = typeof req.body?.leaf === "string" ? req.body.leaf.trim() : "";
    if (!leaf) {
      res.status(400).json({ error: "leaf is required" });
      return;
    }

    const autoLockMatches =
      typeof req.body?.autoLockMatches === "boolean" ? req.body.autoLockMatches : true;
    const refreshFromGemini = req.body?.refreshFromGemini === true;

    const result = await runLeafCoverageCheck({ leaf, autoLockMatches, refreshFromGemini });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Main events check failed";
    const status =
      message.includes("Unknown") ||
      message.includes("Ambiguous") ||
      message.includes("GEMINI") ||
      message.includes("GOOGLE_API_KEY")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

const DISMISS_CATEGORIES = new Set<MainEventsDismissCategory>(["misplaced", "missing", "extra"]);

router.post("/api/main-events-check/dismiss", async (req, res) => {
  try {
    const leaf = typeof req.body?.leaf === "string" ? req.body.leaf.trim() : "";
    const category = req.body?.category;
    const date = typeof req.body?.date === "string" ? req.body.date.trim() : "";
    const dismissed = req.body?.dismissed !== false;

    if (!leaf) {
      res.status(400).json({ error: "leaf is required" });
      return;
    }
    if (!DISMISS_CATEGORIES.has(category)) {
      res.status(400).json({ error: "category must be misplaced, missing, or extra" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }

    const result = await setMainEventsDismissal({ leaf, category, date, dismissed });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update dismissal";
    const status =
      message.includes("No main events check saved") ||
      message.includes("No cached main events list")
        ? 404
        : message.includes("Unknown") || message.includes("Ambiguous")
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/api/main-events-check/backfill-links", async (req, res) => {
  try {
    const leaf = typeof req.body?.leaf === "string" ? req.body.leaf.trim() : "";
    const all = req.body?.all === true;

    if (all) {
      const results = await backfillAllMainEventsSourceUrls();
      res.json({ results });
      return;
    }

    if (!leaf) {
      res.status(400).json({ error: "leaf is required unless all is true" });
      return;
    }

    const result = await backfillMainEventsSourceUrls(leaf);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to backfill source links";
    const status =
      message.includes("Unknown") ||
      message.includes("Ambiguous") ||
      message.includes("No cached main events list") ||
      message.includes("GEMINI") ||
      message.includes("GOOGLE_API_KEY")
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

export default router;

import { Router } from "express";
import { asc, desc, eq, and } from "drizzle-orm";
import { db } from "../db";
import { humanReviewQueue } from "@shared/schema";
import { requireAgentSecret } from "../services/agents-sdk/auth";
import {
  getEditorialCutoverStatus,
  getEditorialPipelineRun,
  pauseEditorialPipelineRun,
  resumeEditorialPipelineRun,
  shadowValidatePipelineWindow,
  startEditorialPipelineRun,
  stopEditorialPipelineRun,
} from "../services/editorial-pipeline/run";
import { executeApprovedReviewItem } from "../services/editorial-pipeline/approved-writer";
import { detectMilestoneGapsInWindow } from "../services/editorial-pipeline/milestones";

const router = Router();

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

router.post("/api/agent/pipeline/run", async (req, res) => {
  try {
    requireAgentSecret(req);
    const { dateFrom, dateTo, maxDaysToConsider } = req.body || {};
    if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
      return res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
    }
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (dateFrom > dateTo) {
      return res.status(400).json({ error: "dateFrom must be <= dateTo" });
    }

    const out = await startEditorialPipelineRun({
      dateFrom,
      dateTo,
      maxDaysToConsider: Number(maxDaysToConsider) || 60,
      requestedBy: "admin-ui",
    });

    res.json({
      ...out,
      status: "running",
      note: "Triage-first pipeline run started (existing search/summarization flows preserved).",
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Pipeline run failed" });
  }
});

router.get("/api/agent/pipeline/runs/:id", async (req, res) => {
  try {
    requireAgentSecret(req);
    const out = await getEditorialPipelineRun(req.params.id);
    if (!out) return res.status(404).json({ error: "Run not found" });
    res.json(out);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to fetch pipeline run" });
  }
});

router.post("/api/agent/pipeline/runs/:id/stop", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const stopped = stopEditorialPipelineRun(id);
    if (!stopped) {
      return res.status(409).json({ error: "Run is not active in this runtime", status: "not-stoppable" });
    }
    res.json({ success: true, status: "stopped" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to stop pipeline run" });
  }
});

router.post("/api/agent/pipeline/runs/:id/pause", async (req, res) => {
  try {
    requireAgentSecret(req);
    const paused = pauseEditorialPipelineRun(req.params.id);
    if (!paused) return res.status(409).json({ error: "Run is not active in this runtime" });
    res.json({ success: true, status: "paused" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to pause run" });
  }
});

router.post("/api/agent/pipeline/runs/:id/resume", async (req, res) => {
  try {
    requireAgentSecret(req);
    const out = await resumeEditorialPipelineRun(req.params.id);
    res.json({ success: true, ...out, status: "running" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to resume run" });
  }
});

router.post("/api/agent/pipeline/shadow-validate", async (req, res) => {
  try {
    requireAgentSecret(req);
    const { dateFrom, dateTo, maxDaysToConsider } = req.body || {};
    if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
      return res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
    }
    const out = await shadowValidatePipelineWindow({
      dateFrom,
      dateTo,
      maxDaysToConsider: Number(maxDaysToConsider) || 60,
    });
    res.json(out);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Shadow validation failed" });
  }
});

router.get("/api/agent/pipeline/milestones/gaps", async (req, res) => {
  try {
    requireAgentSecret(req);
    const dateFrom = (req.query.dateFrom as string) || "2009-01-01";
    const dateTo = (req.query.dateTo as string) || new Date().toISOString().slice(0, 10);
    const gaps = await detectMilestoneGapsInWindow(dateFrom, dateTo);
    res.json({ gaps, count: gaps.length });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to detect milestone gaps" });
  }
});

router.get("/api/agent/pipeline/cutover-status", async (req, res) => {
  try {
    requireAgentSecret(req);
    res.json(getEditorialCutoverStatus());
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to get cutover status" });
  }
});

router.get("/api/agent/pipeline/runs/:id/evidence", async (req, res) => {
  try {
    requireAgentSecret(req);
    const run = await getEditorialPipelineRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const steps = (run.steps as any[]).map((s) => ({
      stepId: s.id,
      agentName: s.agentName,
      evidence: s.evidence ?? null,
      output: s.output ?? null,
    }));
    res.json({ runId: req.params.id, steps });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to load evidence" });
  }
});

router.get("/api/agent/pipeline/review", async (req, res) => {
  try {
    requireAgentSecret(req);
    const status = (req.query.status as string) || "pending";
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await db
      .select()
      .from(humanReviewQueue)
      .where(eq(humanReviewQueue.status, status))
      .orderBy(desc(humanReviewQueue.priority), asc(humanReviewQueue.createdAt))
      .limit(limit);
    res.json({ items: rows });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to load review queue" });
  }
});

router.post("/api/agent/pipeline/review/:id/approve", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin-ui";
    const notes = (req.body?.notes as string) || null;
    const updated = await db
      .update(humanReviewQueue)
      .set({
        status: "approved",
        reviewer,
        reviewNotes: notes,
        reviewedAt: new Date(),
      })
      .where(and(eq(humanReviewQueue.id, id), eq(humanReviewQueue.status, "pending")))
      .returning({ id: humanReviewQueue.id, runId: humanReviewQueue.runId });
    if (!updated.length) return res.status(404).json({ error: "Pending review item not found" });
    const execution = await executeApprovedReviewItem(updated[0].id);
    res.json({ success: true, itemId: updated[0].id, runId: updated[0].runId, execution });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Approve review failed" });
  }
});

router.post("/api/agent/pipeline/review/:id/reject", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin-ui";
    const notes = (req.body?.notes as string) || null;
    const updated = await db
      .update(humanReviewQueue)
      .set({
        status: "rejected",
        reviewer,
        reviewNotes: notes,
        reviewedAt: new Date(),
      })
      .where(and(eq(humanReviewQueue.id, id), eq(humanReviewQueue.status, "pending")))
      .returning({ id: humanReviewQueue.id, runId: humanReviewQueue.runId });
    if (!updated.length) return res.status(404).json({ error: "Pending review item not found" });
    res.json({ success: true, itemId: updated[0].id, runId: updated[0].runId });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Reject review failed" });
  }
});

export default router;

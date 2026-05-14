import { Router } from "express";
import { asc, desc, eq, and, count } from "drizzle-orm";
import { db } from "../db";
import { agentDecisions, agentSessions, humanReviewQueue } from "@shared/schema";
import { requireAgentSecret } from "../services/agents-sdk/auth";
import { isWikiOverseerPassRunning, startWikiOverseerPass, stopWikiOverseerPass } from "../services/agents-sdk/wiki-overseer-run";
import { applyApprovedProposal } from "../services/agents-sdk/apply-approved-proposal";
import type { ProposalAfterState } from "../services/agents-sdk/apply-approved-proposal";
import {
  getEditorialPipelineRun,
  startEditorialPipelineRun,
  stopEditorialPipelineRun,
} from "../services/editorial-pipeline/run";

const router = Router();

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

router.get("/api/agent/decisions", async (req, res) => {
  try {
    requireAgentSecret(req);
    const status = (req.query.status as string) || "pending";
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const rows = await db
      .select({
        id: agentDecisions.id,
        sessionId: agentDecisions.sessionId,
        module: agentDecisions.module,
        type: agentDecisions.type,
        targetType: agentDecisions.targetType,
        targetId: agentDecisions.targetId,
        confidence: agentDecisions.confidence,
        status: agentDecisions.status,
        beforeState: agentDecisions.beforeState,
        afterState: agentDecisions.afterState,
        reasoning: agentDecisions.reasoning,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .where(eq(agentDecisions.status, status))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit);

    res.json({ decisions: rows });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to list decisions" });
  }
});

router.post("/api/agent/decisions/:id/approve", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin";
    const execute = req.body?.execute === true;

    const [decision] = await db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.id, id), eq(agentDecisions.status, "pending")))
      .limit(1);

    if (!decision) {
      return res.status(404).json({ error: "Pending decision not found" });
    }

    let execution: { ok: boolean; message: string } = {
      ok: true,
      message: "Skipped execution (execute not requested).",
    };

    if (execute) {
      execution = await applyApprovedProposal({
        sessionId: decision.sessionId,
        passNumber: decision.passNumber,
        module: decision.module,
        decisionId: decision.id,
        afterState: (decision.afterState as ProposalAfterState) ?? null,
        approvedBy: reviewer,
      });
      if (!execution.ok) {
        return res.status(400).json({ error: execution.message, execution });
      }
    }

    await db
      .update(agentDecisions)
      .set({
        status: "approved",
        approvedBy: reviewer,
        approvedAt: new Date(),
      })
      .where(eq(agentDecisions.id, id));

    res.json({ success: true, execution });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Approve failed" });
  }
});

router.post("/api/agent/decisions/:id/reject", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const reviewer = (req.body?.reviewer as string) || "admin";

    const updated = await db
      .update(agentDecisions)
      .set({
        status: "rejected",
        approvedBy: reviewer,
        approvedAt: new Date(),
      })
      .where(and(eq(agentDecisions.id, id), eq(agentDecisions.status, "pending")))
      .returning({ id: agentDecisions.id });

    if (!updated.length) {
      return res.status(404).json({ error: "Pending decision not found" });
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Reject failed" });
  }
});

router.post("/api/agent/wiki-overseer/run", async (req, res) => {
  try {
    requireAgentSecret(req);
    const { dateFrom, dateTo, maxDaysToConsider, maxProposals } = req.body || {};

    if (!dateFrom || !dateTo || typeof dateFrom !== "string" || typeof dateTo !== "string") {
      return res.status(400).json({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" });
    }
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (dateFrom > dateTo) {
      return res.status(400).json({ error: "dateFrom must be <= dateTo" });
    }

    const out = await startWikiOverseerPass({
      dateFrom,
      dateTo,
      maxDaysToConsider: Number(maxDaysToConsider) || 7,
      maxProposals: Number(maxProposals) || 15,
    });

    res.json({ ...out, status: "running" });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Overseer run failed" });
  }
});

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
    res.json({ success: true, itemId: updated[0].id, runId: updated[0].runId });
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

router.post("/api/agent/sessions/:id/stop", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;
    const [session] = await db
      .select({ id: agentSessions.id, status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .limit(1);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const stopping = stopWikiOverseerPass(id);
    if (stopping) {
      await db
        .update(agentSessions)
        .set({
          status: "stopped",
          completedAt: new Date(),
          stats: {
            phase: "stopped",
            stopReason: "Stop requested by admin",
            lastHeartbeatIso: new Date().toISOString(),
          },
        })
        .where(eq(agentSessions.id, id));
      return res.json({ success: true, status: "stopped" });
    }

    // Job might already be completed/stopped or running in another runtime instance.
    return res.status(409).json({
      error: "Session is not stoppable from this instance (already finished or not running here).",
      status: session.status,
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Stop failed" });
  }
});

router.get("/api/agent/sessions/:id", async (req, res) => {
  try {
    requireAgentSecret(req);
    const id = req.params.id;

    const [session] = await db
      .select({
        id: agentSessions.id,
        status: agentSessions.status,
        startedAt: agentSessions.startedAt,
        completedAt: agentSessions.completedAt,
        issuesFlagged: agentSessions.issuesFlagged,
        config: agentSessions.config,
        stats: agentSessions.stats,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .limit(1);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const [totalRow] = await db
      .select({ c: count() })
      .from(agentDecisions)
      .where(eq(agentDecisions.sessionId, id));
    const [pendingRow] = await db
      .select({ c: count() })
      .from(agentDecisions)
      .where(and(eq(agentDecisions.sessionId, id), eq(agentDecisions.status, "pending")));

    const recentDecisions = await db
      .select({
        id: agentDecisions.id,
        type: agentDecisions.type,
        module: agentDecisions.module,
        status: agentDecisions.status,
        reasoning: agentDecisions.reasoning,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .where(eq(agentDecisions.sessionId, id))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(10);

    res.json({
      session,
      live: {
        isRunningInThisRuntime: isWikiOverseerPassRunning(id),
        totalDecisions: Number(totalRow?.c ?? 0),
        pendingDecisions: Number(pendingRow?.c ?? 0),
      },
      recentDecisions,
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to load session" });
  }
});

router.get("/api/agent/sessions/recent", async (req, res) => {
  try {
    requireAgentSecret(req);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const rows = await db
      .select({
        id: agentSessions.id,
        status: agentSessions.status,
        startedAt: agentSessions.startedAt,
        completedAt: agentSessions.completedAt,
        issuesFlagged: agentSessions.issuesFlagged,
        config: agentSessions.config,
        stats: agentSessions.stats,
      })
      .from(agentSessions)
      .orderBy(desc(agentSessions.startedAt))
      .limit(limit);
    res.json({ sessions: rows });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Failed to list sessions" });
  }
});

export default router;

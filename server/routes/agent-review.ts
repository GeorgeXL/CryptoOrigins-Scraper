import { Router } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db } from "../db";
import { agentDecisions, agentSessions } from "@shared/schema";
import { requireAgentSecret } from "../services/agents-sdk/auth";
import { runWikiOverseerPass } from "../services/agents-sdk/wiki-overseer-run";
import { applyApprovedProposal } from "../services/agents-sdk/apply-approved-proposal";
import type { ProposalAfterState } from "../services/agents-sdk/apply-approved-proposal";

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

    const out = await runWikiOverseerPass({
      dateFrom,
      dateTo,
      maxDaysToConsider: Number(maxDaysToConsider) || 7,
      maxProposals: Number(maxProposals) || 15,
    });

    res.json(out);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Overseer run failed" });
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

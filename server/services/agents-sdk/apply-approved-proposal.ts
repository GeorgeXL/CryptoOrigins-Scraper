import { eq } from "drizzle-orm";
import { db } from "../../db";
import { agentAuditLog, historicalNewsAnalyses } from "@shared/schema";
import { newsAnalyzer } from "../news-analyzer";

export type ProposalAfterState = {
  action?: string;
  analysisId?: string;
  date?: string;
  flagReason?: string;
};

export async function applyApprovedProposal(input: {
  sessionId: string;
  passNumber: number;
  module: string;
  decisionId: string;
  afterState: ProposalAfterState | null;
  approvedBy: string;
}): Promise<{ ok: boolean; message: string }> {
  const action = input.afterState?.action;
  if (!action || action === "none" || action === "manual_review_tag" || action === "manual_review_topic") {
    return { ok: true, message: "Recorded approval; no automatic mutation for this action type." };
  }

  if (action === "flag_analysis") {
    const analysisId = input.afterState?.analysisId;
    const reason = input.afterState?.flagReason || "Flagged via Wiki Overseer (approved)";
    if (!analysisId) return { ok: false, message: "Missing analysisId for flag_analysis" };
    await db
      .update(historicalNewsAnalyses)
      .set({
        isFlagged: true,
        flagReason: reason,
        flaggedAt: new Date(),
      })
      .where(eq(historicalNewsAnalyses.id, analysisId));

    await db.insert(agentAuditLog).values({
      sessionId: input.sessionId,
      passNumber: input.passNumber,
      module: input.module,
      action: "update",
      targetType: "news",
      targetId: analysisId,
      afterValue: { is_flagged: true, flag_reason: reason },
      reasoning: "Applied approved flag_analysis",
      approvedBy: input.approvedBy,
    });
    return { ok: true, message: "Analysis flagged in database." };
  }

  if (action === "reanalyze_date") {
    const date = input.afterState?.date;
    if (!date) return { ok: false, message: "Missing date for reanalyze_date" };
    try {
      await newsAnalyzer.analyzeNewsForDate({
        date,
        forceReanalysis: true,
        requestContext: {
          requestId: `wiki-overseer-${input.decisionId}`,
          source: "WIKI_OVERSEER_APPROVE",
        },
      });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Re-analysis failed" };
    }
    await db.insert(agentAuditLog).values({
      sessionId: input.sessionId,
      passNumber: input.passNumber,
      module: input.module,
      action: "update",
      targetType: "news",
      targetId: date,
      afterValue: { reanalyzed: true },
      reasoning: "Triggered newsAnalyzer.analyzeNewsForDate after approval",
      approvedBy: input.approvedBy,
    });
    return { ok: true, message: `Re-analysis completed for ${date}.` };
  }

  return { ok: false, message: `Unknown action: ${action}` };
}

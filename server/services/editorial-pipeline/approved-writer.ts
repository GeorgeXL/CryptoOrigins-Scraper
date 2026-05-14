import { eq } from "drizzle-orm";
import { db } from "../../db";
import { humanReviewQueue } from "@shared/schema";
import { runExistingSearchAndSummaryForDate } from "./tools";

type ApprovedAction =
  | { kind: "reanalyze_date"; date: string }
  | { kind: "manual_apply"; date: string };

export function determineApprovedAction(payload: unknown): { ok: boolean; action?: ApprovedAction; message?: string } {
  const triage = (payload as any)?.triage;
  if (!triage?.date) return { ok: false, message: "Missing triage payload date" };
  if (triage.route === "missing_day" || triage.route === "empty_day") {
    return { ok: true, action: { kind: "reanalyze_date", date: triage.date } };
  }
  return { ok: true, action: { kind: "manual_apply", date: triage.date } };
}

export async function executeApprovedReviewItem(reviewItemId: string): Promise<{ ok: boolean; message: string }> {
  const [item] = await db.select().from(humanReviewQueue).where(eq(humanReviewQueue.id, reviewItemId)).limit(1);
  if (!item) return { ok: false, message: "Review item not found" };
  if (item.status !== "approved") return { ok: false, message: "Review item must be approved first" };

  const decision = determineApprovedAction(item.package);
  if (!decision.ok || !decision.action) return { ok: false, message: decision.message || "Invalid review package" };

  if (decision.action.kind === "reanalyze_date") {
    const out = await runExistingSearchAndSummaryForDate(decision.action.date);
    return {
      ok: true,
      message: `Applied existing search/summarization pipeline to ${decision.action.date} (articles=${out.totalArticlesFetched})`,
    };
  }

  return {
    ok: true,
    message: `Approved correction package for ${decision.action.date}; manual/domain-specific apply path remains active`,
  };
}

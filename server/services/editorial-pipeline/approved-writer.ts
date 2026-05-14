import { eq } from "drizzle-orm";
import { db } from "../../db";
import { humanReviewQueue } from "@shared/schema";
import { runExistingSearchAndSummaryForDate } from "./tools";

export async function executeApprovedReviewItem(reviewItemId: string): Promise<{ ok: boolean; message: string }> {
  const [item] = await db.select().from(humanReviewQueue).where(eq(humanReviewQueue.id, reviewItemId)).limit(1);
  if (!item) return { ok: false, message: "Review item not found" };
  if (item.status !== "approved") return { ok: false, message: "Review item must be approved first" };

  const payload = item.package as any;
  const triage = payload?.triage;
  if (!triage?.date) return { ok: false, message: "Missing triage payload date" };

  if (triage.route === "missing_day" || triage.route === "empty_day") {
    const out = await runExistingSearchAndSummaryForDate(triage.date);
    return {
      ok: true,
      message: `Applied existing search/summarization pipeline to ${triage.date} (articles=${out.totalArticlesFetched})`,
    };
  }

  return {
    ok: true,
    message: `Approved correction package for ${triage.date}; manual/domain-specific apply path remains active`,
  };
}

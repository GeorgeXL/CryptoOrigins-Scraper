import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db";
import { canonicalMilestones, historicalNewsAnalyses } from "@shared/schema";

export type MilestoneGap = {
  milestoneId: string;
  slug: string;
  label: string;
  expectedDate: string;
  priority: string;
  issue: "missing_day" | "flagged_day";
};

export async function detectMilestoneGapsInWindow(dateFrom: string, dateTo: string): Promise<MilestoneGap[]> {
  const milestones = await db
    .select()
    .from(canonicalMilestones)
    .where(and(gte(canonicalMilestones.expectedDate, dateFrom), lte(canonicalMilestones.expectedDate, dateTo)));

  const out: MilestoneGap[] = [];
  for (const ms of milestones) {
    const [day] = await db
      .select({
        id: historicalNewsAnalyses.id,
        isFlagged: historicalNewsAnalyses.isFlagged,
      })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, ms.expectedDate))
      .limit(1);

    if (!day) {
      out.push({
        milestoneId: ms.id,
        slug: ms.slug,
        label: ms.label,
        expectedDate: ms.expectedDate,
        priority: ms.priority,
        issue: "missing_day",
      });
      continue;
    }

    if (day.isFlagged) {
      out.push({
        milestoneId: ms.id,
        slug: ms.slug,
        label: ms.label,
        expectedDate: ms.expectedDate,
        priority: ms.priority,
        issue: "flagged_day",
      });
    }
  }

  return out;
}

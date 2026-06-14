import { eq } from "drizzle-orm";

import { historicalNewsAnalyses } from "@shared/schema";
import {
  analysisHasStorylineTopic,
  storylineTopicBlockReason,
  type GoogleCheckHappened,
} from "@shared/storyline-topic-eligibility";
import { db } from "../db";
import { syncStorylineAssignmentsForDate } from "./editorial-pipeline/storyline-taxonomy";

export type UnverifiedDayNormalizationResult = {
  date: string;
  googleCheckHappened: GoogleCheckHappened;
  clearedTopic: boolean;
  unlocked: boolean;
  reason: string | null;
};

/** Google Check no/uncertain days must stay unlocked and without storyline topics. */
export async function normalizeUnverifiedAnalysisDay(
  date: string,
  googleCheckHappened: GoogleCheckHappened,
): Promise<UnverifiedDayNormalizationResult> {
  const reason = storylineTopicBlockReason(googleCheckHappened);
  if (!reason) {
    return {
      date,
      googleCheckHappened,
      clearedTopic: false,
      unlocked: false,
      reason: null,
    };
  }

  const [row] = await db
    .select({
      topicCategories: historicalNewsAnalyses.topicCategories,
      isLocked: historicalNewsAnalyses.isLocked,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);

  const hadTopic = analysisHasStorylineTopic(row?.topicCategories);
  const wasLocked = Boolean(row?.isLocked);

  if (hadTopic || wasLocked) {
    await syncStorylineAssignmentsForDate(date, []);
    await db
      .update(historicalNewsAnalyses)
      .set({ topicCategories: [], isLocked: false })
      .where(eq(historicalNewsAnalyses.date, date));
  }

  return {
    date,
    googleCheckHappened,
    clearedTopic: hadTopic,
    unlocked: wasLocked,
    reason,
  };
}

/** Unlock a day that has no storyline topic but is still locked. */
export async function unlockAnalysisDayWithoutTopic(date: string): Promise<boolean> {
  const [row] = await db
    .select({
      topicCategories: historicalNewsAnalyses.topicCategories,
      isLocked: historicalNewsAnalyses.isLocked,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);

  if (!row?.isLocked || analysisHasStorylineTopic(row.topicCategories)) {
    return false;
  }

  await db
    .update(historicalNewsAnalyses)
    .set({ isLocked: false })
    .where(eq(historicalNewsAnalyses.date, date));

  return true;
}

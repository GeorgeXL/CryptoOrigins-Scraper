import { eq } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { analysisEligibleForDayLock } from "@shared/storyline-topic-eligibility";
import { storage } from "../storage";

export class DayLockedError extends Error {
  constructor(date: string) {
    super(`Day ${date} is locked by operator`);
    this.name = "DayLockedError";
  }
}

export async function isDayLocked(date: string): Promise<boolean> {
  const [row] = await db
    .select({ isLocked: historicalNewsAnalyses.isLocked })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, date))
    .limit(1);
  return Boolean(row?.isLocked);
}

export async function assertDayNotLocked(date: string): Promise<void> {
  if (await isDayLocked(date)) {
    throw new DayLockedError(date);
  }
}

export async function setDayLocked(date: string, locked: boolean) {
  const existing = await storage.getAnalysisByDate(date);
  if (!existing) {
    throw new Error(`Analysis not found for date: ${date}`);
  }
  if (locked && !analysisEligibleForDayLock(existing.topicCategories)) {
    if (!existing.isLocked) return existing;
    return storage.updateAnalysis(date, { isLocked: false });
  }
  return storage.updateAnalysis(date, { isLocked: locked });
}

/** Lock when a review decision is final; skip silently if the day row does not exist yet. */
export async function tryLockDay(date: string): Promise<{ locked: boolean; skipped: boolean }> {
  const existing = await storage.getAnalysisByDate(date);
  if (!existing) {
    return { locked: false, skipped: true };
  }
  if (existing.isLocked) {
    return { locked: false, skipped: false };
  }
  if (!analysisEligibleForDayLock(existing.topicCategories)) {
    return { locked: false, skipped: false };
  }
  await storage.updateAnalysis(date, { isLocked: true });
  return { locked: true, skipped: false };
}

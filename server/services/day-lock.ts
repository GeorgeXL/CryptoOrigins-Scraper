import { eq } from "drizzle-orm";
import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
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
  return storage.updateAnalysis(date, { isLocked: locked });
}

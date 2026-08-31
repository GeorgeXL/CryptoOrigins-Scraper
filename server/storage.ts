import { 
  historicalNewsAnalyses,
  manualNewsEntries,
  type HistoricalNewsAnalysis,
  type InsertHistoricalNewsAnalysis,
  type ManualNewsEntry,
  type InsertManualNewsEntry,
} from "@shared/schema";
import { syncStorylineAssignmentsForDate } from "./services/editorial-pipeline/storyline-taxonomy";
import {
  analysisEligibleForDayLock,
  analysisHasStorylineTopic,
  analysisMatchesStorylineLeaf,
} from "@shared/storyline-topic-eligibility";
import { resolveStorylineLeafLabel } from "@shared/topic-hierarchy-migration";
import { db } from "./db";
import { eq, desc, asc, and, gte, lte, count, sql, inArray } from "drizzle-orm";


export interface IStorage {
  // Historical news analysis methods
  getAnalysisByDate(date: string): Promise<HistoricalNewsAnalysis | undefined>;
  getAnalysesByDateRange(startDate: string, endDate: string): Promise<HistoricalNewsAnalysis[]>;
  getAnalysesByDates(dates: string[]): Promise<HistoricalNewsAnalysis[]>;
  getAnalysesForStorylineLeaf(leafName: string): Promise<HistoricalNewsAnalysis[]>;
  createAnalysis(analysis: InsertHistoricalNewsAnalysis): Promise<HistoricalNewsAnalysis>;
  updateAnalysis(date: string, analysis: Partial<InsertHistoricalNewsAnalysis>): Promise<HistoricalNewsAnalysis>;
  deleteAnalysis(date: string): Promise<void>;
  updateAnalysisFlag(date: string, isFlagged: boolean): Promise<HistoricalNewsAnalysis>;
  getFlaggedAnalyses(): Promise<HistoricalNewsAnalysis[]>;
  getAnalysis(date: string): Promise<HistoricalNewsAnalysis | undefined>;
  getAllAnalyses(): Promise<HistoricalNewsAnalysis[]>;
  getAnalysisStats(): Promise<{totalDays: number, analyzedDays: number, completionPercentage: number, manualEntries: number}>;
  getYearProgress(year: number): Promise<{totalDays: number, analyzedDays: number, percentage: number}>;
  
  // Manual news entry methods
  getManualEntriesByDate(date: string): Promise<ManualNewsEntry[]>;
  getAllManualEntries(): Promise<ManualNewsEntry[]>;
  createManualEntry(entry: InsertManualNewsEntry): Promise<ManualNewsEntry>;
  updateManualEntry(id: string, entry: Partial<InsertManualNewsEntry>): Promise<ManualNewsEntry>;
  deleteManualEntry(id: string): Promise<void>;
  updateManualEntryFlag(id: string, isFlagged: boolean, flagReason?: string): Promise<ManualNewsEntry>;
  
  // Database management methods
  clearAllData(): Promise<void>;
  clearAnalysisData(): Promise<void>;
  clearManualEntries(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Historical news analysis methods
  async getAnalysisByDate(date: string): Promise<HistoricalNewsAnalysis | undefined> {
    const [analysis] = await db
      .select()
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, date));
    
    return analysis || undefined;
  }

  async getAnalysis(date: string): Promise<HistoricalNewsAnalysis | undefined> {
    return this.getAnalysisByDate(date);
  }

  async getAllAnalyses(): Promise<HistoricalNewsAnalysis[]> {
    return await db
      .select()
      .from(historicalNewsAnalyses)
      .orderBy(desc(historicalNewsAnalyses.date));
  }

  async getFlaggedAnalyses(): Promise<HistoricalNewsAnalysis[]> {
    const flagged = await db.select()
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.isFlagged, true))
      .orderBy(desc(historicalNewsAnalyses.flaggedAt));
    return flagged;
  }

  async getAnalysesByDateRange(startDate: string, endDate: string): Promise<HistoricalNewsAnalysis[]> {
    return await db
      .select()
      .from(historicalNewsAnalyses)
      .where(
        and(
          gte(historicalNewsAnalyses.date, startDate),
          lte(historicalNewsAnalyses.date, endDate)
        )
      )
      .orderBy(asc(historicalNewsAnalyses.date));
  }

  async getAnalysesByDates(dates: string[]): Promise<HistoricalNewsAnalysis[]> {
    if (dates.length === 0) return [];
    
    return await db
      .select()
      .from(historicalNewsAnalyses)
      .where(inArray(historicalNewsAnalyses.date, dates))
      .orderBy(asc(historicalNewsAnalyses.date));
  }

  async getAnalysesForStorylineLeaf(leafName: string): Promise<HistoricalNewsAnalysis[]> {
    if (!leafName.trim()) return [];

    const rows = await db
      .select()
      .from(historicalNewsAnalyses)
      .orderBy(asc(historicalNewsAnalyses.date));

    return rows.filter((row) =>
      analysisMatchesStorylineLeaf(row.topicCategories, leafName, resolveStorylineLeafLabel),
    );
  }

  async createAnalysis(analysis: InsertHistoricalNewsAnalysis): Promise<HistoricalNewsAnalysis> {
    const [newAnalysis] = await db
      .insert(historicalNewsAnalyses)
      .values(analysis)
      .returning();
    
    return newAnalysis;
  }

  async updateAnalysis(
    date: string,
    analysis: Partial<InsertHistoricalNewsAnalysis> & { flaggedAt?: Date | null },
  ): Promise<HistoricalNewsAnalysis> {
    const existing = await this.getAnalysisByDate(date);

    // Simple update - only update fields that are provided
    const updateData: Record<string, any> = {
      lastAnalyzed: new Date(),
    };

    // Only add fields that exist in the database and are provided
    if (analysis.summary !== undefined) updateData.summary = analysis.summary;
    if (analysis.reasoning !== undefined) updateData.reasoning = analysis.reasoning;
    if (analysis.topArticleId !== undefined) updateData.topArticleId = analysis.topArticleId;
    if (analysis.isManualOverride !== undefined) updateData.isManualOverride = analysis.isManualOverride;
    if (analysis.isLocked !== undefined) updateData.isLocked = analysis.isLocked;
    if (analysis.tierUsed !== undefined) updateData.tierUsed = analysis.tierUsed;
    if (analysis.winningTier !== undefined) updateData.winningTier = analysis.winningTier;
    if (analysis.tieredArticles !== undefined) updateData.tieredArticles = analysis.tieredArticles;
    if (analysis.analyzedArticles !== undefined) updateData.analyzedArticles = analysis.analyzedArticles;
    if (analysis.topicCategories !== undefined) updateData.topicCategories = analysis.topicCategories;
    // Handle tags_version2 (can come as tags_version2 or tagsVersion2)
    if (analysis.tagsVersion2 !== undefined) updateData.tagsVersion2 = analysis.tagsVersion2;
    if ((analysis as any).tags_version2 !== undefined) updateData.tagsVersion2 = (analysis as any).tags_version2;
    if ((analysis as any).suppressedTagSuggestions !== undefined) {
      updateData.suppressedTagSuggestions = (analysis as any).suppressedTagSuggestions;
    }
    if (analysis.googleCheckHappened !== undefined) updateData.googleCheckHappened = analysis.googleCheckHappened;
    if (analysis.googleCheckCheckedAt !== undefined) updateData.googleCheckCheckedAt = analysis.googleCheckCheckedAt;
    if (analysis.isFlagged !== undefined) {
      updateData.isFlagged = analysis.isFlagged;
      if (analysis.flaggedAt !== undefined) {
        updateData.flaggedAt = analysis.flaggedAt;
      } else if (analysis.isFlagged === false) {
        updateData.flaggedAt = null;
      }
    } else if (analysis.flaggedAt !== undefined) {
      updateData.flaggedAt = analysis.flaggedAt;
    }
    if (analysis.rarity !== undefined) updateData.rarity = analysis.rarity;
    if (analysis.articleTags !== undefined) updateData.articleTags = analysis.articleTags;

    const nextTopics =
      analysis.topicCategories !== undefined ? analysis.topicCategories : existing?.topicCategories;
    if (analysis.topicCategories !== undefined && !analysisHasStorylineTopic(analysis.topicCategories)) {
      updateData.isLocked = false;
    }
    if (analysis.isLocked === true && !analysisEligibleForDayLock(nextTopics)) {
      updateData.isLocked = false;
    }

    const [updatedAnalysis] = await db
      .update(historicalNewsAnalyses)
      .set(updateData)
      .where(eq(historicalNewsAnalyses.date, date))
      .returning();
    
    return updatedAnalysis;
  }

  async deleteAnalysis(date: string): Promise<void> {
    await db
      .delete(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, date));
  }

  async updateAnalysisFlag(date: string, isFlagged: boolean): Promise<HistoricalNewsAnalysis> {
    const [updatedAnalysis] = await db
      .update(historicalNewsAnalyses)
      .set({ 
        isFlagged, 
        flaggedAt: isFlagged ? new Date() : null 
      })
      .where(eq(historicalNewsAnalyses.date, date))
      .returning();
    return updatedAnalysis;
  }

  async updateAnalysisGoogleCheck(
    date: string,
    data: {
      googleCheckHappened: "yes" | "no" | "uncertain";
      googleCheckCheckedAt: Date;
    },
  ): Promise<HistoricalNewsAnalysis> {
    const existing = await this.getAnalysisByDate(date);
    const patch: Record<string, unknown> = { ...data };

    if (data.googleCheckHappened === "yes") {
      if (analysisEligibleForDayLock(existing?.topicCategories)) {
        patch.isLocked = true;
      } else {
        patch.isLocked = false;
      }
    } else {
      patch.isLocked = false;
      patch.topicCategories = [];
    }

    const [updatedAnalysis] = await db
      .update(historicalNewsAnalyses)
      .set(patch)
      .where(eq(historicalNewsAnalyses.date, date))
      .returning();

    if (data.googleCheckHappened !== "yes") {
      await syncStorylineAssignmentsForDate(date, []);
    }

    return updatedAnalysis;
  }

  async getAnalysisStats(): Promise<{totalDays: number, analyzedDays: number, completionPercentage: number, manualEntries: number}> {
    const startDate = '2008-01-01';
    const currentDate = new Date().toISOString().split('T')[0];
    
    const totalDays = Math.floor((new Date(currentDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
    
    const [analysisResult] = await db
      .select({ count: count() })
      .from(historicalNewsAnalyses);
      
    const [manualResult] = await db
      .select({ count: count() })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.isManualOverride, true));
      
    const analyzedDays = analysisResult.count;
    const manualEntries = manualResult.count;
    const completionPercentage = Math.round((analyzedDays / totalDays) * 100);
    
    return { totalDays, analyzedDays, completionPercentage, manualEntries };
  }

  async getYearProgress(year: number): Promise<{totalDays: number, analyzedDays: number, percentage: number}> {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const totalDays = isLeapYear ? 366 : 365;
    
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    
    const [result] = await db
      .select({ count: count() })
      .from(historicalNewsAnalyses)
      .where(
        and(
          gte(historicalNewsAnalyses.date, startDate),
          lte(historicalNewsAnalyses.date, endDate)
        )
      );
      
    const analyzedDays = result.count;
    const percentage = Math.round((analyzedDays / totalDays) * 100);
    
    return { totalDays, analyzedDays, percentage };
  }

  // Manual news entry methods
  async getManualEntriesByDate(date: string): Promise<ManualNewsEntry[]> {
    return await db
      .select()
      .from(manualNewsEntries)
      .where(eq(manualNewsEntries.date, date))
      .orderBy(desc(manualNewsEntries.createdAt));
  }

  async getAllManualEntries(): Promise<ManualNewsEntry[]> {
    return await db
      .select()
      .from(manualNewsEntries)
      .orderBy(desc(manualNewsEntries.date));
  }

  async createManualEntry(entry: InsertManualNewsEntry): Promise<ManualNewsEntry> {
    const [newEntry] = await db
      .insert(manualNewsEntries)
      .values(entry)
      .returning();
    return newEntry;
  }

  async updateManualEntry(id: string, entry: Partial<InsertManualNewsEntry>): Promise<ManualNewsEntry> {
    const [updatedEntry] = await db
      .update(manualNewsEntries)
      .set({ ...entry, updatedAt: new Date() })
      .where(eq(manualNewsEntries.id, id))
      .returning();
    return updatedEntry;
  }

  async deleteManualEntry(id: string): Promise<void> {
    await db
      .delete(manualNewsEntries)
      .where(eq(manualNewsEntries.id, id));
  }

  async updateManualEntryFlag(id: string, isFlagged: boolean, flagReason?: string): Promise<ManualNewsEntry> {
    const [updatedEntry] = await db
      .update(manualNewsEntries)
      .set({ 
        isFlagged, 
        flagReason: isFlagged ? flagReason : null,
        flaggedAt: isFlagged ? new Date() : null,
        updatedAt: new Date()
      })
      .where(eq(manualNewsEntries.id, id))
      .returning();
    return updatedEntry;
  }

  // Database management methods
  async clearAllData(): Promise<void> {
    await db.delete(manualNewsEntries);
    await db.delete(historicalNewsAnalyses);
  }

  async clearAnalysisData(): Promise<void> {
    await db.delete(historicalNewsAnalyses);
  }

  async clearManualEntries(): Promise<void> {
    await db.delete(manualNewsEntries);
  }

  // ============================================================================
  // Tag helpers — timeline source of truth is tags_version2 on day rows
  // ============================================================================

  /** Tag names assigned to a day (from tags_version2). */
  async getTagNamesForAnalysis(analysisId: string): Promise<string[]> {
    const [analysis] = await db
      .select({ tagsVersion2: historicalNewsAnalyses.tagsVersion2 })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.id, analysisId))
      .limit(1);

    if (!analysis?.tagsVersion2 || !Array.isArray(analysis.tagsVersion2)) return [];
    return analysis.tagsVersion2.filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  }

  /** Append a tag name to tags_version2 for a day. */
  async addTagNameToAnalysis(analysisId: string, tagName: string): Promise<void> {
    const trimmed = tagName.trim();
    if (!trimmed) return;

    const [analysis] = await db
      .select({ tagsVersion2: historicalNewsAnalyses.tagsVersion2, date: historicalNewsAnalyses.date })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.id, analysisId))
      .limit(1);
    if (!analysis) throw new Error(`Analysis ${analysisId} not found`);

    const current = Array.isArray(analysis.tagsVersion2) ? analysis.tagsVersion2 : [];
    if (current.includes(trimmed)) return;

    await this.updateAnalysis(analysis.date, { tagsVersion2: [...current, trimmed] });
  }

  /** Remove a tag name from tags_version2 for a day. */
  async removeTagNameFromAnalysis(analysisId: string, tagName: string): Promise<void> {
    const [analysis] = await db
      .select({ tagsVersion2: historicalNewsAnalyses.tagsVersion2, date: historicalNewsAnalyses.date })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.id, analysisId))
      .limit(1);
    if (!analysis) return;

    const current = Array.isArray(analysis.tagsVersion2) ? analysis.tagsVersion2 : [];
    const next = current.filter((name) => name !== tagName);
    if (next.length === current.length) return;

    await this.updateAnalysis(analysis.date, { tagsVersion2: next });
  }

  /** Replace a tag string across all day rows. Returns number of rows updated. */
  async renameTagInAllAnalyses(oldName: string, newName: string): Promise<number> {
    if (!oldName || !newName || oldName === newName) return 0;

    const result = await db.execute(sql`
      UPDATE historical_news_analyses
      SET tags_version2 = (
        SELECT COALESCE(array_agg(DISTINCT CASE WHEN t = ${oldName} THEN ${newName} ELSE t END), '{}')
        FROM unnest(tags_version2) AS t
      )
      WHERE ${oldName} = ANY(tags_version2)
    `);

    return Number(result.rowCount ?? 0);
  }

  /** Remove a tag string from all day rows. Returns number of rows updated. */
  async removeTagFromAllAnalyses(tagName: string): Promise<number> {
    if (!tagName.trim()) return 0;

    const result = await db.execute(sql`
      UPDATE historical_news_analyses
      SET tags_version2 = array_remove(tags_version2, ${tagName})
      WHERE ${tagName} = ANY(tags_version2)
    `);

    return Number(result.rowCount ?? 0);
  }
}

export const storage = new DatabaseStorage();

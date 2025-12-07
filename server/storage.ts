import { 
  users, 
  historicalNewsAnalyses,
  manualNewsEntries,
  sourceCredibility,
  spamDomains,
  aiPrompts,
  eventBatches,
  batchEvents,
  eventConflicts,
  tagMetadata,
  tags,
  pagesAndTags,
  type User, 
  type InsertUser,
  type HistoricalNewsAnalysis,
  type InsertHistoricalNewsAnalysis,
  type ManualNewsEntry,
  type InsertManualNewsEntry,
  type SourceCredibility,
  type InsertSourceCredibility,
  type SpamDomain,
  type InsertSpamDomain,
  type AiPrompt,
  type InsertAiPrompt,
  type EventBatch,
  type InsertEventBatch,
  type BatchEvent,
  type InsertBatchEvent,
  type EventConflict,
  type InsertEventConflict,
  type TagMetadata,
  type InsertTagMetadata,
  type Tag,
  type InsertTag,
  type PagesAndTags,
  type InsertPagesAndTags,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, and, or, gte, lte, count, sql, inArray } from "drizzle-orm";


export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Historical news analysis methods
  getAnalysisByDate(date: string): Promise<HistoricalNewsAnalysis | undefined>;
  getAnalysesByDateRange(startDate: string, endDate: string): Promise<HistoricalNewsAnalysis[]>;
  getAnalysesByDates(dates: string[]): Promise<HistoricalNewsAnalysis[]>;
  createAnalysis(analysis: InsertHistoricalNewsAnalysis): Promise<HistoricalNewsAnalysis>;
  updateAnalysis(date: string, analysis: Partial<InsertHistoricalNewsAnalysis>): Promise<HistoricalNewsAnalysis>;
  deleteAnalysis(date: string): Promise<void>;
  updateAnalysisFlag(date: string, isFlagged: boolean, flagReason?: string): Promise<HistoricalNewsAnalysis>;
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
  
  // Source credibility methods
  getSourceCredibility(domain: string): Promise<SourceCredibility | undefined>;
  getAllSourceCredibility(): Promise<SourceCredibility[]>;
  createSourceCredibility(source: InsertSourceCredibility): Promise<SourceCredibility>;
  updateSourceCredibility(domain: string, source: Partial<InsertSourceCredibility>): Promise<SourceCredibility>;
  
  // Spam domain methods
  isSpamDomain(domain: string): Promise<boolean>;
  addSpamDomain(domain: string): Promise<SpamDomain>;
  getSpamDomains(): Promise<SpamDomain[]>;
  
  // AI prompt methods
  getActivePrompts(): Promise<AiPrompt[]>;
  getPromptByName(name: string): Promise<AiPrompt | undefined>;
  createPrompt(prompt: InsertAiPrompt): Promise<AiPrompt>;
  updatePrompt(id: string, prompt: Partial<InsertAiPrompt>): Promise<AiPrompt>;
  
  // Database management methods
  clearAllData(): Promise<void>;
  clearAnalysisData(): Promise<void>;
  clearManualEntries(): Promise<void>;
  clearSourceCredibility(): Promise<void>;
  clearSpamDomains(): Promise<void>;
  clearAiPrompts(): Promise<void>;
  clearUserData(): Promise<void>;
  
  // Event batch processing methods
  createEventBatch(batch: InsertEventBatch): Promise<EventBatch>;
  getEventBatch(id: string): Promise<EventBatch | undefined>;
  getAllEventBatches(): Promise<EventBatch[]>;
  updateEventBatch(id: string, updates: Partial<InsertEventBatch>): Promise<EventBatch>;
  deleteEventBatch(id: string): Promise<void>;
  
  // Batch events methods
  createBatchEvent(event: InsertBatchEvent): Promise<BatchEvent>;
  createBatchEvents(events: InsertBatchEvent[]): Promise<BatchEvent[]>;
  getBatchEvent(id: string): Promise<BatchEvent | undefined>;
  getBatchEventsByBatchId(batchId: string): Promise<BatchEvent[]>;
  getBatchEventsByBatchNumber(batchId: string, batchNumber: number): Promise<BatchEvent[]>;
  updateBatchEvent(id: string, updates: Partial<InsertBatchEvent>): Promise<BatchEvent>;
  updateBatchEvents(ids: string[], updates: Partial<InsertBatchEvent>): Promise<BatchEvent[]>;
  deleteBatchEvent(id: string): Promise<void>;
  getBatchEventsForReview(batchId: string, batchNumber: number): Promise<BatchEvent[]>;
  approveBatchEvents(ids: string[]): Promise<BatchEvent[]>;
  rejectBatchEvents(ids: string[]): Promise<BatchEvent[]>;
  
  // Event conflicts methods
  createEventConflict(conflict: InsertEventConflict): Promise<EventConflict>;
  createEventConflicts(conflicts: InsertEventConflict[]): Promise<EventConflict[]>;
  getConflictsBySourceDate(sourceDate: string): Promise<EventConflict[]>;
  getConflictsByYear(year: number): Promise<EventConflict[]>;
  getAllConflicts(): Promise<EventConflict[]>;
  updateConflict(id: number, updates: Partial<InsertEventConflict>): Promise<EventConflict>;
  deleteConflict(id: number): Promise<void>;
  deleteConflictsBySourceDate(sourceDate: string): Promise<void>;
  clearConflictsByYear(year: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

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

  async createAnalysis(analysis: InsertHistoricalNewsAnalysis): Promise<HistoricalNewsAnalysis> {
    const [newAnalysis] = await db
      .insert(historicalNewsAnalyses)
      .values(analysis)
      .returning();
    
    return newAnalysis;
  }

  async updateAnalysis(date: string, analysis: Partial<InsertHistoricalNewsAnalysis>): Promise<HistoricalNewsAnalysis> {
    // Simple update - only update fields that are provided
    const updateData: Record<string, any> = {
      lastAnalyzed: new Date(),
    };

    // Only add fields that exist in the database and are provided
    if (analysis.summary !== undefined) updateData.summary = analysis.summary;
    if (analysis.reasoning !== undefined) updateData.reasoning = analysis.reasoning;
    if (analysis.topArticleId !== undefined) updateData.topArticleId = analysis.topArticleId;
    if (analysis.isManualOverride !== undefined) updateData.isManualOverride = analysis.isManualOverride;
    if (analysis.isOrphan !== undefined) updateData.isOrphan = analysis.isOrphan;
    if (analysis.tierUsed !== undefined) updateData.tierUsed = analysis.tierUsed;
    if (analysis.winningTier !== undefined) updateData.winningTier = analysis.winningTier;
    if (analysis.tieredArticles !== undefined) updateData.tieredArticles = analysis.tieredArticles;
    if (analysis.analyzedArticles !== undefined) updateData.analyzedArticles = analysis.analyzedArticles;
    if (analysis.totalArticlesFetched !== undefined) updateData.totalArticlesFetched = analysis.totalArticlesFetched;
    if (analysis.uniqueArticlesAnalyzed !== undefined) updateData.uniqueArticlesAnalyzed = analysis.uniqueArticlesAnalyzed;
    if (analysis.aiProvider !== undefined) updateData.aiProvider = analysis.aiProvider;
    if (analysis.confidenceScore !== undefined) updateData.confidenceScore = analysis.confidenceScore;
    if (analysis.sentimentScore !== undefined) updateData.sentimentScore = analysis.sentimentScore;
    if (analysis.sentimentLabel !== undefined) updateData.sentimentLabel = analysis.sentimentLabel;
    if (analysis.topicCategories !== undefined) updateData.topicCategories = analysis.topicCategories;
    if (analysis.duplicateArticleIds !== undefined) updateData.duplicateArticleIds = analysis.duplicateArticleIds;
    // Handle tags_version2 (can come as tags_version2 or tagsVersion2)
    if (analysis.tagsVersion2 !== undefined) updateData.tagsVersion2 = analysis.tagsVersion2;
    if ((analysis as any).tags_version2 !== undefined) updateData.tagsVersion2 = (analysis as any).tags_version2;
    // Handle verification fields - these trigger the veri_badge calculation
    if (analysis.geminiApproved !== undefined) updateData.geminiApproved = analysis.geminiApproved;
    if (analysis.perplexityApproved !== undefined) updateData.perplexityApproved = analysis.perplexityApproved;
    if (analysis.perplexityVerdict !== undefined) updateData.perplexityVerdict = analysis.perplexityVerdict;
    if (analysis.factCheckVerdict !== undefined) updateData.factCheckVerdict = analysis.factCheckVerdict;

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

  async updateAnalysisFlag(date: string, isFlagged: boolean, flagReason?: string): Promise<HistoricalNewsAnalysis> {
    const [updatedAnalysis] = await db
      .update(historicalNewsAnalyses)
      .set({ 
        isFlagged, 
        flagReason: isFlagged ? flagReason : null,
        flaggedAt: isFlagged ? new Date() : null 
      })
      .where(eq(historicalNewsAnalyses.date, date))
      .returning();
    return updatedAnalysis;
  }

  async updateAnalysisPerplexityFactCheck(
    date: string, 
    data: {
      perplexityVerdict: string;
      perplexityConfidence: string;
      perplexityReasoning: string;
      perplexityCorrectDate: string | null;
      perplexityCorrectDateText?: string | null; // NEW: Handles complex date strings
      perplexityCitations: string[];
      perplexityCheckedAt: Date;
    }
  ): Promise<HistoricalNewsAnalysis> {
    const [updatedAnalysis] = await db
      .update(historicalNewsAnalyses)
      .set(data)
      .where(eq(historicalNewsAnalyses.date, date))
      .returning();
    return updatedAnalysis;
  }

  async updateAnalysisReVerification(
    date: string,
    data: {
      reVerified: boolean;
      reVerifiedAt: Date;
      reVerificationDate: string;
      reVerificationSummary: string;
      reVerificationTier: string;
      reVerificationArticles: any; // TieredArticles object
      reVerificationReasoning: string;
      reVerificationStatus?: string; // 'success' or 'problem'
      reVerificationWinner?: string; // 'original' or 'corrected'
    }
  ): Promise<HistoricalNewsAnalysis> {
    const [updatedAnalysis] = await db
      .update(historicalNewsAnalyses)
      .set(data)
      .where(eq(historicalNewsAnalyses.date, date))
      .returning();
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

  // Source credibility methods
  async getSourceCredibility(domain: string): Promise<SourceCredibility | undefined> {
    const [source] = await db
      .select()
      .from(sourceCredibility)
      .where(eq(sourceCredibility.domain, domain));
    return source || undefined;
  }

  async getAllSourceCredibility(): Promise<SourceCredibility[]> {
    return await db
      .select()
      .from(sourceCredibility)
      .orderBy(desc(sourceCredibility.credibilityScore));
  }

  async createSourceCredibility(source: InsertSourceCredibility): Promise<SourceCredibility> {
    const [newSource] = await db
      .insert(sourceCredibility)
      .values(source)
      .returning();
    return newSource;
  }

  async updateSourceCredibility(domain: string, source: Partial<InsertSourceCredibility>): Promise<SourceCredibility> {
    const [updatedSource] = await db
      .update(sourceCredibility)
      .set(source)
      .where(eq(sourceCredibility.domain, domain))
      .returning();
    return updatedSource;
  }

  // Spam domain methods
  async isSpamDomain(domain: string): Promise<boolean> {
    const [spam] = await db
      .select()
      .from(spamDomains)
      .where(eq(spamDomains.domain, domain));
    return !!spam;
  }

  async addSpamDomain(domain: string): Promise<SpamDomain> {
    const [newSpam] = await db
      .insert(spamDomains)
      .values({ domain })
      .returning();
    return newSpam;
  }

  async getSpamDomains(): Promise<SpamDomain[]> {
    return await db
      .select()
      .from(spamDomains)
      .orderBy(asc(spamDomains.domain));
  }

  // AI prompt methods
  async getActivePrompts(): Promise<AiPrompt[]> {
    return await db
      .select()
      .from(aiPrompts)
      .where(eq(aiPrompts.isActive, true))
      .orderBy(asc(aiPrompts.name));
  }

  async getPromptByName(name: string): Promise<AiPrompt | undefined> {
    const [prompt] = await db
      .select()
      .from(aiPrompts)
      .where(eq(aiPrompts.name, name));
    return prompt || undefined;
  }

  async createPrompt(prompt: InsertAiPrompt): Promise<AiPrompt> {
    const [newPrompt] = await db
      .insert(aiPrompts)
      .values(prompt)
      .returning();
    return newPrompt;
  }

  async updatePrompt(id: string, prompt: Partial<InsertAiPrompt>): Promise<AiPrompt> {
    const [updatedPrompt] = await db
      .update(aiPrompts)
      .set(prompt)
      .where(eq(aiPrompts.id, id))
      .returning();
    return updatedPrompt;
  }

  // Database management methods
  async clearAllData(): Promise<void> {
    // Delete data from all tables in the correct order to respect foreign key constraints
    await db.delete(manualNewsEntries);
    await db.delete(historicalNewsAnalyses);
    await db.delete(sourceCredibility);
    await db.delete(spamDomains);
    await db.delete(aiPrompts);
    await db.delete(users);
  }

  async clearAnalysisData(): Promise<void> {
    await db.delete(historicalNewsAnalyses);
  }

  async clearManualEntries(): Promise<void> {
    await db.delete(manualNewsEntries);
  }

  async clearSourceCredibility(): Promise<void> {
    await db.delete(sourceCredibility);
  }

  async clearSpamDomains(): Promise<void> {
    await db.delete(spamDomains);
  }

  async clearAiPrompts(): Promise<void> {
    await db.delete(aiPrompts);
  }

  async clearUserData(): Promise<void> {
    await db.delete(users);
  }

  // Event batch processing methods
  async createEventBatch(batch: InsertEventBatch): Promise<EventBatch> {
    const [newBatch] = await db
      .insert(eventBatches)
      .values(batch)
      .returning();
    return newBatch;
  }

  async getEventBatch(id: string): Promise<EventBatch | undefined> {
    const [batch] = await db
      .select()
      .from(eventBatches)
      .where(eq(eventBatches.id, id));
    return batch || undefined;
  }

  async getAllEventBatches(): Promise<EventBatch[]> {
    return await db
      .select()
      .from(eventBatches)
      .orderBy(desc(eventBatches.createdAt));
  }

  async updateEventBatch(id: string, updates: Partial<InsertEventBatch>): Promise<EventBatch> {
    const [updatedBatch] = await db
      .update(eventBatches)
      .set(updates)
      .where(eq(eventBatches.id, id))
      .returning();
    return updatedBatch;
  }

  async deleteEventBatch(id: string): Promise<void> {
    await db.delete(eventBatches).where(eq(eventBatches.id, id));
  }

  // Batch events methods
  async createBatchEvent(event: InsertBatchEvent): Promise<BatchEvent> {
    const [newEvent] = await db
      .insert(batchEvents)
      .values(event)
      .returning();
    return newEvent;
  }

  async createBatchEvents(events: InsertBatchEvent[]): Promise<BatchEvent[]> {
    const newEvents = await db
      .insert(batchEvents)
      .values(events)
      .returning();
    return newEvents;
  }

  async getBatchEvent(id: string): Promise<BatchEvent | undefined> {
    const [event] = await db
      .select()
      .from(batchEvents)
      .where(eq(batchEvents.id, id));
    return event || undefined;
  }

  async getBatchEventsByBatchId(batchId: string): Promise<BatchEvent[]> {
    return await db
      .select()
      .from(batchEvents)
      .where(eq(batchEvents.batchId, batchId))
      .orderBy(asc(batchEvents.batchNumber), asc(batchEvents.originalDate));
  }

  async getBatchEventsByBatchNumber(batchId: string, batchNumber: number): Promise<BatchEvent[]> {
    return await db
      .select()
      .from(batchEvents)
      .where(and(
        eq(batchEvents.batchId, batchId),
        eq(batchEvents.batchNumber, batchNumber)
      ))
      .orderBy(asc(batchEvents.originalDate));
  }

  async updateBatchEvent(id: string, updates: Partial<InsertBatchEvent>): Promise<BatchEvent> {
    const updateData: any = { ...updates };
    if (updates.status === 'enhanced') {
      updateData.processedAt = new Date();
    }
    if (updates.status === 'approved' || updates.status === 'rejected') {
      updateData.reviewedAt = new Date();
    }

    const [updatedEvent] = await db
      .update(batchEvents)
      .set(updateData)
      .where(eq(batchEvents.id, id))
      .returning();
    return updatedEvent;
  }

  async updateBatchEvents(ids: string[], updates: Partial<InsertBatchEvent>): Promise<BatchEvent[]> {
    const updateData: any = { ...updates };
    if (updates.status === 'enhanced') {
      updateData.processedAt = new Date();
    }
    if (updates.status === 'approved' || updates.status === 'rejected') {
      updateData.reviewedAt = new Date();
    }

    const updatedEvents = await db
      .update(batchEvents)
      .set(updateData)
      .where(sql`${batchEvents.id} = ANY(${ids})`)
      .returning();
    return updatedEvents;
  }

  async deleteBatchEvent(id: string): Promise<void> {
    await db.delete(batchEvents).where(eq(batchEvents.id, id));
  }

  async getBatchEventsForReview(batchId: string, batchNumber: number): Promise<BatchEvent[]> {
    return await db
      .select()
      .from(batchEvents)
      .where(and(
        eq(batchEvents.batchId, batchId),
        eq(batchEvents.batchNumber, batchNumber),
        eq(batchEvents.status, 'enhanced')
      ))
      .orderBy(asc(batchEvents.originalDate));
  }

  async approveBatchEvents(ids: string[]): Promise<BatchEvent[]> {
    return this.updateBatchEvents(ids, { status: 'approved' });
  }

  async rejectBatchEvents(ids: string[]): Promise<BatchEvent[]> {
    return this.updateBatchEvents(ids, { status: 'rejected' });
  }

  // Event conflicts methods
  async createEventConflict(conflict: InsertEventConflict): Promise<EventConflict> {
    const [newConflict] = await db
      .insert(eventConflicts)
      .values(conflict)
      .returning();
    return newConflict;
  }

  async createEventConflicts(conflicts: InsertEventConflict[]): Promise<EventConflict[]> {
    if (conflicts.length === 0) return [];
    
    try {
      const newConflicts = await db
        .insert(eventConflicts)
        .values(conflicts)
        .onConflictDoNothing()
        .returning();
      return newConflicts;
    } catch (error) {
      console.error('[storage] Error creating conflicts:', error);
      return [];
    }
  }

  async getConflictsBySourceDate(sourceDate: string): Promise<EventConflict[]> {
    return await db
      .select()
      .from(eventConflicts)
      .where(eq(eventConflicts.sourceDate, sourceDate))
      .orderBy(asc(eventConflicts.relatedDate));
  }

  async getConflictsByYear(year: number): Promise<EventConflict[]> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    // Get conflicts where either sourceDate OR relatedDate is in the year range
    return await db
      .select()
      .from(eventConflicts)
      .where(or(
        and(
          gte(eventConflicts.sourceDate, startDate),
          lte(eventConflicts.sourceDate, endDate)
        ),
        and(
          gte(eventConflicts.relatedDate, startDate),
          lte(eventConflicts.relatedDate, endDate)
        )
      ))
      .orderBy(desc(eventConflicts.sourceDate), asc(eventConflicts.relatedDate));
  }

  async getAllConflicts(): Promise<EventConflict[]> {
    return await db
      .select()
      .from(eventConflicts)
      .orderBy(desc(eventConflicts.sourceDate));
  }

  async updateConflict(id: number, updates: Partial<InsertEventConflict>): Promise<EventConflict> {
    const [updated] = await db
      .update(eventConflicts)
      .set(updates)
      .where(eq(eventConflicts.id, id))
      .returning();
    return updated;
  }

  async deleteConflict(id: number): Promise<void> {
    await db.delete(eventConflicts).where(eq(eventConflicts.id, id));
  }

  async deleteConflictsBySourceDate(sourceDate: string): Promise<void> {
    await db.delete(eventConflicts).where(eq(eventConflicts.sourceDate, sourceDate));
  }

  async clearConflictsByYear(year: number): Promise<void> {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    await db.delete(eventConflicts).where(and(
      gte(eventConflicts.sourceDate, startDate),
      lte(eventConflicts.sourceDate, endDate)
    ));
  }

  // ============================================================================
  // Normalized Tags System Helper Functions
  // ============================================================================

  /**
   * Get all tags for a specific analysis (page) from the join table
   */
  async getTagsForAnalysis(analysisId: string): Promise<Tag[]> {
    const result = await db.select({
      id: tags.id,
      name: tags.name,
      category: tags.category,
      normalizedName: tags.normalizedName,
      parentTagId: tags.parentTagId,
      subcategoryPath: tags.subcategoryPath,
      usageCount: tags.usageCount,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
      .from(tags)
      .innerJoin(pagesAndTags, eq(tags.id, pagesAndTags.tagId))
      .where(eq(pagesAndTags.analysisId, analysisId));
    
    return result;
  }

  /**
   * Add a tag to an analysis (create join table entry)
   */
  async addTagToAnalysis(analysisId: string, tagId: string): Promise<PagesAndTags> {
    const [result] = await db.insert(pagesAndTags).values({
      analysisId,
      tagId,
    })
      .onConflictDoNothing()
      .returning();
    
    if (!result) {
      // Tag already exists, fetch it
      const existing = await db.select()
        .from(pagesAndTags)
        .where(and(
          eq(pagesAndTags.analysisId, analysisId),
          eq(pagesAndTags.tagId, tagId)
        ))
        .limit(1);
      
      if (existing.length > 0) {
        return existing[0];
      }
      throw new Error(`Failed to add tag ${tagId} to analysis ${analysisId}`);
    }
    
    // Update usage count
    await this.updateTagUsageCount(tagId);
    
    return result;
  }

  /**
   * Remove a tag from an analysis (delete join table entry)
   */
  async removeTagFromAnalysis(analysisId: string, tagId: string): Promise<void> {
    await db.delete(pagesAndTags)
      .where(and(
        eq(pagesAndTags.analysisId, analysisId),
        eq(pagesAndTags.tagId, tagId)
      ));
    
    // Update usage count
    await this.updateTagUsageCount(tagId);
  }

  /**
   * Get all analyses (pages) that have a specific tag
   */
  async getAnalysesByTag(tagId: string): Promise<HistoricalNewsAnalysis[]> {
    const result = await db.select({
      id: historicalNewsAnalyses.id,
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      lastAnalyzed: historicalNewsAnalyses.lastAnalyzed,
      isManualOverride: historicalNewsAnalyses.isManualOverride,
      aiProvider: historicalNewsAnalyses.aiProvider,
      reasoning: historicalNewsAnalyses.reasoning,
      articleTags: historicalNewsAnalyses.articleTags,
      confidenceScore: historicalNewsAnalyses.confidenceScore,
      sentimentScore: historicalNewsAnalyses.sentimentScore,
      sentimentLabel: historicalNewsAnalyses.sentimentLabel,
      topicCategories: historicalNewsAnalyses.topicCategories,
      duplicateArticleIds: historicalNewsAnalyses.duplicateArticleIds,
      totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
      uniqueArticlesAnalyzed: historicalNewsAnalyses.uniqueArticlesAnalyzed,
      tierUsed: historicalNewsAnalyses.tierUsed,
      winningTier: historicalNewsAnalyses.winningTier,
      tieredArticles: historicalNewsAnalyses.tieredArticles,
      analyzedArticles: historicalNewsAnalyses.analyzedArticles,
      isFlagged: historicalNewsAnalyses.isFlagged,
      flagReason: historicalNewsAnalyses.flagReason,
      flaggedAt: historicalNewsAnalyses.flaggedAt,
      factCheckVerdict: historicalNewsAnalyses.factCheckVerdict,
      factCheckConfidence: historicalNewsAnalyses.factCheckConfidence,
      factCheckReasoning: historicalNewsAnalyses.factCheckReasoning,
      factCheckedAt: historicalNewsAnalyses.factCheckedAt,
      perplexityVerdict: historicalNewsAnalyses.perplexityVerdict,
      perplexityConfidence: historicalNewsAnalyses.perplexityConfidence,
      perplexityReasoning: historicalNewsAnalyses.perplexityReasoning,
      perplexityCorrectDate: historicalNewsAnalyses.perplexityCorrectDate,
      perplexityCorrectDateText: historicalNewsAnalyses.perplexityCorrectDateText,
      perplexityCitations: historicalNewsAnalyses.perplexityCitations,
      perplexityCheckedAt: historicalNewsAnalyses.perplexityCheckedAt,
      reVerified: historicalNewsAnalyses.reVerified,
      reVerifiedAt: historicalNewsAnalyses.reVerifiedAt,
      reVerificationDate: historicalNewsAnalyses.reVerificationDate,
      reVerificationSummary: historicalNewsAnalyses.reVerificationSummary,
      reVerificationTier: historicalNewsAnalyses.reVerificationTier,
      reVerificationArticles: historicalNewsAnalyses.reVerificationArticles,
      reVerificationReasoning: historicalNewsAnalyses.reVerificationReasoning,
      reVerificationStatus: historicalNewsAnalyses.reVerificationStatus,
      reVerificationWinner: historicalNewsAnalyses.reVerificationWinner,
      tags: historicalNewsAnalyses.tags,
      tagNames: historicalNewsAnalyses.tagNames,
      geminiApproved: historicalNewsAnalyses.geminiApproved,
      perplexityApproved: historicalNewsAnalyses.perplexityApproved,
      finalAnalysisCheckedAt: historicalNewsAnalyses.finalAnalysisCheckedAt,
    })
      .from(historicalNewsAnalyses)
      .innerJoin(pagesAndTags, eq(historicalNewsAnalyses.id, pagesAndTags.analysisId))
      .where(eq(pagesAndTags.tagId, tagId))
      .orderBy(desc(historicalNewsAnalyses.date));
    
    return result;
  }

  /**
   * Find a tag by name only (case-insensitive), regardless of category
   */
  async findTagByName(name: string): Promise<Tag | null> {
    const { normalizeTagName } = await import("./services/tag-similarity");
    const normalizedName = normalizeTagName(name);
    
    // First try exact name match
    const exactMatch = await db.select()
      .from(tags)
      .where(eq(tags.name, name))
      .limit(1);
    
    if (exactMatch.length > 0) {
      return exactMatch[0];
    }
    
    // Then try normalized name match (case-insensitive)
    const normalizedMatch = await db.select()
      .from(tags)
      .where(eq(tags.normalizedName, normalizedName))
      .limit(1);
    
    if (normalizedMatch.length > 0) {
      return normalizedMatch[0];
    }
    
    return null;
  }

  /**
   * Find or create a tag in the tags table
   */
  async findOrCreateTag(tagData: { name: string; category: string; subcategoryPath?: string[] | null; parentTagId?: string | null }): Promise<Tag> {
    // First, check if tag exists with this name (in any category)
    const existingByName = await this.findTagByName(tagData.name);
    if (existingByName) {
      return existingByName;
    }
    
    // Try to find by exact name+category match
    const existing = await db.select()
      .from(tags)
      .where(and(
        eq(tags.name, tagData.name),
        eq(tags.category, tagData.category)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    // Create new tag
    const { normalizeTagName } = await import("./services/tag-similarity");
    const [newTag] = await db.insert(tags).values({
      name: tagData.name,
      category: tagData.category,
      normalizedName: normalizeTagName(tagData.name),
      subcategoryPath: tagData.subcategoryPath || null,
      parentTagId: tagData.parentTagId || null,
      usageCount: 0,
    })
      .returning();
    
    if (!newTag) {
      throw new Error(`Failed to create tag ${tagData.name} in category ${tagData.category}`);
    }
    
    return newTag;
  }

  /**
   * Update tag usage count based on join table
   */
  async updateTagUsageCount(tagId: string): Promise<void> {
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(pagesAndTags)
      .where(eq(pagesAndTags.tagId, tagId));
    
    const count = Number(countResult[0]?.count || 0);
    
    await db.update(tags)
      .set({ usageCount: count })
      .where(eq(tags.id, tagId));
  }
}

export const storage = new DatabaseStorage();

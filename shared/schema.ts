import { pgTable, text, serial, integer, boolean, date, timestamp, jsonb, numeric, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const historicalNewsAnalyses = pgTable("historical_news_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  summary: text("summary").notNull(),
  topArticleId: text("top_article_id"),
  lastAnalyzed: timestamp("last_analyzed").defaultNow(),
  isManualOverride: boolean("is_manual_override").default(false),
  aiProvider: text("ai_provider").default("openai"),
  reasoning: text("reasoning"),
  articleTags: jsonb("article_tags"),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }),
  sentimentScore: numeric("sentiment_score", { precision: 3, scale: 2 }),
  sentimentLabel: text("sentiment_label"), // 'bullish', 'bearish', 'neutral'
  topicCategories: jsonb("topic_categories"), // ['regulation', 'adoption', 'price', 'technology']
  duplicateArticleIds: jsonb("duplicate_article_ids"), // array of duplicate article IDs found
  totalArticlesFetched: integer("total_articles_fetched").default(0),
  uniqueArticlesAnalyzed: integer("unique_articles_analyzed").default(0),
  tierUsed: text("tier_used"), // 'bitcoin', 'crypto', 'macro', 'bitcoin-history', 'fallback'
  winningTier: text("winning_tier"), // The tier that won the significance analysis
  tieredArticles: jsonb("tiered_articles"), // Store articles from ALL tiers: { bitcoin: [...], crypto: [...], macro: [...] }
  analyzedArticles: jsonb("analyzed_articles"), // Store the exact articles that were analyzed (legacy, for backward compatibility)
  isFlagged: boolean("is_flagged").default(false),
  flagReason: text("flag_reason"),
  flaggedAt: timestamp("flagged_at"),
  factCheckVerdict: text("fact_check_verdict"), // 'verified', 'contradicted', 'uncertain'
  factCheckConfidence: numeric("fact_check_confidence", { precision: 5, scale: 2 }), // 0-100
  factCheckReasoning: text("fact_check_reasoning"),
  factCheckedAt: timestamp("fact_checked_at"),
  perplexityVerdict: text("perplexity_verdict"), // 'verified', 'contradicted', 'uncertain'
  perplexityConfidence: numeric("perplexity_confidence", { precision: 5, scale: 2 }), // 0-100
  perplexityReasoning: text("perplexity_reasoning"),
  perplexityCorrectDate: date("perplexity_correct_date"), // If event happened on different date (OLD - will be deprecated)
  perplexityCorrectDateText: text("perplexity_correct_date_text"), // NEW: Handles complex date strings like "2023-05-07 to 2023-05-09"
  perplexityCitations: jsonb("perplexity_citations"), // Array of source URLs from Perplexity
  perplexityCheckedAt: timestamp("perplexity_checked_at"),
  // Re-verification fields: When Perplexity finds a different date, re-analyze using that date
  reVerified: boolean("re_verified").default(false), // Has this been re-analyzed with corrected date?
  reVerifiedAt: timestamp("re_verified_at"), // When re-verification occurred
  reVerificationDate: text("re_verification_date"), // The date used for re-verification (from perplexityCorrectDateText)
  reVerificationSummary: text("re_verification_summary"), // New summary based on corrected date articles
  reVerificationTier: text("re_verification_tier"), // Which tier won for the corrected date
  reVerificationArticles: jsonb("re_verification_articles"), // Articles found for the corrected date
  reVerificationReasoning: text("re_verification_reasoning"), // AI reasoning for corrected date analysis
  reVerificationStatus: text("re_verification_status"), // 'success', 'problem' - tracks if re-verification found good coverage
  reVerificationWinner: text("re_verification_winner"), // 'original', 'corrected' - which date had better coverage
  tags: jsonb("tags"), // Array of extracted entities: [{name: "Bitcoin", category: "crypto"}, {name: "Tesla", category: "company"}]
}, (table) => ({
  // Critical indexes for performance
  dateIdx: index("idx_historical_news_date").on(table.date),
  lastAnalyzedIdx: index("idx_historical_news_last_analyzed").on(table.lastAnalyzed),
  confidenceScoreIdx: index("idx_historical_news_confidence").on(table.confidenceScore),
  sentimentScoreIdx: index("idx_historical_news_sentiment").on(table.sentimentScore),
  factCheckVerdictIdx: index("idx_historical_news_fact_check_verdict").on(table.factCheckVerdict),
}));

export const manualNewsEntries = pgTable("manual_news_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  isFlagged: boolean("is_flagged").default(false),
  flagReason: text("flag_reason"),
  flaggedAt: timestamp("flagged_at"),
}, (table) => ({
  // Performance indexes
  dateIdx: index("idx_manual_news_date").on(table.date),
  createdAtIdx: index("idx_manual_news_created_at").on(table.createdAt),
}));

export const sourceCredibility = pgTable("source_credibility", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  credibilityScore: numeric("credibility_score", { precision: 3, scale: 2 }).notNull(),
  category: text("category"),
  specialties: jsonb("specialties"),
  authority: numeric("authority", { precision: 3, scale: 2 }),
});

export const spamDomains = pgTable("spam_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiPrompts = pgTable("ai_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  purpose: text("purpose"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Batch event processing tables
export const eventBatches = pgTable("event_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalFilename: text("original_filename").notNull(),
  status: text("status").notNull().default("uploaded"), // 'uploaded', 'processing', 'reviewing', 'completed', 'cancelled'
  totalEvents: integer("total_events").notNull().default(0),
  processedEvents: integer("processed_events").notNull().default(0),
  approvedEvents: integer("approved_events").notNull().default(0),
  rejectedEvents: integer("rejected_events").notNull().default(0),
  currentBatchNumber: integer("current_batch_number").notNull().default(1),
  totalBatches: integer("total_batches").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  statusIdx: index("idx_event_batches_status").on(table.status),
  createdAtIdx: index("idx_event_batches_created_at").on(table.createdAt),
}));

export const batchEvents = pgTable("batch_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => eventBatches.id, { onDelete: "cascade" }),
  batchNumber: integer("batch_number").notNull(), // Which batch of 10 this belongs to
  originalDate: date("original_date").notNull(),
  originalSummary: text("original_summary").notNull(),
  originalGroup: text("original_group").notNull(),
  enhancedSummary: text("enhanced_summary"),
  enhancedReasoning: text("enhanced_reasoning"),
  status: text("status").notNull().default("pending"), // 'pending', 'enhanced', 'approved', 'rejected'
  aiProvider: text("ai_provider").default("openai"),
  processedAt: timestamp("processed_at"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  batchIdIdx: index("idx_batch_events_batch_id").on(table.batchId),
  batchNumberIdx: index("idx_batch_events_batch_number").on(table.batchNumber),
  statusIdx: index("idx_batch_events_status").on(table.status),
  originalDateIdx: index("idx_batch_events_original_date").on(table.originalDate),
}));

// Event conflicts table for duplicate detection
export const eventConflicts = pgTable("event_conflicts", {
  id: serial("id").primaryKey(),
  sourceDate: date("source_date").notNull(),
  relatedDate: date("related_date").notNull(),
  clusterId: date("cluster_id"), // The earliest date in the conflict cluster (nullable during migration)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  sourceDateIdx: index("idx_event_conflicts_source_date").on(table.sourceDate),
  relatedDateIdx: index("idx_event_conflicts_related_date").on(table.relatedDate),
  clusterIdIdx: index("idx_event_conflicts_cluster_id").on(table.clusterId),
  uniquePairIdx: uniqueIndex("idx_event_conflicts_unique_pair").on(table.sourceDate, table.relatedDate),
}));

// Tag metadata table for tag management, hierarchy, and similarity
export const tagMetadata: any = pgTable("tag_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  parentTagId: uuid("parent_tag_id").references((): any => tagMetadata.id, { onDelete: "set null" }), // Self-referencing for hierarchy
  normalizedName: text("normalized_name"), // For similarity matching (lowercase, normalized)
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  nameCategoryIdx: uniqueIndex("idx_tag_metadata_name_category").on(table.name, table.category),
  categoryIdx: index("idx_tag_metadata_category").on(table.category),
  parentTagIdx: index("idx_tag_metadata_parent_tag").on(table.parentTagId),
  normalizedNameIdx: index("idx_tag_metadata_normalized_name").on(table.normalizedName),
}));

// Relations
export const historicalNewsAnalysesRelations = relations(historicalNewsAnalyses, ({ many }) => ({
  manualEntries: many(manualNewsEntries),
}));

export const manualNewsEntriesRelations = relations(manualNewsEntries, ({ one }) => ({
  analysis: one(historicalNewsAnalyses, {
    fields: [manualNewsEntries.date],
    references: [historicalNewsAnalyses.date],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertHistoricalNewsAnalysisSchema = createInsertSchema(historicalNewsAnalyses).omit({
  id: true,
  lastAnalyzed: true,
  flaggedAt: true,
});

// New interfaces for tiered articles structure
export interface TieredArticles {
  bitcoin: ArticleData[];
  crypto: ArticleData[];
  macro: ArticleData[];
}

export interface ArticleData {
  id: string;
  title: string;
  url: string;
  publishedDate: string;
  author?: string;
  text: string;
  score?: number;
  summary?: string;
}

export interface EntityTag {
  name: string;
  category: string;
}

export const insertManualNewsEntrySchema = createInsertSchema(manualNewsEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  flaggedAt: true,
});

export const updateFlagSchema = z.object({
  isFlagged: z.boolean(),
  flagReason: z.string().optional(),
});

export type UpdateFlagData = z.infer<typeof updateFlagSchema>;

export const insertSourceCredibilitySchema = createInsertSchema(sourceCredibility).omit({
  id: true,
});

export const insertSpamDomainSchema = createInsertSchema(spamDomains).omit({
  id: true,
  createdAt: true,
});

export const insertAiPromptSchema = createInsertSchema(aiPrompts).omit({
  id: true,
  createdAt: true,
});

export const insertEventBatchSchema = createInsertSchema(eventBatches).omit({
  id: true,
  createdAt: true,
});

export const insertBatchEventSchema = createInsertSchema(batchEvents).omit({
  id: true,
  processedAt: true,
  reviewedAt: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertHistoricalNewsAnalysis = z.infer<typeof insertHistoricalNewsAnalysisSchema>;
export type HistoricalNewsAnalysis = typeof historicalNewsAnalyses.$inferSelect;

export type InsertManualNewsEntry = z.infer<typeof insertManualNewsEntrySchema>;
export type ManualNewsEntry = typeof manualNewsEntries.$inferSelect;

export type InsertSourceCredibility = z.infer<typeof insertSourceCredibilitySchema>;
export type SourceCredibility = typeof sourceCredibility.$inferSelect;

export type InsertSpamDomain = z.infer<typeof insertSpamDomainSchema>;
export type SpamDomain = typeof spamDomains.$inferSelect;

export type InsertAiPrompt = z.infer<typeof insertAiPromptSchema>;
export type AiPrompt = typeof aiPrompts.$inferSelect;

export type InsertEventBatch = z.infer<typeof insertEventBatchSchema>;
export type EventBatch = typeof eventBatches.$inferSelect;

export type InsertBatchEvent = z.infer<typeof insertBatchEventSchema>;
export type BatchEvent = typeof batchEvents.$inferSelect;

export const insertEventConflictSchema = createInsertSchema(eventConflicts).omit({
  id: true,
  createdAt: true,
});

export type InsertEventConflict = z.infer<typeof insertEventConflictSchema>;
export type EventConflict = typeof eventConflicts.$inferSelect;

export const insertTagMetadataSchema = createInsertSchema(tagMetadata).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTagMetadata = z.infer<typeof insertTagMetadataSchema>;
export type TagMetadata = typeof tagMetadata.$inferSelect;

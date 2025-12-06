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
  tagsVersion2: text("tags_version2").array(), // Simple array of tag names: ["Elon Musk", "Obama", "NFT", "Bitcoin"]
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

// New normalized tags table - single source of truth for all tags
export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  normalizedName: text("normalized_name"), // For similarity matching (lowercase, normalized)
  parentTagId: uuid("parent_tag_id").references((): any => tags.id, { onDelete: "set null" }), // Self-referencing for hierarchy
  subcategoryPath: text("subcategory_path").array(), // e.g., ["8.1", "8.1.2"] - full hierarchy path
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  nameCategoryIdx: uniqueIndex("idx_tags_name_category").on(table.name, table.category),
  categoryIdx: index("idx_tags_category").on(table.category),
  parentTagIdx: index("idx_tags_parent_tag").on(table.parentTagId),
  normalizedNameIdx: index("idx_tags_normalized_name").on(table.normalizedName),
}));

// Join table linking analyses (pages) to tags - many-to-many relationship
export const pagesAndTags = pgTable("pages_and_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id").notNull().references(() => historicalNewsAnalyses.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  pagesTagsIdx: uniqueIndex("idx_pages_and_tags_unique").on(table.analysisId, table.tagId),
  analysisIdx: index("idx_pages_and_tags_analysis").on(table.analysisId),
  tagIdx: index("idx_pages_and_tags_tag").on(table.tagId),
}));

// Custom labels for subcategories (overrides taxonomy.ts defaults)
export const subcategoryLabels = pgTable("subcategory_labels", {
  path: text("path").primaryKey(), // e.g., "1.2" or "4.1.2"
  label: text("label").notNull(),  // Custom display name
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Agent sessions table - tracks each agent run
export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("running"), // 'running', 'paused', 'completed', 'stopped', 'error'
  currentPass: integer("current_pass").notNull().default(1),
  maxPasses: integer("max_passes").notNull().default(10),
  issuesFixed: integer("issues_fixed").notNull().default(0),
  issuesFlagged: integer("issues_flagged").notNull().default(0),
  totalCost: numeric("total_cost", { precision: 10, scale: 4 }).default("0"),
  qualityScore: numeric("quality_score", { precision: 5, scale: 2 }),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  config: jsonb("config"), // Session configuration
  stats: jsonb("stats"), // Detailed statistics per module
}, (table) => ({
  statusIdx: index("idx_agent_sessions_status").on(table.status),
  startedAtIdx: index("idx_agent_sessions_started_at").on(table.startedAt),
}));

// Agent decisions table - tracks all decisions made by the agent
export const agentDecisions = pgTable("agent_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  passNumber: integer("pass_number").notNull(),
  module: text("module").notNull(), // 'validator', 'deduper', 'gap-filler', etc.
  type: text("type").notNull(), // 'remove_tag', 'merge_news', 'fill_gap', 'recategorize', etc.
  targetType: text("target_type").notNull(), // 'tag', 'news', 'both'
  targetId: text("target_id"), // ID of affected record
  confidence: numeric("confidence", { precision: 5, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'approved', 'rejected', 'auto-approved'
  beforeState: jsonb("before_state"), // State before change
  afterState: jsonb("after_state"), // State after change
  reasoning: text("reasoning"), // AI reasoning for the decision
  sources: jsonb("sources"), // Source citations
  cost: numeric("cost", { precision: 10, scale: 4 }),
  approvedBy: text("approved_by"), // 'auto', 'user', or user_id
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  sessionIdx: index("idx_agent_decisions_session").on(table.sessionId),
  moduleIdx: index("idx_agent_decisions_module").on(table.module),
  statusIdx: index("idx_agent_decisions_status").on(table.status),
  confidenceIdx: index("idx_agent_decisions_confidence").on(table.confidence),
}));

// Agent audit log - comprehensive log of ALL agent actions
export const agentAuditLog = pgTable("agent_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
  passNumber: integer("pass_number").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(), // 'update', 'insert', 'delete', 'merge'
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  reasoning: text("reasoning"),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  cost: numeric("cost", { precision: 10, scale: 4 }),
  durationMs: integer("duration_ms"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  sessionIdx: index("idx_agent_audit_session").on(table.sessionId),
  moduleIdx: index("idx_agent_audit_module").on(table.module),
  actionIdx: index("idx_agent_audit_action").on(table.action),
  createdAtIdx: index("idx_agent_audit_created_at").on(table.createdAt),
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
  subcategoryPath?: string[];
  confidence?: number;
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

export const insertTagSchema = createInsertSchema(tags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTag = z.infer<typeof insertTagSchema>;
export type Tag = typeof tags.$inferSelect;

export const insertPagesAndTagsSchema = createInsertSchema(pagesAndTags).omit({
  id: true,
  createdAt: true,
});

export type InsertPagesAndTags = z.infer<typeof insertPagesAndTagsSchema>;
export type PagesAndTags = typeof pagesAndTags.$inferSelect;

// Agent types
export const insertAgentSessionSchema = createInsertSchema(agentSessions).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSession = typeof agentSessions.$inferSelect;

export const insertAgentDecisionSchema = createInsertSchema(agentDecisions).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
});

export type InsertAgentDecision = z.infer<typeof insertAgentDecisionSchema>;
export type AgentDecision = typeof agentDecisions.$inferSelect;

export const insertAgentAuditLogSchema = createInsertSchema(agentAuditLog).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentAuditLog = z.infer<typeof insertAgentAuditLogSchema>;
export type AgentAuditLog = typeof agentAuditLog.$inferSelect;

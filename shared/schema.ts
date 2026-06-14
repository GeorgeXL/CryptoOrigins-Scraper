import { pgTable, text, serial, integer, boolean, date, timestamp, jsonb, numeric, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const historicalNewsAnalyses = pgTable("historical_news_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  summary: text("summary").notNull(),
  topArticleId: text("top_article_id"),
  lastAnalyzed: timestamp("last_analyzed").defaultNow(),
  isManualOverride: boolean("is_manual_override").default(false),
  reasoning: text("reasoning"),
  articleTags: jsonb("article_tags"),
  topicCategories: jsonb("topic_categories"), // ['regulation', 'adoption', 'price', 'technology']
  tierUsed: text("tier_used"), // 'bitcoin', 'crypto', 'macro', 'bitcoin-history', 'fallback'
  winningTier: text("winning_tier"), // The tier that won the significance analysis
  tieredArticles: jsonb("tiered_articles"), // Store articles from ALL tiers: { bitcoin: [...], crypto: [...], macro: [...] }
  analyzedArticles: jsonb("analyzed_articles"), // Store the exact articles that were analyzed (legacy, for backward compatibility)
  isFlagged: boolean("is_flagged").default(false),
  isLocked: boolean("is_locked").default(false),
  flaggedAt: timestamp("flagged_at"),
  googleCheckHappened: text("google_check_happened"), // 'yes', 'no', 'uncertain'
  googleCheckCheckedAt: timestamp("google_check_checked_at"),
  tagsVersion2: text("tags_version2").array(), // Simple array of tag names: ["Elon Musk", "Obama", "NFT", "Bitcoin"]
  suppressedTagSuggestions: text("suppressed_tag_suggestions").array(), // Operator-declined proposed tags for this date
}, (table) => ({
  // Critical indexes for performance
  dateIdx: index("idx_historical_news_date").on(table.date),
  lastAnalyzedIdx: index("idx_historical_news_last_analyzed").on(table.lastAnalyzed),
  googleCheckHappenedIdx: index("idx_historical_news_google_check_happened").on(table.googleCheckHappened),
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

// Editorial pipeline runs (v2) - orchestrator level lifecycle
export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("running"), // running, paused, completed, stopped, error
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  model: text("model").notNull().default("gpt-5.4-mini"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  requestedBy: text("requested_by").default("admin-ui"),
  stats: jsonb("stats"),
  config: jsonb("config"),
}, (table) => ({
  statusIdx: index("idx_pipeline_runs_status").on(table.status),
  startedIdx: index("idx_pipeline_runs_started_at").on(table.startedAt),
  dateRangeIdx: index("idx_pipeline_runs_date_range").on(table.dateFrom, table.dateTo),
}));

// Per-agent/per-stage steps produced during a pipeline run
export const pipelineSteps = pgTable("pipeline_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull().default("queued"), // queued, running, completed, rejected, skipped, error
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  rejectionReason: text("rejection_reason"),
  suggestedAction: text("suggested_action"),
  returnTo: text("return_to"),
  input: jsonb("input"),
  output: jsonb("output"),
  evidence: jsonb("evidence"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  runIdx: index("idx_pipeline_steps_run_id").on(table.runId),
  runStepIdx: uniqueIndex("idx_pipeline_steps_run_step").on(table.runId, table.stepIndex),
  agentIdx: index("idx_pipeline_steps_agent_name").on(table.agentName),
  statusIdx: index("idx_pipeline_steps_status").on(table.status),
}));

// Explicit handoffs between agents for observability and auditability
export const pipelineHandoffs = pgTable("pipeline_handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  fromAgent: text("from_agent").notNull(),
  toAgent: text("to_agent").notNull(),
  status: text("status").notNull().default("sent"), // sent, consumed, rejected
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  runIdx: index("idx_pipeline_handoffs_run_id").on(table.runId),
  fromAgentIdx: index("idx_pipeline_handoffs_from_agent").on(table.fromAgent),
  toAgentIdx: index("idx_pipeline_handoffs_to_agent").on(table.toAgent),
}));

// Normalized evidence references used by pipeline agents.
export const pipelineEvidence = pgTable("pipeline_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => pipelineSteps.id, { onDelete: "set null" }),
  sourceType: text("source_type").notNull(), // exa, perplexity, google, archive, db
  url: text("url"),
  title: text("title"),
  publishedAt: timestamp("published_at"),
  credibilityScore: numeric("credibility_score", { precision: 5, scale: 2 }),
  claim: text("claim"),
  snippet: text("snippet"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  runIdx: index("idx_pipeline_evidence_run_id").on(table.runId),
  stepIdx: index("idx_pipeline_evidence_step_id").on(table.stepId),
  sourceIdx: index("idx_pipeline_evidence_source_type").on(table.sourceType),
}));

// Append-only confidence history for explainability and regression checks.
export const pipelineConfidenceHistory = pgTable("pipeline_confidence_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => pipelineSteps.id, { onDelete: "set null" }),
  agentName: text("agent_name").notNull(),
  score: numeric("score", { precision: 5, scale: 2 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  runIdx: index("idx_pipeline_conf_hist_run_id").on(table.runId),
  stepIdx: index("idx_pipeline_conf_hist_step_id").on(table.stepId),
  agentIdx: index("idx_pipeline_conf_hist_agent_name").on(table.agentName),
}));

// Canonical milestone set for historical integrity checks.
export const canonicalMilestones = pgTable("canonical_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  expectedDate: date("expected_date").notNull(),
  category: text("category").notNull().default("bitcoin-history"),
  priority: text("priority").notNull().default("high"), // critical, high, medium
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  expectedDateIdx: index("idx_canonical_milestones_expected_date").on(table.expectedDate),
  priorityIdx: index("idx_canonical_milestones_priority").on(table.priority),
}));

/** Cached Gemini main-events list per storyline leaf (Main events check). */
export const mainEventsCheckCache = pgTable("main_events_check_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  storylineLeaf: text("storyline_leaf").notNull(),
  normalizedLeaf: text("normalized_leaf").notNull(),
  geminiModel: text("gemini_model").notNull(),
  cacheVersion: text("cache_version").notNull(),
  notes: text("notes"),
  canonicalDates: jsonb("canonical_dates").notNull(),
  skippedCanonical: jsonb("skipped_canonical").notNull().default([]),
  dismissedDates: jsonb("dismissed_dates").notNull().default({ misplaced: [], missing: [], extra: [] }),
  verificationDates: jsonb("verification_dates").notNull().default({ matched: [], pending: [] }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  normalizedLeafUq: uniqueIndex("idx_main_events_check_cache_normalized_leaf").on(table.normalizedLeaf),
}));

/** Operator resolution when the same date is proposed on multiple leaves' Gemini lists. */
export const mainEventsCrossLeafAssignments = pgTable("main_events_cross_leaf_assignments", {
  date: date("date").primaryKey(),
  ownerLeaf: text("owner_leaf").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerLeafIdx: index("idx_main_events_cross_leaf_owner").on(table.ownerLeaf),
}));

// Human review queue for final editorial approval (mandatory gate)
export const humanReviewQueue = pgTable("human_review_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => pipelineSteps.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  priority: integer("priority").notNull().default(50),
  eventDate: date("event_date"),
  reviewer: text("reviewer"),
  reviewNotes: text("review_notes"),
  package: jsonb("package").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
}, (table) => ({
  runIdx: index("idx_human_review_queue_run_id").on(table.runId),
  statusIdx: index("idx_human_review_queue_status").on(table.status),
  priorityIdx: index("idx_human_review_queue_priority").on(table.priority),
  eventDateIdx: index("idx_human_review_queue_event_date").on(table.eventDate),
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
});

export const updateManualEntryFlagSchema = z.object({
  isFlagged: z.boolean(),
  flagReason: z.string().optional(),
});

export type UpdateFlagData = z.infer<typeof updateFlagSchema>;

// Types
export type InsertHistoricalNewsAnalysis = z.infer<typeof insertHistoricalNewsAnalysisSchema>;
export type HistoricalNewsAnalysis = typeof historicalNewsAnalyses.$inferSelect;

export type InsertManualNewsEntry = z.infer<typeof insertManualNewsEntrySchema>;
export type ManualNewsEntry = typeof manualNewsEntries.$inferSelect;

// Editorial pipeline v2 types
export const insertPipelineRunSchema = createInsertSchema(pipelineRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type InsertPipelineRun = z.infer<typeof insertPipelineRunSchema>;
export type PipelineRun = typeof pipelineRuns.$inferSelect;

export const insertPipelineStepSchema = createInsertSchema(pipelineSteps).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export type InsertPipelineStep = z.infer<typeof insertPipelineStepSchema>;
export type PipelineStep = typeof pipelineSteps.$inferSelect;

export const insertPipelineHandoffSchema = createInsertSchema(pipelineHandoffs).omit({
  id: true,
  createdAt: true,
});

export type InsertPipelineHandoff = z.infer<typeof insertPipelineHandoffSchema>;
export type PipelineHandoff = typeof pipelineHandoffs.$inferSelect;

export const insertHumanReviewQueueSchema = createInsertSchema(humanReviewQueue).omit({
  id: true,
  createdAt: true,
  reviewedAt: true,
});

export type InsertHumanReviewQueue = z.infer<typeof insertHumanReviewQueueSchema>;
export type HumanReviewQueue = typeof humanReviewQueue.$inferSelect;

export const insertPipelineEvidenceSchema = createInsertSchema(pipelineEvidence).omit({
  id: true,
  createdAt: true,
});

export type InsertPipelineEvidence = z.infer<typeof insertPipelineEvidenceSchema>;
export type PipelineEvidence = typeof pipelineEvidence.$inferSelect;

export const insertPipelineConfidenceHistorySchema = createInsertSchema(pipelineConfidenceHistory).omit({
  id: true,
  createdAt: true,
});

export type InsertPipelineConfidenceHistory = z.infer<typeof insertPipelineConfidenceHistorySchema>;
export type PipelineConfidenceHistory = typeof pipelineConfidenceHistory.$inferSelect;

export const insertCanonicalMilestoneSchema = createInsertSchema(canonicalMilestones).omit({
  id: true,
  createdAt: true,
});

export type InsertCanonicalMilestone = z.infer<typeof insertCanonicalMilestoneSchema>;
export type CanonicalMilestone = typeof canonicalMilestones.$inferSelect;

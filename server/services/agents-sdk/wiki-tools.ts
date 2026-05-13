import { tool } from "@openai/agents";
import { z } from "zod";
import { and, asc, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { db } from "../../db";
import {
  agentDecisions,
  historicalNewsAnalyses,
  pageTopics,
  pagesAndTags,
  tags,
  topics,
} from "@shared/schema";

export function createWikiTools(sessionId: string, maxProposals: number) {
  let proposalsCreated = 0;

  const get_analysis_by_date = tool({
    name: "get_analysis_by_date",
    description: "Load one historical_news_analyses row by calendar date (YYYY-MM-DD).",
    parameters: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    strict: true,
    execute: async ({ date }) => {
      const rows = await db
        .select()
        .from(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.date, date))
        .limit(1);
      return { found: rows.length > 0, analysis: rows[0] ?? null };
    },
  });

  const list_recent_analyses = tool({
    name: "list_recent_analyses",
    description: "List recent analyses in a date range (summary + ids), newest first.",
    parameters: z.object({
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    strict: true,
    execute: async ({ dateFrom, dateTo, limit: lim }) => {
      const limit = lim ?? 20;
      const rows = await db
        .select({
          id: historicalNewsAnalyses.id,
          date: historicalNewsAnalyses.date,
          summary: historicalNewsAnalyses.summary,
          isOrphan: historicalNewsAnalyses.isOrphan,
          isFlagged: historicalNewsAnalyses.isFlagged,
          totalArticlesFetched: historicalNewsAnalyses.totalArticlesFetched,
        })
        .from(historicalNewsAnalyses)
        .where(
          and(
            gte(historicalNewsAnalyses.date, dateFrom),
            lte(historicalNewsAnalyses.date, dateTo)
          )
        )
        .orderBy(desc(historicalNewsAnalyses.date))
        .limit(limit);
      return { analyses: rows };
    },
  });

  const list_tags_for_analysis = tool({
    name: "list_tags_for_analysis",
    description: "Tags linked to an analysis via pages_and_tags.",
    parameters: z.object({
      analysisId: z.string().uuid(),
    }),
    strict: true,
    execute: async ({ analysisId }) => {
      const rows = await db
        .select({
          tagId: tags.id,
          name: tags.name,
          category: tags.category,
        })
        .from(pagesAndTags)
        .innerJoin(tags, eq(pagesAndTags.tagId, tags.id))
        .where(eq(pagesAndTags.analysisId, analysisId));
      return { tags: rows };
    },
  });

  const list_page_topics_for_analysis = tool({
    name: "list_page_topics_for_analysis",
    description: "Narrative topics (page_topics) linked to an analysis.",
    parameters: z.object({
      analysisId: z.string().uuid(),
    }),
    strict: true,
    execute: async ({ analysisId }) => {
      const rows = await db
        .select({
          topicId: topics.id,
          topicName: topics.name,
          isPrimary: pageTopics.isPrimary,
        })
        .from(pageTopics)
        .innerJoin(topics, eq(pageTopics.topicId, topics.id))
        .where(eq(pageTopics.analysisId, analysisId));
      return { pageTopics: rows };
    },
  });

  const list_topics_catalog = tool({
    name: "list_topics_catalog",
    description: "List topics in the editorial topics table (bounded).",
    parameters: z.object({
      limit: z.number().int().min(1).max(200).default(100),
    }),
    strict: true,
    execute: async ({ limit: lim }) => {
      const limit = lim ?? 100;
      const rows = await db
        .select({
          id: topics.id,
          name: topics.name,
          parentTopicId: topics.parentTopicId,
          sortOrder: topics.sortOrder,
        })
        .from(topics)
        .orderBy(asc(topics.sortOrder), asc(topics.name))
        .limit(limit);
      return { topics: rows };
    },
  });

  const search_tags = tool({
    name: "search_tags",
    description: "Search tags by name substring (case-insensitive).",
    parameters: z.object({
      query: z.string().min(1).max(80),
      limit: z.number().int().min(1).max(40).default(20),
    }),
    strict: true,
    execute: async ({ query, limit: lim }) => {
      const limit = lim ?? 20;
      const rows = await db
        .select({
          id: tags.id,
          name: tags.name,
          category: tags.category,
        })
        .from(tags)
        .where(ilike(tags.name, `%${query}%`))
        .limit(limit);
      return { tags: rows };
    },
  });

  const submit_proposal = tool({
    name: "submit_proposal",
    description:
      "Create a pending human-review item. Use for every concrete fix you want a human to approve.",
    parameters: z.object({
      type: z.string().min(1).max(120),
      targetType: z.enum(["news", "tag", "topic"]),
      targetId: z.string().uuid().optional(),
      reasoning: z.string().min(20).max(12000),
      proposalAction: z.enum([
        "reanalyze_date",
        "flag_analysis",
        "manual_review_tag",
        "manual_review_topic",
      ]),
      analysisId: z.string().uuid().optional(),
      analysisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      flagReason: z.string().max(2000).optional(),
      beforeStateJson: z.string().max(50000).optional(),
    }),
    strict: true,
    execute: async (input) => {
      if (proposalsCreated >= maxProposals) {
        return {
          ok: false,
          error: `Proposal cap reached (${maxProposals}). Stop calling submit_proposal.`,
        };
      }

      let beforeState: unknown = undefined;
      if (input.beforeStateJson) {
        try {
          beforeState = JSON.parse(input.beforeStateJson) as unknown;
        } catch {
          beforeState = { raw: input.beforeStateJson };
        }
      }

      const afterState = {
        action: input.proposalAction,
        analysisId: input.analysisId ?? input.targetId,
        date: input.analysisDate,
        flagReason: input.flagReason,
      };

      const [row] = await db
        .insert(agentDecisions)
        .values({
          sessionId,
          passNumber: 1,
          module: "wiki-overseer",
          type: input.type,
          targetType: input.targetType,
          targetId: input.targetId ?? input.analysisId ?? null,
          confidence: "72.00",
          status: "pending",
          beforeState: beforeState as any,
          afterState: afterState as any,
          reasoning: input.reasoning,
        })
        .returning({ id: agentDecisions.id });

      proposalsCreated += 1;
      return { ok: true, decisionId: row!.id, proposalsCreated };
    },
  });

  return [
    get_analysis_by_date,
    list_recent_analyses,
    list_tags_for_analysis,
    list_page_topics_for_analysis,
    list_topics_catalog,
    search_tags,
    submit_proposal,
  ];
}

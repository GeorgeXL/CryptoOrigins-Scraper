import OpenAI from "openai";
import { z } from "zod";
import { getModelForAgent } from "./model-config";
import { AGENT_REASON_MAX, formatRelevanceQueueNote, trimAgentReason } from "./agent-reason";
import { isBlogPaginationWinner, isGenericMarketingSummary, isRoundupMultiStorySummary, summaryNeedsBetterArticleSource } from "./editorial-quality";

export type RelevanceClassification =
  | "bitcoin_primary"
  | "crypto_adjacent"
  | "macro_adjacent"
  | "off_topic"
  | "insufficient";

export type RelevanceAgentConfidence = "high" | "medium" | "low";

export type RelevanceAgentResult = {
  source: "llm" | "rules" | "skipped";
  classification: RelevanceClassification;
  confidence: RelevanceAgentConfidence;
  suggestArticlePick: boolean;
  reason: string;
};

const relevanceVerdictSchema = z.object({
  classification: z.enum([
    "bitcoin_primary",
    "crypto_adjacent",
    "macro_adjacent",
    "off_topic",
    "insufficient",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  suggest_article_pick: z.boolean(),
  reason: z.string().max(AGENT_REASON_MAX).default(""),
});

export function isRelevanceAgentEnabled(): boolean {
  if (process.env.RELEVANCE_AGENT_DISABLED === "1") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Classify whether the day story fits a Bitcoin/crypto/macro timeline slot. */
export async function evaluateRelevanceWithAgent(input: {
  date: string;
  summary: string;
  tags?: string[];
  topics?: string[];
  articleTitle?: string | null;
  topArticleId?: string | null;
}): Promise<RelevanceAgentResult> {
  const summary = input.summary.trim();
  if (summary.length < 15) {
    return {
      source: "rules",
      classification: "insufficient",
      confidence: "high",
      suggestArticlePick: true,
      reason: "Summary too short to classify relevance.",
    };
  }
  if (isGenericMarketingSummary(summary) || isBlogPaginationWinner(input.topArticleId)) {
    return {
      source: "rules",
      classification: "insufficient",
      confidence: "high",
      suggestArticlePick: true,
      reason: "Blog or marketing page, not dated event",
    };
  }
  if (isRoundupMultiStorySummary(summary) || summaryNeedsBetterArticleSource(summary, input.topArticleId)) {
    return {
      source: "rules",
      classification: "insufficient",
      confidence: "high",
      suggestArticlePick: true,
      reason: "Roundup lists multiple stories",
    };
  }
  if (!isRelevanceAgentEnabled()) {
    return {
      source: "skipped",
      classification: "crypto_adjacent",
      confidence: "low",
      suggestArticlePick: false,
      reason: "Relevance Agent disabled.",
    };
  }

  const system = `You classify a calendar-day timeline entry for a Bitcoin/crypto/macro history product.
Use summary, tags, topics, and optional article title only.
Classifications:
- bitcoin_primary: Bitcoin/BTC/Satoshi/blockchain protocol is the main story
- crypto_adjacent: crypto industry story (exchange, DeFi, altcoin) with clear crypto angle
- macro_adjacent: macro/politics/labor/banking story with no crypto angle (valid on timeline)
- off_topic: wrong product slot (sports, celebrity gossip, unrelated local crime with no macro/crypto tie)
- insufficient: placeholder, generic, or too vague to publish
Set suggest_article_pick=true when insufficient or off_topic and a different event should be chosen.
Return JSON only: {"classification":string,"confidence":"high"|"medium"|"low","suggest_article_pick":boolean,"reason":string}
Set reason to "" (preferred) or at most 6 words — internal only, not shown to editors.`;

  const userPayload = JSON.stringify({
    calendar_date: input.date,
    summary,
    tags: input.tags ?? [],
    topics: input.topics ?? [],
    article_title: input.articleTitle?.slice(0, 200) ?? null,
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await openai.chat.completions.create({
      model: getModelForAgent("RelevanceCheckerAgent"),
      temperature: 0.05,
      max_completion_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPayload },
      ],
    });
    const parsed = relevanceVerdictSchema.safeParse(
      JSON.parse(completion.choices[0]?.message?.content ?? "{}"),
    );
    if (!parsed.success) {
      return {
        source: "skipped",
        classification: "insufficient",
        confidence: "low",
        suggestArticlePick: false,
        reason: "Invalid Relevance Agent JSON.",
      };
    }
    return {
      source: "llm",
      classification: parsed.data.classification,
      confidence: parsed.data.confidence,
      suggestArticlePick: parsed.data.suggest_article_pick,
      reason: trimAgentReason(parsed.data.reason),
    };
  } catch (err) {
    return {
      source: "skipped",
      classification: "insufficient",
      confidence: "low",
      suggestArticlePick: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function relevanceOperatorNote(classification: RelevanceClassification): string {
  return formatRelevanceQueueNote(classification);
}

export function relevanceRequiresArticlePick(result: RelevanceAgentResult): boolean {
  if (result.confidence === "low") return false;
  if (!result.suggestArticlePick) return false;
  return result.classification === "off_topic" || result.classification === "insufficient";
}

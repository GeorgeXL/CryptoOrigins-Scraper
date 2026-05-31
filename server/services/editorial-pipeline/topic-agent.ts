import OpenAI from "openai";
import { z } from "zod";
import {
  TOPIC_HIERARCHY,
  TOPIC_HIERARCHY_LEAVES,
} from "@shared/topic-hierarchy";
import { getModelForAgent } from "./model-config";
import {
  rankTopicCandidatesFromSummary,
  storedTopicConflictsWithSummary,
  storedTopicMisaligned,
  type TopicRankingResult,
} from "./storyline-taxonomy";
import { invalidTopicReasons } from "./topic-validation";

export type TopicAgentConfidence = "high" | "medium" | "low";

export type TopicAgentInput = {
  date: string;
  summary: string;
  tags?: string[];
  currentTopics?: string[];
  /** Short source excerpt — title + first ~600 chars of article, not full bundle noise. */
  sourceSnippet?: string | null;
  neighborHints?: Array<{ date: string; topics: string[]; summaryPreview: string }>;
};

export type TopicAgentResult = {
  source: "llm" | "rules" | "skipped";
  confidence: TopicAgentConfidence;
  recommended: string | null;
  alternates: string[];
  proposed: string[];
  reason: string;
  duplicateRisk: "low" | "medium" | "high";
  ranking: TopicRankingResult;
};

const topicAgentResponseSchema = z.object({
  recommended_topic: z.string().nullable(),
  alternates: z.array(z.string()).max(2).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().max(48).default(""),
  duplicate_risk: z.enum(["low", "medium", "high"]).default("low"),
  no_good_fit: z.boolean().default(false),
});

let hierarchyPromptBlock: string | null = null;

function topicHierarchyPromptBlock(): string {
  if (hierarchyPromptBlock) return hierarchyPromptBlock;
  hierarchyPromptBlock = TOPIC_HIERARCHY.map(
    (group) =>
      `${group.name} — ${group.description}\n${group.leaves.map((leaf) => `  - ${leaf}`).join("\n")}`,
  ).join("\n\n");
  return hierarchyPromptBlock;
}

const LEAF_BY_LOWER = new Map(TOPIC_HIERARCHY_LEAVES.map((leaf) => [leaf.toLowerCase(), leaf]));

/** Map model output to an exact hierarchy leaf, or null if unknown. */
export function canonicalTopicLeaf(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const exact = LEAF_BY_LOWER.get(trimmed.toLowerCase());
  if (exact) return exact;
  const withoutGroup = trimmed.includes("›") ? trimmed.split("›").pop()?.trim() : trimmed;
  if (!withoutGroup) return null;
  return LEAF_BY_LOWER.get(withoutGroup.toLowerCase()) ?? null;
}

export function normalizeTopicAgentLeaves(raw: {
  recommended_topic: string | null;
  alternates: string[];
}): { recommended: string | null; alternates: string[] } {
  const recommended = raw.recommended_topic ? canonicalTopicLeaf(raw.recommended_topic) : null;
  const alternates: string[] = [];
  for (const alt of raw.alternates) {
    const leaf = canonicalTopicLeaf(alt);
    if (!leaf || leaf === recommended) continue;
    if (!alternates.includes(leaf)) alternates.push(leaf);
  }
  return { recommended, alternates: alternates.slice(0, 2) };
}

export function topicAgentLeavesToRanking(
  confidence: TopicAgentConfidence,
  recommended: string | null,
  alternates: string[],
): TopicRankingResult {
  const leaves: string[] = [];
  if (recommended) leaves.push(recommended);
  for (const alt of alternates) {
    if (!leaves.includes(alt)) leaves.push(alt);
  }
  const candidates = leaves.map((leaf, index) => ({ leaf, score: 10 - index }));
  if (!candidates.length) return { confidence: "low", primary: null, candidates: [] };

  const rankingConfidence =
    confidence === "high" && candidates.length === 1 ? "high" : ("low" as const);

  return {
    confidence: rankingConfidence,
    primary: candidates[0]?.leaf ?? null,
    candidates,
  };
}

export function isTopicAgentEnabled(): boolean {
  if (process.env.TOPIC_AGENT_DISABLED === "1") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function parseTopicAgentJson(raw: string): z.infer<typeof topicAgentResponseSchema> | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) text = fence[1].trim();
  try {
    return topicAgentResponseSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function rulesFallback(input: TopicAgentInput, reason: string): TopicAgentResult {
  const ranking = rankTopicCandidatesFromSummary({ summary: input.summary, tags: input.tags ?? [] });
  const proposed =
    ranking.confidence === "high" && ranking.primary
      ? [ranking.primary]
      : ranking.candidates.map((c) => c.leaf);
  return {
    source: "rules",
    confidence: proposed.length === 1 ? "high" : proposed.length > 1 ? "medium" : "low",
    recommended: ranking.primary,
    alternates: ranking.candidates.slice(1).map((c) => c.leaf),
    proposed,
    reason,
    duplicateRisk: "low",
    ranking,
  };
}

/**
 * LLM Topic Agent — assigns homepage storyline leaves from summary (+ optional source snippet).
 * Falls back to deterministic rules when disabled, on error, or invalid model output.
 */
export async function suggestTopicsWithAgent(input: TopicAgentInput): Promise<TopicAgentResult> {
  const summary = input.summary.trim();
  if (!summary) {
    return rulesFallback(input, "Summary is empty — rule fallback returned no topic.");
  }

  if (!isTopicAgentEnabled()) {
    return rulesFallback(input, "Topic Agent disabled or OPENAI_API_KEY missing — used keyword rules.");
  }

  const system = `You assign exactly one homepage storyline topic for a historical crypto/macro timeline day.

Use ONLY topic leaves from the hierarchy below. Copy leaf names EXACTLY (case and spelling).

Rules:
1. Read the SUMMARY first — it is the editorial truth for this day.
2. Pick the most specific accurate leaf. Prefer Macro & Policy leaves for macro/labor/housing/government stories with no Bitcoin angle.
3. Do NOT pick a Bitcoin-group leaf unless the summary is actually about Bitcoin/BTC/Satoshi/blockchain.
4. If two leaves are plausible, set confidence=medium and list up to 2 alternates.
5. If no leaf fits well, set no_good_fit=true, recommended_topic=null, confidence=low — do NOT force a weak Bitcoin topic.
6. Ignore legacy labels like historical, economic, adoption, technology — they are invalid.
7. duplicate_risk=high only when the event clearly duplicates a neighbor day listed in context.

Respond with a JSON object only (no markdown): {"recommended_topic":string|null,"alternates":string[],"confidence":"high"|"medium"|"low","reason":string,"duplicate_risk":"low"|"medium"|"high","no_good_fit":boolean}
Set reason to "" (preferred) or at most 6 words — internal only, not shown to editors.

TOPIC HIERARCHY:
${topicHierarchyPromptBlock()}`;

  const userPayload = {
    calendar_date: input.date,
    summary,
    tags: input.tags ?? [],
    current_topics: input.currentTopics ?? [],
    source_snippet: input.sourceSnippet?.slice(0, 600) ?? null,
    neighbor_days: (input.neighborHints ?? []).slice(0, 4).map((n) => ({
      date: n.date,
      topics: n.topics,
      summary_preview: n.summaryPreview.slice(0, 180),
    })),
  };

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: getModelForAgent("TopicValidatorAgent"),
      temperature: 0.1,
      max_completion_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(userPayload),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const parsed = parseTopicAgentJson(content);
    if (!parsed) {
      return rulesFallback(input, "Topic Agent returned invalid JSON — used keyword rules.");
    }

    if (parsed.no_good_fit && !parsed.recommended_topic) {
      const { recommended, alternates } = normalizeTopicAgentLeaves(parsed);
      const proposed = [...(recommended ? [recommended] : []), ...alternates].slice(0, 3);
      const ranking = topicAgentLeavesToRanking("low", recommended, alternates);
      return {
        source: "llm",
        confidence: "low",
        recommended,
        alternates,
        proposed,
        reason: parsed.reason,
        duplicateRisk: parsed.duplicate_risk,
        ranking,
      };
    }

    const { recommended, alternates } = normalizeTopicAgentLeaves(parsed);
    if (!recommended && alternates.length === 0) {
      return rulesFallback(input, "Invalid model leaves — used keyword rules.");
    }

    const proposed =
      parsed.confidence === "high" && recommended
        ? [recommended]
        : [recommended, ...alternates].filter((x): x is string => Boolean(x)).slice(0, 3);

    const ranking = topicAgentLeavesToRanking(parsed.confidence, recommended, alternates);

    return {
      source: "llm",
      confidence: parsed.confidence,
      recommended,
      alternates,
      proposed,
      reason: parsed.reason,
      duplicateRisk: parsed.duplicate_risk,
      ranking,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return rulesFallback(input, `Topic Agent error (${msg}) — used keyword rules.`);
  }
}

/** Resolve topic ranking for correction proposals — LLM primary, rules fallback. */
export async function resolveTopicRankingForCorrection(opts: {
  date: string;
  summary: string;
  tags: string[];
  currentTopics: string[];
  sourceSnippet?: string | null;
  neighborHints?: TopicAgentInput["neighborHints"];
}): Promise<{
  ranking: TopicRankingResult;
  agentReason?: string;
  source: TopicAgentResult["source"];
  confidence?: TopicAgentConfidence;
}> {
  const needsAgent = (() => {
    const topicIssues = invalidTopicReasons(opts.currentTopics);
    if (topicIssues.length > 0) return true;
    if (storedTopicConflictsWithSummary(opts.currentTopics, opts.summary)) return true;
    const ruleRanking = rankTopicCandidatesFromSummary({ summary: opts.summary, tags: opts.tags });
    if (storedTopicMisaligned(opts.currentTopics, ruleRanking.primary ? [ruleRanking.primary] : [])) {
      return true;
    }
    return false;
  })();

  if (!needsAgent) {
    const ranking = rankTopicCandidatesFromSummary({ summary: opts.summary, tags: opts.tags });
    return { ranking, source: "skipped" };
  }

  const agent = await suggestTopicsWithAgent({
    date: opts.date,
    summary: opts.summary,
    tags: opts.tags,
    currentTopics: opts.currentTopics,
    sourceSnippet: opts.sourceSnippet,
    neighborHints: opts.neighborHints,
  });

  return {
    ranking: agent.ranking,
    agentReason: agent.reason.trim() || undefined,
    source: agent.source,
    confidence: agent.confidence,
  };
}

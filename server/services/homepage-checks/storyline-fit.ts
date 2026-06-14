import { formatTopicLeafWithGroup } from "@shared/topic-hierarchy";
import { evaluateStorylineFitHeuristic } from "@shared/storyline-fit-heuristics";
import { extractTopicLabelsFromCategories } from "../../../client/src/lib/topicCatalog";
import { isTopicAgentEnabled, suggestTopicsWithAgent } from "../editorial-pipeline/topic-agent";
import { normalizeTopicValue } from "../editorial-pipeline/tools";

export type StorylineFitStatus = "ok" | "mismatch" | "uncertain";

export type StorylineFitRowResult = {
  date: string;
  status: StorylineFitStatus;
  reason?: string;
  suggestedLeaves?: string[];
  source?: "llm" | "rules" | "skipped";
};

export type StorylineFitBatchResult = {
  topicLeaf: string;
  topicLeafLabel: string;
  scanned: number;
  ok: number;
  mismatch: number;
  uncertain: number;
  results: Record<string, StorylineFitRowResult>;
};

export type StorylineFitInputItem = {
  date: string;
  summary: string;
  tags?: string[];
  topic_categories?: unknown;
};

const MAX_ITEMS = 50;

function leafMatches(a: string, b: string): boolean {
  return normalizeTopicValue(a) === normalizeTopicValue(b);
}

function uniqueLeaves(leaves: Array<string | null | undefined>, exclude?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const leaf of leaves) {
    if (!leaf?.trim()) continue;
    if (exclude && leafMatches(leaf, exclude)) continue;
    const key = normalizeTopicValue(leaf);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(leaf.trim());
  }
  return out;
}

function heuristicMismatch(
  selectedLeaf: string,
  item: StorylineFitInputItem,
  heuristic: ReturnType<typeof evaluateStorylineFitHeuristic>,
  agentSuggestions: string[] = [],
): StorylineFitRowResult {
  const suggestions = uniqueLeaves(
    [heuristic.suggestedLeaf, ...agentSuggestions],
    selectedLeaf,
  ).slice(0, 3);

  return {
    date: item.date,
    status: "mismatch",
    reason: heuristic.reason,
    suggestedLeaves: suggestions.length > 0 ? suggestions : undefined,
    source: "rules",
  };
}

async function agentPass(selectedLeaf: string, item: StorylineFitInputItem): Promise<StorylineFitRowResult> {
  const summary = item.summary?.trim() ?? "";
  if (!summary) {
    return {
      date: item.date,
      status: "uncertain",
      reason: "Summary is empty.",
      source: "skipped",
    };
  }

  const heuristic = evaluateStorylineFitHeuristic(selectedLeaf, summary);
  const currentTopics = extractTopicLabelsFromCategories(item.topic_categories);
  const agent = await suggestTopicsWithAgent({
    date: item.date,
    summary,
    tags: item.tags ?? [],
    currentTopics,
    expectedLeaf: selectedLeaf,
    requireLlm: true,
  });

  const agentSuggestions = uniqueLeaves(
    [agent.recommended, ...agent.alternates, ...agent.proposed],
    selectedLeaf,
  );

  if (heuristic.conflict) {
    return heuristicMismatch(selectedLeaf, item, heuristic, agentSuggestions);
  }

  if (agent.source !== "llm") {
    return {
      date: item.date,
      status: "ok",
      reason: "Passed leaf exclude rules; LLM skipped or unavailable.",
      source: "rules",
    };
  }

  const recommended = agent.recommended;
  if (recommended && leafMatches(recommended, selectedLeaf)) {
    return {
      date: item.date,
      status: "ok",
      reason: agent.reason || undefined,
      source: "llm",
    };
  }

  const suggestions = uniqueLeaves(agentSuggestions, selectedLeaf).slice(0, 3);

  if (recommended && !leafMatches(recommended, selectedLeaf)) {
    return {
      date: item.date,
      status: agent.confidence === "low" ? "uncertain" : "mismatch",
      reason:
        agent.reason ||
        `Suggested ${formatTopicLeafWithGroup(recommended)} instead of ${formatTopicLeafWithGroup(selectedLeaf)}.`,
      suggestedLeaves: suggestions.length > 0 ? suggestions : [recommended],
      source: "llm",
    };
  }

  return {
    date: item.date,
    status: "uncertain",
    reason: agent.reason || "Could not confirm this storyline fit.",
    suggestedLeaves: suggestions.length > 0 ? suggestions : undefined,
    source: "llm",
  };
}

export async function runStorylineFitBatch(
  topicLeaf: string,
  items: StorylineFitInputItem[],
): Promise<StorylineFitBatchResult> {
  const trimmedLeaf = topicLeaf.trim();
  if (!trimmedLeaf) {
    throw new Error("topicLeaf is required");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items array is required");
  }
  if (items.length > MAX_ITEMS) {
    throw new Error(`Cannot check more than ${MAX_ITEMS} rows at once`);
  }
  if (!isTopicAgentEnabled()) {
    throw new Error("Storyline check requires OPENAI_API_KEY — Topic Agent is disabled.");
  }

  const results: Record<string, StorylineFitRowResult> = {};

  for (const item of items) {
    try {
      results[item.date] = await agentPass(trimmedLeaf, item);
    } catch (error) {
      results[item.date] = {
        date: item.date,
        status: "uncertain",
        reason: error instanceof Error ? error.message : "Storyline agent failed",
        source: "skipped",
      };
    }
  }

  let ok = 0;
  let mismatch = 0;
  let uncertain = 0;
  for (const row of Object.values(results)) {
    if (row.status === "ok") ok += 1;
    else if (row.status === "mismatch") mismatch += 1;
    else uncertain += 1;
  }

  return {
    topicLeaf: trimmedLeaf,
    topicLeafLabel: formatTopicLeafWithGroup(trimmedLeaf),
    scanned: items.length,
    ok,
    mismatch,
    uncertain,
    results,
  };
}

/** Heuristic-only pass for dry runs without API calls. */
export function runStorylineFitHeuristicDryRun(
  topicLeaf: string,
  items: StorylineFitInputItem[],
): StorylineFitBatchResult {
  const trimmedLeaf = topicLeaf.trim();
  const results: Record<string, StorylineFitRowResult> = {};

  for (const item of items) {
    const summary = item.summary?.trim() ?? "";
    if (!summary) {
      results[item.date] = {
        date: item.date,
        status: "uncertain",
        reason: "Summary is empty.",
        source: "skipped",
      };
      continue;
    }

    const heuristic = evaluateStorylineFitHeuristic(trimmedLeaf, summary);
    if (heuristic.conflict) {
      results[item.date] = heuristicMismatch(trimmedLeaf, item, heuristic);
      continue;
    }

    results[item.date] = {
      date: item.date,
      status: "ok",
      reason: "Heuristic: no exclude conflict detected.",
      source: "rules",
    };
  }

  let ok = 0;
  let mismatch = 0;
  let uncertain = 0;
  for (const row of Object.values(results)) {
    if (row.status === "ok") ok += 1;
    else if (row.status === "mismatch") mismatch += 1;
    else uncertain += 1;
  }

  return {
    topicLeaf: trimmedLeaf,
    topicLeafLabel: formatTopicLeafWithGroup(trimmedLeaf),
    scanned: items.length,
    ok,
    mismatch,
    uncertain,
    results,
  };
}

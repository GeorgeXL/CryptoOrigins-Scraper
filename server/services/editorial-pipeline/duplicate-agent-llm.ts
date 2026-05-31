import OpenAI from "openai";
import { z } from "zod";
import { getModelForAgent } from "./model-config";
import { AGENT_REASON_MAX, trimAgentReason } from "./agent-reason";
import type { TaxonomyDuplicateNeighbor } from "./tools";
import { summariesHaveDistinctMilestoneNumbers } from "./tools";

const duplicateVerdictSchema = z.object({
  is_duplicate: z.boolean(),
  confidence: z.number().min(0).max(1),
  canonical_date: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
  reason: z.string().max(AGENT_REASON_MAX).default(""),
});

export type DuplicateAgentVerdict = z.infer<typeof duplicateVerdictSchema>;

export function isDuplicateAgentLlmEnabled(): boolean {
  if (process.env.EDITORIAL_DUPLICATE_LLM === "0") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function parseVerdict(raw: string): DuplicateAgentVerdict | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) text = fence[1].trim();
  try {
    return duplicateVerdictSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Semantic duplicate check when taxonomy overlap is suspicious but below hard Jaccard thresholds. */
export async function evaluateSemanticDuplicateForDay(opts: {
  date: string;
  summary: string;
  neighbor: TaxonomyDuplicateNeighbor;
}): Promise<
  | { status: "skipped"; reason: string }
  | { status: "duplicate"; verdict: DuplicateAgentVerdict; neighborDate: string }
  | { status: "ok"; verdict: DuplicateAgentVerdict }
> {
  if (!isDuplicateAgentLlmEnabled()) {
    return { status: "skipped", reason: "Duplicate LLM disabled" };
  }
  const summary = opts.summary.trim();
  if (summary.length < 30) {
    return { status: "skipped", reason: "Summary too short" };
  }

  if (summariesHaveDistinctMilestoneNumbers(summary, opts.neighbor.summaryPreview)) {
    return {
      status: "ok",
      verdict: {
        is_duplicate: false,
        confidence: 0.92,
        reason: "Distinct milestone numbers",
      },
    };
  }

  const system = `You detect whether two calendar-day summaries describe the SAME historical news event (duplicate slot).
The focal day may be a misplaced copy of the neighbor day. Use summary text and shared tags/topics only.
Different numeric milestones are NOT duplicates (e.g. hash rate 80 quintillion on one date vs 100 quintillion on another).
Return JSON only: {"is_duplicate":boolean,"confidence":number 0-1,"canonical_date":"YYYY-MM-DD"|null,"reason":string}
Set reason to "" (preferred) or at most 6 words — internal only. Set canonical_date to the neighbor date when the story clearly belongs there, not on focal date.`;

  const userPayload = JSON.stringify({
    focal_date: opts.date,
    focal_summary: summary,
    neighbor_date: opts.neighbor.date,
    neighbor_summary_preview: opts.neighbor.summaryPreview,
    shared_tags: opts.neighbor.sharedTags,
    shared_topics: opts.neighbor.sharedTopics,
    token_jaccard: opts.neighbor.tokenJaccard,
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await openai.chat.completions.create({
      model: getModelForAgent("DuplicateCheckerAgent"),
      temperature: 0.05,
      max_completion_tokens: 180,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPayload },
      ],
    });
    const verdict = parseVerdict(completion.choices[0]?.message?.content ?? "");
    if (!verdict) return { status: "skipped", reason: "Invalid duplicate agent JSON" };
    verdict.reason = trimAgentReason(verdict.reason);

    if (verdict.is_duplicate && verdict.confidence >= 0.72) {
      return { status: "duplicate", verdict, neighborDate: opts.neighbor.date };
    }
    return { status: "ok", verdict };
  } catch (err) {
    return { status: "skipped", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Borderline neighbors worth a semantic LLM pass (below hard auto-queue threshold). */
export function isBorderlineDuplicateNeighbor(n: TaxonomyDuplicateNeighbor): boolean {
  if (n.tokenJaccard >= 0.76 && n.sharedTags.length >= 2) return false;
  return (
    (n.tokenJaccard >= 0.52 && n.sharedTags.length >= 2) ||
    (n.tokenJaccard >= 0.48 && n.sharedTopics.length >= 1 && n.sharedTags.length >= 1)
  );
}

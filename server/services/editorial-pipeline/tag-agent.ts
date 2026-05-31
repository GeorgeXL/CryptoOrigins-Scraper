import OpenAI from "openai";
import { z } from "zod";
import { getModelForAgent } from "./model-config";
import { AGENT_REASON_MAX, trimAgentReason } from "./agent-reason";
import { isRoundupMultiStorySummary } from "./editorial-quality";
import {
  isEditorialEntityTagCandidate,
  editorialTagKey,
  filterEditorialTagAdds,
  preferredEditorialTagDisplay,
} from "./editorial-tag-rules";
import { isTagGroundedInTexts } from "./tag-grounding";

export type TagAgentConfidence = "high" | "medium" | "low";

export type TagAgentInput = {
  date: string;
  summary: string;
  tags: string[];
  allowedAddCandidates?: string[];
};

export type TagAgentResult = {
  source: "llm" | "skipped";
  confidence: TagAgentConfidence;
  addTags: string[];
  dropTags: string[];
  reason: string;
};

const tagAgentResponseSchema = z.object({
  add_tags: z.array(z.string()).max(8).default([]),
  drop_tags: z.array(z.string()).max(8).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().max(AGENT_REASON_MAX).default(""),
});

export function isTagAgentEnabled(): boolean {
  if (process.env.TAG_AGENT_DISABLED === "1") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function parseTagAgentJson(raw: string): z.infer<typeof tagAgentResponseSchema> | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) text = fence[1].trim();
  try {
    return tagAgentResponseSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function normalizeTagList(tags: string[], currentKeys: Set<string>, currentTags: string[], summary: string): string[] {
  const filtered = filterEditorialTagAdds(tags, currentTags);
  const out: string[] = [];
  for (const raw of filtered) {
    const t = raw.trim();
    if (!t || !isEditorialEntityTagCandidate(t)) continue;
    if (!isTagGroundedInTexts(t, [summary])) continue;
    const key = editorialTagKey(t);
    if (!key || currentKeys.has(key)) continue;
    const display = preferredEditorialTagDisplay(t);
    if (!out.some((x) => editorialTagKey(x) === key)) out.push(display);
  }
  return out.slice(0, 6);
}

/** LLM tag add/drop suggestions grounded in summary (entity tags only). */
export async function suggestTagsWithAgent(input: TagAgentInput): Promise<TagAgentResult> {
  const summary = input.summary.trim();
  const tags = input.tags.filter(Boolean);
  if (!summary || summary.length < 20) {
    return { source: "skipped", confidence: "low", addTags: [], dropTags: [], reason: "Summary too short" };
  }
  if (isRoundupMultiStorySummary(summary)) {
    return {
      source: "skipped",
      confidence: "high",
      addTags: [],
      dropTags: [],
      reason: "Roundup summary — pick one article first",
    };
  }
  if (!isTagAgentEnabled()) {
    return { source: "skipped", confidence: "low", addTags: [], dropTags: [], reason: "Tag Agent disabled" };
  }

  const currentKeys = new Set(tags.map((t) => editorialTagKey(t)).filter(Boolean));
  const system = `You propose entity tag adds and drops for a historical news day row.
Use ONLY concrete named entities (people, companies, protocols, products, places) grounded in the SUMMARY.
Do NOT tag abstract themes (regulation, adoption, market, price action).
Do NOT tag sentiment or outlook (optimism, pessimism, confidence, uncertainty, bullish, bearish).
Do NOT tag network processes or recurring mechanics (halving, mining, hashrate, block reward, adoption, protocol, derivatives, futures) — use Bitcoin plus companies/places instead.
Do NOT tag English verbs or generic nouns that only appear in passing (cites, cities, community, batching, spam). Acronyms need exact casing in the summary (CITES ≠ cites).
Do NOT tag political-era phrases (Obama administration, Biden era, Trump presidency) — tag the person or agency if needed.
Do NOT tag role or demographic groups (miners, Chinese miners, traders, investors) — use country/company tags only.
Do NOT add nationality+role compounds when the country is already in current_tags.
Use full person names when both appear in the summary (Warren Buffett, Bill Gates). Do NOT add surname-only fragments (Buffett, Gates) when the full name is available.
Do NOT tag group labels (crypto community, bitcoin community) — tag concrete people, companies, or places instead.
Do NOT tag date-prefixed headline fragments (2015-12-31 wallet fixes), weekly-digest labels, or generic tech/policy phrases (android, inflation, monetary policy, hard fork, web-wallet, virtual currency, mempool, greylisting).
Do NOT tag product categories or OS names (android, ledger as generic noun) — only named companies/products when the exact brand appears in the summary (Ledger, Android as Google product only if explicitly named).
If the summary is a weekly roundup (semicolons or multiple unrelated stories in one line), return empty add_tags and drop_tags.
Only add tags whose exact name or normal wording appears in the SUMMARY text. Do NOT use outside knowledge to fill in article details missing from the summary.
Prefer singular entity labels when both work (Bitcoin ATM not Bitcoin ATMs).
Do NOT invent tags not supported by the summary text.
Return JSON only: {"add_tags":string[],"drop_tags":string[],"confidence":"high"|"medium"|"low","reason":string}
Set reason to "" (preferred) or at most 6 words — internal only, not shown to editors.`;

  const userPayload = JSON.stringify({
    calendar_date: input.date,
    summary,
    current_tags: tags,
    add_candidates: (input.allowedAddCandidates ?? []).slice(0, 12),
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await openai.chat.completions.create({
      model: getModelForAgent("TagManagerAgent"),
      temperature: 0.05,
      max_completion_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPayload },
      ],
    });
    const parsed = parseTagAgentJson(completion.choices[0]?.message?.content ?? "");
    if (!parsed) {
      return { source: "skipped", confidence: "low", addTags: [], dropTags: [], reason: "Invalid Tag Agent JSON" };
    }

    const dropTags = parsed.drop_tags
      .filter((t) => currentKeys.has(editorialTagKey(t)))
      .slice(0, 6);
    const addTags = normalizeTagList(parsed.add_tags, currentKeys, tags, summary);

    return {
      source: "llm",
      confidence: parsed.confidence,
      addTags,
      dropTags,
      reason: trimAgentReason(parsed.reason),
    };
  } catch (err) {
    return {
      source: "skipped",
      confidence: "low",
      addTags: [],
      dropTags: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

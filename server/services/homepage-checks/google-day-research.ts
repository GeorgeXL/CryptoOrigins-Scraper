/**
 * Google Search grounding fallback for weak Exa candidate pools.
 * Mirrors the Perplexity day-research waterfall but uses Gemini + Google Search.
 */

import { z } from "zod";

import { aiService } from "../ai";
import {
  buildTierPrompt,
  evaluateResearchAcceptance,
  pickBestCitationUrl,
  runResearchWaterfall,
  TIER_SYSTEM_PROMPT,
  type DayResearchResult,
  type ResearchTier,
} from "./perplexity-day-research";

const tierResponseSchema = z.object({
  found: z.boolean(),
  eventDate: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  sourceTitle: z.string().nullable().optional(),
  eventSnippet: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  reasoning: z.string().optional(),
  citations: z.array(z.string()).optional(),
});

async function callGoogleResearchTier(
  date: string,
  tier: ResearchTier,
  opts?: { priorSummary?: string; topicLeaf?: string | null },
): Promise<DayResearchResult> {
  const gemini = aiService.getProvider("gemini");
  if (!("generateJson" in gemini) || typeof gemini.generateJson !== "function") {
    throw new Error("Gemini provider is not available for Google day research");
  }

  const prompt = buildTierPrompt(date, tier, opts);
  const parsed = await gemini.generateJson<z.infer<typeof tierResponseSchema>>({
    prompt,
    systemPrompt: `${TIER_SYSTEM_PROMPT} Use Google Search to verify dates and sources.`,
    maxTokens: 900,
    temperature: 0.1,
    context: "google-day-research-tier",
    purpose: `Google research ${tier} tier event for ${date}`,
    grounding: true,
    schema: tierResponseSchema,
  });

  const citations: string[] = [];
  if (parsed.sourceUrl) citations.push(parsed.sourceUrl);
  if (Array.isArray(parsed.citations)) citations.push(...parsed.citations);

  const sourceUrl = pickBestCitationUrl(citations);
  const confidence = parsed.confidence ?? "low";
  const acceptance = evaluateResearchAcceptance({
    targetDate: date,
    found: parsed.found,
    confidence,
    eventDate: parsed.eventDate ?? null,
    eventTitle: parsed.eventTitle ?? null,
    eventSnippet: parsed.eventSnippet ?? null,
    reasoning: parsed.reasoning ?? null,
    sourceUrl,
  });

  return {
    found: acceptance.accepted,
    tier: acceptance.accepted ? tier : null,
    eventTitle: parsed.eventTitle?.trim() || null,
    sourceUrl: acceptance.accepted ? sourceUrl : null,
    sourceTitle: parsed.sourceTitle?.trim() || null,
    eventSnippet: parsed.eventSnippet?.trim() || null,
    confidence,
    reasoning: acceptance.accepted
      ? parsed.reasoning?.trim() || ""
      : acceptance.reasons.join("; ") || parsed.reasoning?.trim() || "",
    citations: [...new Set(citations.filter(Boolean))],
  };
}

export async function researchSignificantEventForDateWithGoogle(
  date: string,
  opts?: { priorSummary?: string; topicLeaf?: string | null },
): Promise<DayResearchResult> {
  return runResearchWaterfall(date, opts, (tier) => callGoogleResearchTier(date, tier, opts));
}

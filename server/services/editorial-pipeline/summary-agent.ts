import OpenAI from "openai";
import { z } from "zod";
import { getModelForAgent } from "./model-config";
import { AGENT_REASON_MAX, trimAgentReason } from "./agent-reason";
import {
  evaluateSummaryQuality,
  isEditorialSummaryWeak,
  isRoundupMultiStorySummary,
  isValidPipelineTopArticleId,
  normalizeEditorialSummaryText,
  summaryOmitsNamedOrganization,
  summaryNeedsBetterArticleSource,
} from "./editorial-quality";
import type { KnownEventContext } from "./known-event-context";

export type SummaryAgentConfidence = "high" | "medium" | "low";

export type SummaryAgentResult = {
  source: "llm" | "rules" | "skipped";
  confidence: SummaryAgentConfidence;
  publishable: boolean;
  needsRegeneration: boolean;
  issues: string[];
  reason: string;
  suggestedSummary: string | null;
};

const summaryVerdictSchema = z.object({
  publishable: z.boolean(),
  needs_regeneration: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  issues: z.array(z.string().max(60)).max(8).default([]),
  reason: z.string().max(AGENT_REASON_MAX).default(""),
  suggested_summary: z.union([z.string(), z.null()]).optional(),
});

export function isSummaryAgentEnabled(): boolean {
  if (process.env.SUMMARY_AGENT_DISABLED === "1") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function rulesFallback(summary: string, extra?: string): SummaryAgentResult {
  const issue = evaluateSummaryQuality(summary);
  const weak = issue != null;
  return {
    source: "rules",
    confidence: weak ? "medium" : "high",
    publishable: !weak,
    needsRegeneration: weak && summary.length > 0,
    issues: issue ? [issue.message] : [],
    reason: extra ?? (issue ? issue.message : "Summary passes 100–110 character rules."),
    suggestedSummary: null,
  };
}

function normalizeSuggestedSummary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = normalizeEditorialSummaryText(raw);
  if (t.length < 100 || t.length > 110) return null;
  return t;
}

/** LLM editorial summary check + optional inline fix suggestion. */
export async function evaluateSummaryWithAgent(input: {
  date: string;
  summary: string;
  articleTitle?: string | null;
  articleSnippet?: string | null;
  topArticleId?: string | null;
  knownEvent?: KnownEventContext | null;
}): Promise<SummaryAgentResult> {
  const summary = input.summary.trim();
  if (!summary) return rulesFallback(summary, "Summary is empty.");

  const ruleIssue = evaluateSummaryQuality(summary);
  const knownEvent = input.knownEvent?.isKnownEvent ? input.knownEvent : null;

  if (
    !knownEvent &&
    !ruleIssue &&
    summaryOmitsNamedOrganization(summary, input.articleSnippet)
  ) {
    return {
      source: "rules",
      confidence: "high",
      publishable: false,
      needsRegeneration: true,
      issues: ["Summary omits named organization"],
      reason: "Article names the company; summary should too",
      suggestedSummary: null,
    };
  }

  if (!knownEvent && !ruleIssue && summaryNeedsBetterArticleSource(summary, input.topArticleId, {
    title: input.articleTitle,
    snippet: input.articleSnippet,
  })) {
    return {
      source: "rules",
      confidence: "high",
      publishable: false,
      needsRegeneration: true,
      issues: [isRoundupMultiStorySummary(summary) ? "Roundup multi-story summary" : "Summary is generic marketing/blog copy"],
      reason: "Pick a single dated news article first",
      suggestedSummary: null,
    };
  }

  if (!isSummaryAgentEnabled()) {
    if (knownEvent && !ruleIssue) {
      return {
        source: "rules",
        confidence: "high",
        publishable: true,
        needsRegeneration: false,
        issues: [],
        reason: "Known/manual event summary passes 100–110 character rules.",
        suggestedSummary: null,
      };
    }
    return rulesFallback(summary);
  }

  const system = knownEvent
    ? `You review a KNOWN HISTORICAL EVENT timeline day — no news article is required.
The operator curated this date as a canonical milestone, manual entry, or known marker.
Validate the one-line summary (100–110 chars, active voice, no date tokens, no trailing period, capitalize Bitcoin and other proper names) against the canonical reference text.
Do NOT reject solely because top_article_id or article snippet is missing.
Do NOT nitpick minor phrasing if the summary correctly states what happened on this calendar date.
Set needs_regeneration=true only for clear factual mismatch with the reference or length violations.
Return JSON only: {"publishable":boolean,"needs_regeneration":boolean,"confidence":"high"|"medium"|"low","issues":string[],"reason":string,"suggested_summary":string|null}
Set reason to "" (preferred) or at most 6 words — internal only. issues: short labels only (max 8 words each). suggested_summary only when you can rewrite to 100–110 chars using the reference.`
    : `You review a historical timeline one-line summary (100–110 chars, active voice, no date tokens, no trailing period).
One event only — never compress multiple headlines into one line. Forbidden symbols: ; : ? " - " | — – / & "
Capitalize proper names (Bitcoin, Ethereum, Coinbase, PayPal, Lightning Network). Never write "bitcoin" for the asset/network.
Judge whether it is publishable for the calendar date and winning article context.
If article_snippet names a specific company but the summary only says "firm", "company", etc., set needs_regeneration=true and name the organization in suggested_summary when you can fit 100–110 chars.
Return JSON only: {"publishable":boolean,"needs_regeneration":boolean,"confidence":"high"|"medium"|"low","issues":string[],"reason":string,"suggested_summary":string|null}
Set reason to "" (preferred) or at most 6 words — internal only. issues: short labels only (max 8 words each). Set needs_regeneration=true when length is wrong OR the line misstates the event OR it hides a named organization from the article. suggested_summary only when you can rewrite to 100–110 chars without reading full article text.`;

  const userPayload = JSON.stringify({
    calendar_date: input.date,
    summary,
    summary_length: summary.length,
    known_event: knownEvent
      ? {
          kind: knownEvent.kind,
          label: knownEvent.label,
          reference: knownEvent.referenceText,
        }
      : null,
    top_article_id: input.topArticleId ?? null,
    article_title: input.articleTitle?.slice(0, 200) ?? null,
    article_snippet: input.articleSnippet?.slice(0, 400) ?? null,
    rule_issue: ruleIssue?.message ?? null,
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const completion = await openai.chat.completions.create({
      model: getModelForAgent("SummaryAgent"),
      temperature: 0.1,
      max_completion_tokens: 280,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPayload },
      ],
    });
    const parsed = summaryVerdictSchema.safeParse(
      JSON.parse(completion.choices[0]?.message?.content ?? "{}"),
    );
    if (!parsed.success) return rulesFallback(summary, "Summary Agent returned invalid JSON.");

    const suggested = normalizeSuggestedSummary(parsed.data.suggested_summary ?? null);
    const publishable = parsed.data.publishable && !ruleIssue;
    const needsRegeneration =
      Boolean(ruleIssue) ||
      isEditorialSummaryWeak(summary) ||
      (parsed.data.needs_regeneration && !(knownEvent && publishable && parsed.data.confidence === "high"));
    return {
      source: "llm",
      confidence: parsed.data.confidence,
      publishable,
      needsRegeneration,
      issues: [
        ...(ruleIssue ? [ruleIssue.message] : []),
        ...parsed.data.issues.filter((x) => !ruleIssue?.message.includes(x)),
      ],
      reason: trimAgentReason(parsed.data.reason),
      suggestedSummary: suggested,
    };
  } catch (err) {
    return rulesFallback(summary, err instanceof Error ? err.message : String(err));
  }
}

/** Regenerate summary from top article with up to 3 length retries. */
export async function regenerateSummaryWithAgent(date: string): Promise<{
  ok: boolean;
  summaryLength?: number;
  message?: string;
}> {
  const { storage } = await import("../../storage");
  const analysis = await storage.getAnalysisByDate(date);
  if (!analysis) return { ok: false, message: `No analysis row for ${date}` };
  if (!isValidPipelineTopArticleId(analysis.topArticleId)) {
    return { ok: false, message: "Top article id missing or invalid" };
  }

  const { resolveStoredWinningArticle } = await import("./run");
  const resolved = resolveStoredWinningArticle({
    topArticleId: analysis.topArticleId,
    tieredArticles: analysis.tieredArticles,
    analyzedArticles: analysis.analyzedArticles,
    winningTier: analysis.winningTier,
  });
  if (!resolved) {
    return {
      ok: false,
      message:
        "Winning article missing from stored payloads (not in tiered or analyzed articles). Re-pick the article or re-fetch that day.",
    };
  }
  const { article: selected, tier } = resolved;

  const { generateSummaryWithOpenAI } = await import("../analysis-modes");
  const requestId = `summary-agent-regen-${date}-${Date.now()}`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const out = await generateSummaryWithOpenAI(selected.id, [selected], date, tier, `${requestId}-${attempt}`);
    const quality = evaluateSummaryQuality(out.summary);
    if (!quality) {
      await storage.updateAnalysis(date, { summary: out.summary });
      return { ok: true, summaryLength: out.summary.length };
    }
  }

  return { ok: false, message: "Regeneration failed to produce 100–110 character summary after 3 attempts" };
}

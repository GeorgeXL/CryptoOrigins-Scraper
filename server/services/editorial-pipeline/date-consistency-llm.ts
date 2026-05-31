import OpenAI from "openai";
import { z } from "zod";
import { getModelForAgent } from "./model-config";
import { detectCanonicalDateMismatch, getEditorialDuplicateNeighborContext, summariesHaveDistinctMilestoneNumbers } from "./tools";

const dateConsistencyVerdictSchema = z.object({
  plausible: z.boolean(),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string()).max(12).default([]),
  duplicateOfDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
});

export type DateConsistencyLlmVerdict = z.infer<typeof dateConsistencyVerdictSchema>;

export type DateConsistencyLlmResult =
  | { status: "skipped"; reason: string }
  | { status: "canonical"; expectedDate: string; ruleId: string; reason: string }
  | { status: "ok"; verdict: DateConsistencyLlmVerdict }
  | { status: "mismatch"; verdict: DateConsistencyLlmVerdict; duplicateOfDate: string | null; issues: string[] };

function parseDateConsistencyVerdict(raw: string): DateConsistencyLlmVerdict | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) text = fence[1].trim();
  try {
    return dateConsistencyVerdictSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function isDateConsistencyLlmEnabled(): boolean {
  if (process.env.EDITORIAL_V3_DATE_LLM === "0") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Regex canonical rules first, then optional LLM calendar + wrong-slot check. */
export async function evaluateDateConsistencyForDay(opts: {
  date: string;
  analysisId: string;
  summary: string;
}): Promise<DateConsistencyLlmResult> {
  const summary = opts.summary.trim();
  if (summary.length < 20) {
    return { status: "skipped", reason: "Summary too short for calendar check" };
  }

  const canonical = detectCanonicalDateMismatch(summary, opts.date);
  if (canonical) {
    return {
      status: "canonical",
      expectedDate: canonical.expectedDate,
      ruleId: canonical.ruleId,
      reason: canonical.reason,
    };
  }

  if (!isDateConsistencyLlmEnabled()) {
    return { status: "skipped", reason: "Date LLM check disabled or OPENAI_API_KEY missing" };
  }

  const dupContext =
    (await getEditorialDuplicateNeighborContext({
      date: opts.date,
      analysisId: opts.analysisId,
    })) ?? { focalTags: [], focalTopics: [], focalSummaryPreview: "", neighbors: [] };

  const system = `You verify whether a short "day in history" summary plausibly belongs on a given calendar date.
You do NOT have access to source articles — use only public knowledge, the focal summary, focal tags/topics, and the taxonomy_neighbors list (other days' summaries are short previews only; same DB metadata editors see).
1) Calendar fit: set plausible=false when the narrative clearly anchors a different famous calendar date (wrong year/month/day) than calendar_date.
2) Wrong-slot / duplicate: when taxonomy_neighbors shows another date that shares tags/topics with the focal row and the neighbor_summary_preview reads like the SAME story that is historically tied to that neighbor date (not the focal date), set plausible=false and duplicateOfDate to that neighbor's date (YYYY-MM-DD). If overlap is coincidental (e.g. generic "Bitcoin rally" on many days), keep plausible=true and duplicateOfDate=null. Hash-rate, price, or ATH milestones with different numbers (e.g. 80 quintillion vs 100 quintillion) are distinct events on different dates — not duplicates.
2b) Legislative passage: when both dates describe the same bill/house vote (e.g. NH Bill 436, "House passes"), the earlier calendar_date is usually the vote date; later-date rows are often duplicate follow-up coverage — prefer plausible=true on the earlier date and flag the later slot as duplicate, not the reverse. If one summary mixes unrelated topics (e.g. cannabis + bitcoin in one line), that is conflation on that date — not proof the story belongs on the later date.
3) Otherwise plausible=true.
Return JSON only: {"plausible":boolean,"confidence":number between 0 and 1,"issues":string[],"duplicateOfDate":string YYYY-MM-DD or null}. Omit duplicateOfDate or use null when not a duplicate.`;

  const userPayload = JSON.stringify({
    calendar_date: opts.date,
    summary,
    focal_tags: dupContext.focalTags,
    focal_topics: dupContext.focalTopics,
    taxonomy_neighbors: dupContext.neighbors.map((n) => ({
      date: n.date,
      shared_tags: n.sharedTags,
      shared_topics: n.sharedTopics,
      token_jaccard: n.tokenJaccard,
      neighbor_summary_preview: n.summaryPreview,
    })),
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let verdict: DateConsistencyLlmVerdict | null = null;

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const completion = await openai.chat.completions.create({
        model: getModelForAgent("DateConsistencyAgent"),
        temperature: 0.05,
        max_completion_tokens: 720,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content:
              userPayload +
              (attempt === 2
                ? "\n\nYour previous reply was not valid JSON with plausible, confidence, issues, and duplicateOfDate (YYYY-MM-DD or null). Reply with ONLY valid JSON."
                : ""),
          },
        ],
      });
      verdict = parseDateConsistencyVerdict(completion.choices[0]?.message?.content ?? "");
      if (verdict) break;
    }
  } catch (err) {
    return {
      status: "skipped",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (!verdict) {
    return { status: "skipped", reason: "Could not parse date-consistency model JSON" };
  }

  const dupDate =
    typeof verdict.duplicateOfDate === "string" && verdict.duplicateOfDate.length === 10
      ? verdict.duplicateOfDate
      : null;
  const duplicateMismatch = dupDate != null && dupDate !== opts.date;
  if (duplicateMismatch && dupDate) {
    const neighbor = dupContext.neighbors.find((n) => n.date === dupDate);
    if (neighbor && summariesHaveDistinctMilestoneNumbers(summary, neighbor.summaryPreview)) {
      return { status: "ok", verdict: { ...verdict, plausible: true, duplicateOfDate: null, issues: [] } };
    }
  }
  const effectivePlausible = verdict.plausible && !duplicateMismatch;
  const issues = [...verdict.issues];
  if (duplicateMismatch && !issues.some((x) => x.includes(dupDate!))) {
    issues.push(`Taxonomy neighbor ${dupDate} may be the canonical home for this story`);
  }

  if (!effectivePlausible && verdict.confidence >= 0.65) {
    return {
      status: "mismatch",
      verdict,
      duplicateOfDate: duplicateMismatch ? dupDate : null,
      issues: issues.length ? issues : ["Model flagged calendar or duplicate mismatch"],
    };
  }

  return { status: "ok", verdict };
}

/** Operator-facing one-liner for calendar mismatch queue rows. */
export function formatCalendarDecisionExplanation(opts: {
  ruleId: string;
  currentDate: string;
  expectedDate: string;
  canonicalReason?: string;
  llmIssues?: string[];
  neighborSummaryPreview?: string | null;
}): string {
  if (opts.canonicalReason?.trim()) {
    return opts.canonicalReason.trim();
  }

  const issues = (opts.llmIssues ?? []).map((x) => x.trim()).filter(Boolean);
  const parts: string[] = [];

  if (issues.length) {
    parts.push(issues.slice(0, 2).join("; "));
  } else if (opts.ruleId === "llm-duplicate-slot") {
    parts.push(
      `This summary looks like the same story already on ${opts.expectedDate}, not a distinct event on ${opts.currentDate}.`,
    );
  } else {
    parts.push(`The summary may belong on ${opts.expectedDate} instead of ${opts.currentDate}.`);
  }

  const neighbor = opts.neighborSummaryPreview?.trim();
  if (neighbor) {
    const clipped = neighbor.length > 110 ? `${neighbor.slice(0, 107)}…` : neighbor;
    parts.push(`On ${opts.expectedDate}: “${clipped}”`);
  }

  return parts.join(" ");
}

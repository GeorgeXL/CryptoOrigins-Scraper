import { Agent, run } from "@openai/agents";
import { and, asc, count, desc, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  historicalNewsAnalyses,
  humanReviewQueue,
  pipelineConfidenceHistory,
  pipelineEvidence,
  pipelineHandoffs,
  pipelineRuns,
  pipelineSteps,
  type ArticleData,
} from "@shared/schema";
import { isIsoDate } from "@shared/quality-check-agent-actions";
import {
  ALL_PIPELINE_CHECK_SCOPES,
  EDITORIAL_DEFAULT_MODEL,
  buildHandoffChain,
  buildHandoffPayload,
  buildStepOutput,
  type PipelineCheckScope,
  type PipelineAgentName,
  type TriageItem,
} from "./contracts";
import { triageRange, retriageSingleExistingDate } from "./triage";
import { executeAgent } from "./executors";
import { getModelForAgent } from "./model-config";
import { agentsTailFromStart, validResumeStarts } from "./slice-resume";
import { evaluateCandidateStorySanity, fetchCandidatesForDate } from "./source-finder-v2";
import type {
  ArticlePickPackage,
  ArticleCandidate,
  CalendarDecisionPackage,
  CorrectionApprovalPackage,
  CorrectionProposal,
  DuplicateDecisionPackage,
  RemovedDayContext,
} from "./review-package";
import {
  detectCanonicalDateMismatch,
  getEditorialDuplicateNeighborContext,
  normalizedTagsFromRow,
  summaryTokenJaccardForDuplicateCheck,
  topicLabelsFromRow,
} from "./tools";
import { buildCorrectionProposals, buildCorrectionProposalsAsync } from "./proposals";
import { evaluateDateConsistencyForDay, formatCalendarDecisionExplanation } from "./date-consistency-llm";
import { formatDuplicateQueueNote } from "./agent-reason";
import {
  isStrongDuplicateNeighbor,
  splitCorrectionProposalsForAutoApply,
} from "./corpus-clean";
import {
  evaluateSemanticDuplicateForDay,
  isBorderlineDuplicateNeighbor,
} from "./duplicate-agent-llm";
import {
  evaluateRelevanceWithAgent,
  relevanceOperatorNote,
  relevanceRequiresArticlePick,
} from "./relevance-agent";
import {
  badWinnerOperatorNote,
  isRoundupArticleContent,
  isRoundupMultiStorySummary,
  summaryNeedsBetterArticleSource,
} from "./editorial-quality";
import {
  shouldUseGatedArticlePick,
  shouldUseUnifiedExistingDayClean,
} from "./unified-pipeline";
import { loadCanonicalTagIndex } from "./tag-grounding";
import { applyCorrectionProposals } from "./approved-writer";
import { invalidTopicReasons } from "./topic-validation";

const controllers = new Map<string, AbortController>();
const EDITORIAL_PIPELINE_ENABLED = process.env.EDITORIAL_PIPELINE_ENABLED !== "0";

/** When not `"0"`, stop the per-day agent chain after the first `rejected` or `error` step (closed-loop behavior). */
const EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT =
  process.env.EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT !== "0";

/**
 * When `"1"`, empty/missing days bypass the legacy SourceFinderAgent (which
 * silently summarizes everything in one shot) and instead emit an article-pick
 * review package: Exa-only candidate pool, no LLM summary, no tags, no topics.
 * The operator must choose an article first; summarization runs on approval.
 */
const EDITORIAL_PIPELINE_V3_GATED_FETCH = process.env.EDITORIAL_PIPELINE_V3_GATED_FETCH === "1";
const STORYLINE_REVIEW_MIN_BETTER_CANDIDATE_SCORE = 0.74;
const STORYLINE_REVIEW_MIN_SCORE_GAP = 0.24;
const STORYLINE_REVIEW_GOOD_CURRENT_SCORE = 0.44;
const STORYLINE_REVIEW_STRONG_REPLACEMENT_SCORE = 0.88;
const STORYLINE_REVIEW_COLLISION_WINDOW_DAYS = 10;

function splitAutomaticCorrectionProposals(proposals: CorrectionProposal[]): {
  automatic: CorrectionProposal[];
  manual: CorrectionProposal[];
} {
  return splitCorrectionProposalsForAutoApply(proposals);
}

async function applyAutomaticCorrectionProposals(opts: {
  date: string;
  proposals: CorrectionProposal[];
}): Promise<string[]> {
  if (opts.proposals.length === 0) return [];
  const result = await applyCorrectionProposals({
    date: opts.date,
    proposals: opts.proposals,
    acceptedIds: opts.proposals.map((proposal) => proposal.id),
    reviewer: "pipeline:auto",
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.applied;
}

type StartOpts = {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
  checkScopes?: PipelineCheckScope[];
  requestedBy?: string;
  resumedFromRunId?: string;
  /** Limit processing to explicit calendar days (quality-check bulk runs). */
  targetDates?: string[];
  /** Re-run only a suffix of agents for one calendar date (must match `dateFrom`/`dateTo` for that day). */
  partialRun?: { date: string; agents: PipelineAgentName[] };
  /** When a day was cleared before this run (e.g. calendar conflict removal). */
  removedDayContext?: RemovedDayContext;
};

function normalizeCheckScopes(scopes: PipelineCheckScope[] | undefined): Set<PipelineCheckScope> {
  const selected = scopes && scopes.length > 0 ? scopes : ALL_PIPELINE_CHECK_SCOPES;
  return new Set(selected);
}

function agentMatchesCheckScopes(agent: PipelineAgentName, scopes: Set<PipelineCheckScope>): boolean {
  if (
    agent === "MilestoneAgent" ||
    agent === "SourceFinderAgent" ||
    agent === "RelevanceCheckerAgent" ||
    agent === "VerificationAgent"
  ) {
    return scopes.has("relevance");
  }
  if (agent === "SummaryAgent") return scopes.has("summary");
  if (agent === "TopicValidatorAgent" || agent === "TopicManagerAgent" || agent === "TopicApplierAgent") {
    return scopes.has("topics");
  }
  if (agent === "TagManagerAgent" || agent === "TagApplierAgent" || agent === "TagConsistencyAgent") {
    return scopes.has("tags");
  }
  if (agent === "DuplicateCheckerAgent") return scopes.has("duplicates");
  if (agent === "DateConsistencyAgent") return scopes.has("date");
  if (agent === "FinalEditorAgent") return scopes.size === ALL_PIPELINE_CHECK_SCOPES.length;
  return false;
}

function proposalMatchesCheckScopes(proposal: CorrectionProposal, scopes: Set<PipelineCheckScope>): boolean {
  if (proposal.kind === "set_topic_categories") return true;
  if (proposal.kind === "edit_summary" || proposal.kind === "redo_summary") return scopes.has("summary");
  return scopes.has("tags");
}

function extractRejection(output: unknown): { reason?: string; suggestedAction?: string } | null {
  if (!output || typeof output !== "object") return null;
  const rej = (output as { rejection?: { reason?: string; suggestedAction?: string } }).rejection;
  if (!rej || typeof rej !== "object") return null;
  return {
    reason: typeof rej.reason === "string" ? rej.reason : undefined,
    suggestedAction: typeof rej.suggestedAction === "string" ? rej.suggestedAction : undefined,
  };
}

type SuppressedCandidateSignals = {
  ids: Set<string>;
  urls: Set<string>;
};

function parseSuppressedCandidatesFromNotes(notes: string | null | undefined): SuppressedCandidateSignals {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const text = typeof notes === "string" ? notes : "";
  const matches = text.matchAll(/candidate-suppress:id=([^;|]*);url=([^;|]*);reason=[^|]*/g);
  for (const match of matches) {
    const id = match[1]?.trim();
    const url = match[2]?.trim().toLowerCase();
    if (id) ids.add(id);
    if (url) urls.add(url);
  }
  return { ids, urls };
}

async function loadSuppressedCandidateSignals(date: string): Promise<SuppressedCandidateSignals> {
  const rows = await db
    .select({ reviewNotes: humanReviewQueue.reviewNotes })
    .from(humanReviewQueue)
    .where(eq(humanReviewQueue.eventDate, date));
  const out: SuppressedCandidateSignals = { ids: new Set<string>(), urls: new Set<string>() };
  for (const row of rows) {
    const parsed = parseSuppressedCandidatesFromNotes(row.reviewNotes);
    parsed.ids.forEach((id) => out.ids.add(id));
    parsed.urls.forEach((url) => out.urls.add(url));
  }
  return out;
}

async function hasBetterStorylineWaiver(date: string): Promise<boolean> {
  const rows = await db
    .select({ reviewNotes: humanReviewQueue.reviewNotes })
    .from(humanReviewQueue)
    .where(eq(humanReviewQueue.eventDate, date));
  return rows.some((row) => typeof row.reviewNotes === "string" && row.reviewNotes.includes("better-storyline-waived:"));
}

function filterSuppressedCandidates(
  candidates: ArticleCandidate[],
  suppressed: SuppressedCandidateSignals,
): ArticleCandidate[] {
  if (suppressed.ids.size === 0 && suppressed.urls.size === 0) return candidates;
  const filtered = candidates.filter((candidate) => {
    const id = candidate.id?.trim();
    const url = candidate.url?.trim().toLowerCase();
    if (id && suppressed.ids.has(id)) return false;
    if (url && suppressed.urls.has(url)) return false;
    return true;
  });
  filtered.forEach((candidate) => {
    candidate.recommended = false;
  });
  const nextRecommended = filtered.find((candidate) => candidate.calendarSanityOk) ?? filtered[0] ?? null;
  if (nextRecommended) {
    nextRecommended.recommended = true;
    nextRecommended.relevanceNotes = [
      "recommended after prior human rejection filter",
      ...((nextRecommended.relevanceNotes ?? []).filter(
        (note) => !/^recommended /i.test(note),
      )),
    ];
  }
  return filtered;
}

const RETRYABLE_STATUSES = new Set(["rejected", "error"]);

async function createStep(opts: {
  runId: string;
  stepIndex: number;
  agentName: PipelineAgentName;
  status: string;
  confidence?: number;
  input: unknown;
  output: unknown;
  evidence?: unknown;
  rejectionReason?: string | null;
  suggestedAction?: string | null;
}) {
  const [step] = await db
    .insert(pipelineSteps)
    .values({
      runId: opts.runId,
      stepIndex: opts.stepIndex,
      agentName: opts.agentName,
      status: opts.status,
      confidence: opts.confidence != null ? String(Math.round(opts.confidence * 100)) : null,
      input: opts.input,
      output: opts.output,
      evidence: opts.evidence,
      rejectionReason: opts.rejectionReason ?? null,
      suggestedAction: opts.suggestedAction ?? null,
    })
    .returning({ id: pipelineSteps.id });
  return step.id;
}

async function recordConfidence(runId: string, stepId: string, agentName: string, score?: number, reason?: string) {
  if (score == null) return;
  await db.insert(pipelineConfidenceHistory).values({
    runId,
    stepId,
    agentName,
    score: String(Math.round(score * 100)),
    reason: reason || null,
  });
}

async function runAgentWithRetry(
  runId: string,
  triageItem: TriageItem,
  agentName: PipelineAgentName,
  stepIndexStart: number
): Promise<{ nextStepIndex: number; lastStepId: string | null; lastStatus: string; lastOutput: unknown }> {
  const maxAttempts = 2;
  let stepIndex = stepIndexStart;
  let lastStepId: string | null = null;
  let lastStatus = "skipped";
  let lastOutput: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await executeAgent(agentName, { runId, triageItem });
    const stepId = await createStep({
      runId,
      stepIndex,
      agentName,
      status: result.status,
      confidence: result.confidence,
      input: { triageItem, attempt, model: getModelForAgent(agentName) },
      output: result.output,
      evidence: result.evidence || null,
      rejectionReason: result.output.rejection?.reason ?? null,
      suggestedAction: result.output.rejection?.suggestedAction ?? null,
    });
    await recordConfidence(runId, stepId, agentName, result.confidence, result.output.rejection?.reason);

    if (result.evidence) {
      await db.insert(pipelineEvidence).values({
        runId,
        stepId,
        sourceType: "agent-executor",
        title: `${agentName} evidence`,
        metadata: result.evidence,
      });
    }

    lastStepId = stepId;
    lastStatus = result.status;
    lastOutput = result.output;
    stepIndex += 1;
    if (!RETRYABLE_STATUSES.has(result.status) || attempt === maxAttempts) break;
  }

  return { nextStepIndex: stepIndex, lastStepId, lastStatus, lastOutput };
}

async function generateManagerNarrative(triage: TriageItem[], signal?: AbortSignal): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const counts = triage.reduce<Record<string, number>>((acc, item) => {
    acc[item.route] = (acc[item.route] || 0) + 1;
    return acc;
  }, {});
  const planner = new Agent({
    name: "NewsManager",
    model: EDITORIAL_DEFAULT_MODEL,
    instructions:
      "You are NewsManager for The Origins editorial pipeline. Summarize triage outcome in 2 concise sentences. No markdown.",
  });
  const result = await run(
    planner,
    `Triage route counts: ${JSON.stringify(counts)}. Give a short operator summary.`,
    { maxTurns: 2, signal }
  );
  return String(result.finalOutput ?? "").trim() || null;
}

/**
 * Concatenate text bodies / titles of articles stored on a day row, for
 * grounding tag candidacy checks. Caps total length so we don't blow past
 * sensible memory; the proposal layer only does substring matches so we don't
 * need full fidelity.
 */
function neighborHintsFromDuplicateContext(
  ctx: Awaited<ReturnType<typeof getEditorialDuplicateNeighborContext>> | null | undefined,
) {
  if (!ctx?.neighbors.length) return undefined;
  return ctx.neighbors.slice(0, 4).map((n) => ({
    date: n.date,
    topics: n.sharedTopics,
    summaryPreview: n.summaryPreview,
  }));
}

async function buildScopedCorrectionProposals(opts: {
  input: Parameters<typeof buildCorrectionProposals>[0];
  neighborHints?: ReturnType<typeof neighborHintsFromDuplicateContext>;
  checkScopes?: Set<PipelineCheckScope>;
}) {
  const proposals = await buildCorrectionProposalsAsync(opts.input, {
    neighborHints: opts.neighborHints,
  });
  return opts.checkScopes ? proposals.filter((p) => proposalMatchesCheckScopes(p, opts.checkScopes!)) : proposals;
}

function collectArticleTextForGrounding(
  tieredArticles: unknown,
  analyzedArticles: unknown,
  cap = 20_000,
): string {
  const out: string[] = [];
  let remaining = cap;
  const pushPart = (s: unknown) => {
    if (remaining <= 0) return;
    if (typeof s !== "string") return;
    const trimmed = s.trim();
    if (!trimmed) return;
    const slice = trimmed.slice(0, remaining);
    out.push(slice);
    remaining -= slice.length;
  };
  if (tieredArticles && typeof tieredArticles === "object") {
    for (const key of ["bitcoin", "crypto", "macro"] as const) {
      const arr = (tieredArticles as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (!a || typeof a !== "object") continue;
        const o = a as Record<string, unknown>;
        pushPart(o.title);
        pushPart(o.summary);
        pushPart(o.text);
        if (remaining <= 0) break;
      }
      if (remaining <= 0) break;
    }
  }
  if (Array.isArray(analyzedArticles) && remaining > 0) {
    for (const a of analyzedArticles) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      pushPart(o.title);
      pushPart(o.summary);
      pushPart(o.text);
      if (remaining <= 0) break;
    }
  }
  return out.join(" \n ");
}

export function currentStorylineQuality(row: {
  summary: string | null;
  tagsVersion2: unknown;
  topicCategories: unknown;
}): { score: number; reasons: string[]; acceptable: boolean } {
  const summary = String(row.summary ?? "").toLowerCase();
  const tags = normalizedTagsFromRow(row.tagsVersion2);
  const topics = topicLabelsFromRow(row.topicCategories);
  const corpus = `${summary} ${tags.join(" ")} ${topics.join(" ")}`;
  let score = 0;
  const reasons: string[] = [];

  if (/\b(bitcoin|btc|satoshi)\b/.test(corpus)) {
    score += 0.34;
    reasons.push("Bitcoin mentioned");
  }
  if (/\b(price|market|bear market|bull market|rally|surge|drop|falls?|climbs?|nears?|slips?|moving average|all-time high|ath|transactions? per second|volume|active supply|yearly high)\b/.test(summary)) {
    score += 0.18;
    reasons.push("Concrete Bitcoin market/network signal");
  }
  if (/\b(exits?|left|leaves?|departs?|joins?|launches?|launched|raises?|raised|acquires?|acquired|announces?|announced|exploits?|exploited|hacked|stolen|approved|unveils?|unveiled|introduces?|introduced|plans? to purchase|buys?|bought)\b/.test(summary)) {
    score += 0.18;
    reasons.push("Concrete action happened on the date");
  }
  if (topics.some((t) => ["bitcoin price action", "market cycles", "liquidity and flows", "trading activity", "derivatives"].includes(t))) {
    score += 0.1;
    reasons.push("Concrete market storyline");
  }
  if (/\b(jpmorgan|jp morgan|kraken|taproot|draper|coin|developer|developers?|argentina|city|cities|accepted|transaction|transactions?|blockstream|samson mow|ronin|aave|terra|luna|ust|blur|cronje|ukraine|russia|senator|congress|legal tender|mexico|mexican|nation-state|el salvador)\b/.test(summary)) {
    score += 0.16;
    reasons.push("Named event/entity in summary");
  }
  if (/\b(mining|miner|hashrate|halving|block reward|lightning|segwit|taproot|wallet|exchange|coinbase|bitfinex|bitbank|bitmain|mt\.?\s*gox|blockstream|ronin|aave|terra|luna|ust|blur|defi|nft)\b/.test(corpus)) {
    score += 0.28;
    reasons.push("Bitcoin-specific company/protocol/theme");
  }
  if (/\b(blockchain startups?|venture capital|market dynamics|financial hub|investment banks?|crypto markets?|digital assets?|bearish period|concerns grow|community discusses|infrastructure changes|future of bitcoin|questions about bitcoin)\b/.test(summary)) {
    score -= 0.18;
    reasons.push("Generic crypto/macro phrasing");
  }
  if (/\b(halving cuts miner rewards|slows new coin supply|reshapes profitability|every four years|how it works|why it matters|explained|wikipedia|glossary)\b/.test(summary)) {
    score -= 0.32;
    reasons.push("Generic explainer, not a dated storyline");
  }
  if (tags.length <= 2 && topics.some((t) => ["investment", "adoption", "political", "economic"].includes(t))) {
    score -= 0.08;
    reasons.push("Broad taxonomy only");
  }

  const finalScore = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  const hasGenericPenalty = reasons.some((r) => /Generic crypto\/macro phrasing|Generic explainer/i.test(r));
  const acceptable =
    finalScore >= STORYLINE_REVIEW_GOOD_CURRENT_SCORE &&
    !hasGenericPenalty;
  return { score: finalScore, reasons, acceptable };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object");
}

function tierFromStoredKey(key: string): "bitcoin" | "crypto" | "macro" {
  return key === "crypto" || key === "macro" ? key : "bitcoin";
}

function addCalendarDaysForReview(isoDate: string, deltaDays: number): string {
  const t = new Date(`${isoDate}T12:00:00.000Z`).getTime() + deltaDays * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function normalizedStoryTokens(text: string): Set<string> {
  const stop = new Set(["bitcoin", "btc", "crypto", "cryptocurrency", "blockchain", "news", "market", "price", "prices", "says", "said", "will", "could", "would", "should", "from", "with", "that", "this", "into", "over", "after", "before", "amid", "about", "today"]);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^\W+|\W+$/g, ""))
    .filter((token) => token.length >= 4 && !stop.has(token));
  return new Set(tokens);
}

function candidateMatchesCurrentStory(candidate: Pick<ArticleCandidate, "title" | "summary">, currentSummary: string | null): { matches: boolean; overlap: number } {
  const currentTokens = normalizedStoryTokens(String(currentSummary ?? ""));
  const candidateTokens = normalizedStoryTokens(`${candidate.title} ${candidate.summary ?? ""}`);
  if (currentTokens.size === 0 || candidateTokens.size === 0) return { matches: false, overlap: 0 };
  const shared = [...currentTokens].filter((token) => candidateTokens.has(token));
  const overlap = shared.length / Math.min(currentTokens.size, candidateTokens.size);
  const currentKeys = new Set(distinctiveStoryKeys(String(currentSummary ?? "")));
  const candidateKeys = new Set(distinctiveStoryKeys(`${candidate.title} ${candidate.summary ?? ""}`));
  const sharedDistinctive = [...currentKeys].some((key) => candidateKeys.has(key));
  return { matches: sharedDistinctive || overlap >= 0.42, overlap: Math.round(overlap * 1000) / 1000 };
}

function distinctiveStoryKeys(text: string): string[] {
  const lower = text.toLowerCase();
  const keys = [
    [/jp\s?morgan|jpmorgan|jpm coin/g, "jpmorgan"],
    [/jpm coin/g, "jpm-coin"],
    [/\bkraken\b/g, "kraken"],
    [/\bpaypal\b/g, "paypal"],
    [/\bbitbank\b/g, "bitbank"],
    [/\bcanaan\b/g, "canaan"],
    [/\bbitmain\b/g, "bitmain"],
    [/\btaproot\b/g, "taproot"],
    [/\blightning\b/g, "lightning"],
    [/\bmt\.?\s*gox\b/g, "mt-gox"],
    [/\bcme\b/g, "cme"],
    [/\bcboe\b/g, "cboe"],
    [/\bsec\b/g, "sec"],
    [/\betf\b/g, "etf"],
    [/\bhalving\b/g, "halving"],
    [/\bbitpay\b/g, "bitpay"],
    [/\bbitstamp\b/g, "bitstamp"],
    [/\bcharlie\s+shrem|\bshrem\b/g, "charlie-shrem"],
    [/\boverstock\b/g, "overstock"],
    [/\bbitlicense\b/g, "bitlicense"],
    [/\bcoinbase\b/g, "coinbase"],
    [/\bbraintree\b/g, "braintree"],
    [/\broger\s+ver\b/g, "roger-ver"],
    [/\bchangetip\b/g, "changetip"],
  ] as const;
  return keys.flatMap(([pattern, key]) => (pattern.test(lower) ? [key] : []));
}

export function evaluateCandidateNeighborCollision(
  candidate: Pick<ArticleCandidate, "title" | "summary">,
  neighbor: { date: string; summary: string | null; tagsVersion2?: unknown; topicCategories?: unknown },
): { collides: boolean; tokenJaccard: number; sharedKeys: string[]; note?: string } {
  const candidateText = `${candidate.title} ${candidate.summary ?? ""}`.trim();
  const neighborSummary = String(neighbor.summary ?? "").trim();
  if (!candidateText || !neighborSummary) {
    return { collides: false, tokenJaccard: 0, sharedKeys: [] };
  }

  const tokenJaccard = Math.round(summaryTokenJaccardForDuplicateCheck(candidateText, neighborSummary) * 1000) / 1000;
  const candidateKeys = new Set(distinctiveStoryKeys(candidateText));
  const neighborKeys = new Set(distinctiveStoryKeys(neighborSummary));
  const sharedKeys = [...candidateKeys].filter((key) => neighborKeys.has(key));
  const hasExactStoryEntity = sharedKeys.some((key) => key !== "halving" && key !== "etf" && key !== "sec");
  const collides = tokenJaccard >= 0.3 || (hasExactStoryEntity && tokenJaccard >= 0.06);

  return {
    collides,
    tokenJaccard,
    sharedKeys,
    note: collides ? `possible collision with ${neighbor.date}` : undefined,
  };
}

export function storedArticleToCandidate(input: {
  article: ArticleData;
  tier: "bitcoin" | "crypto" | "macro";
  rank: number;
  currentTopArticleId: string | null;
  targetDate: string;
}): ArticleCandidate | null {
  const url = String(input.article.url ?? "").trim();
  const title = String(input.article.title ?? "").trim();
  if (!url || !title) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  const text = `${title}\n${input.article.summary ?? ""}\n${input.article.text ?? ""}`.toLowerCase();
  const titleLower = title.toLowerCase();
  const storySanity = evaluateCandidateStorySanity({
    targetDate: input.targetDate,
    title,
    summary: input.article.summary ?? "",
    text: input.article.text ?? "",
  });
  let score = input.tier === "bitcoin" ? 0.34 : input.tier === "crypto" ? 0.22 : 0.1;
  const notes: string[] = [`stored ${input.tier} article`];

  if (/\b(bitcoin|btc)\b/.test(titleLower)) {
    score += 0.16;
    notes.push("Bitcoin in title");
  }
  if (/\b(bitcoin|btc|satoshi)\b/.test(text)) {
    score += 0.24;
    notes.push("Bitcoin-specific");
  }
  if (/\b(bitbank|bitmain|paypal|coinbase|bitpay|gocoin|jpmorgan|jp morgan|kraken)\b/.test(titleLower)) {
    score += 0.2;
    notes.push("named company in title");
  }
  if (/\b(mining|miner|hashrate|halving|block reward|wallet|payments?)\b/.test(titleLower)) {
    score += 0.14;
    notes.push("specific Bitcoin theme in title");
  }
  if (/\b(mining|miner|hashrate|halving|block reward|bitbank|bitmain|paypal|wallet|payments?)\b/.test(text)) {
    score += 0.22;
    notes.push("specific company/theme");
  }
  if (/\b(price|market wrap|all-time high|ath|moving average|transactions? per second|stimulus|relief bill)\b/.test(titleLower)) {
    score += 0.1;
    notes.push("concrete market/network event");
  }
  if (/\b(top cryptocurrency prices?|crypto prices?|market wrap|daily news|weekly roundup|roundup|digest)\b/.test(titleLower)) {
    score -= 0.24;
    notes.push("multi-asset market roundup penalty");
  }
  if (isRoundupArticleContent({ title, summary: input.article.summary, text: input.article.text })) {
    score -= 0.42;
    notes.push("multi-story roundup penalty");
  }
  if (/\b(bitcoin|btc)\b/.test(titleLower) && /\b(shiba inu|ethereum|dogecoin|solana|terra|xrp|cardano|altcoins?)\b/.test(text)) {
    score -= 0.12;
    notes.push("multi-asset framing penalty");
  }
  if (/\b(blockchain startups?|venture capital|market dynamics|financial hub|investment banks?|cryptocurrency .*mainstream|blockchains? .*mainstream|bitcoin entirely legal|bitcoin tax|history of bitcoin|bitcoin'?s history|defined bitcoin'?s history|moments that defined|things you should not miss|bitcoin in china|what was|all about|questions about bitcoin|future of bitcoin|point of view|currency tool|lunch for bitcoin|prediction|predicts?|forecast|could surge|may surge|will make it|say analysts?|analysts say|speculation)\b/.test(text)) {
    score -= 0.34;
    notes.push("generic storyline penalty");
  }
  if (/\b(unlimited free paypal money|free paypal money|paypal account)\b/.test(text)) {
    score -= 0.7;
    notes.push("spam/noise penalty");
  }
  if (!/\b(bitcoin|btc)\b/.test(titleLower) && /\b(cryptocurrency|blockchains?|mainstream|funding overtakes)\b/.test(titleLower)) {
    score -= 0.18;
    notes.push("generic title penalty");
  }
  if (input.currentTopArticleId && input.article.id === input.currentTopArticleId) {
    score -= 0.16;
    notes.push("current selected article");
  }
  if (!storySanity.ok) {
    score -= 0.55;
    notes.push("calendar/story warning");
  }

  let source: string | undefined;
  try {
    source = new URL(url).hostname;
  } catch {
    source = undefined;
  }

  return {
    id: input.article.id,
    title,
    url,
    publishedDate: input.article.publishedDate ?? null,
    tier: input.tier,
    source,
    summary: input.article.summary,
    rank: input.rank,
    publishedDateOffsetDays: null,
    calendarSanityOk: storySanity.ok,
    calendarSanityNotes: storySanity.notes,
    relevanceScore: Math.max(0, Math.min(1, Math.round(score * 1000) / 1000)),
    relevanceNotes: notes,
    recommended: false,
  };
}

function normalizeArticleLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function articleMatchesTopId(article: ArticleData, topArticleId: string): boolean {
  const top = topArticleId.trim();
  if (!top) return false;
  if (String(article.id ?? "").trim() === top) return true;
  const url = String(article.url ?? "").trim();
  if (!url) return false;
  if (url === top) return true;
  return normalizeArticleLookupKey(url) === normalizeArticleLookupKey(top);
}

/** Resolve the stored winning article from tiered + legacy analyzed payloads. */
export function resolveStoredWinningArticle(row: {
  topArticleId: string | null;
  tieredArticles: unknown;
  analyzedArticles: unknown;
  winningTier?: string | null;
}): { article: ArticleData; tier: "bitcoin" | "crypto" | "macro" } | null {
  const topId = row.topArticleId?.trim();
  if (!topId) return null;

  if (isRecord(row.tieredArticles)) {
    for (const key of ["bitcoin", "crypto", "macro"] as const) {
      const arr = row.tieredArticles[key];
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        if (!isRecord(raw)) continue;
        const article = raw as unknown as ArticleData;
        if (articleMatchesTopId(article, topId)) {
          return { article, tier: key };
        }
      }
    }
  }

  if (Array.isArray(row.analyzedArticles)) {
    for (const raw of row.analyzedArticles) {
      if (!isRecord(raw)) continue;
      const article = raw as unknown as ArticleData;
      if (articleMatchesTopId(article, topId)) {
        const tier = tierFromStoredKey(String(raw.tier ?? raw.tierUsed ?? row.winningTier ?? "bitcoin"));
        return { article, tier };
      }
    }
  }

  return null;
}

export function buildRemovedDayContext(
  analysis: {
    summary: string | null;
    topArticleId: string | null;
    tieredArticles: unknown;
    analyzedArticles: unknown;
    winningTier?: string | null;
  },
  reason: string,
  source: NonNullable<RemovedDayContext["source"]>,
): RemovedDayContext {
  const winning = resolveStoredWinningArticle({
    topArticleId: analysis.topArticleId,
    tieredArticles: analysis.tieredArticles,
    analyzedArticles: analysis.analyzedArticles,
    winningTier: analysis.winningTier ?? null,
  });

  return {
    reason,
    removedAt: new Date().toISOString(),
    source,
    previousSummary: analysis.summary?.trim() || undefined,
    previousArticle: winning
      ? {
          id: String(winning.article.id ?? winning.article.url ?? "").trim(),
          title: String(winning.article.title ?? "Previous article").trim(),
          url: String(winning.article.url ?? "").trim(),
          tier: winning.tier,
        }
      : undefined,
  };
}

export function removedDayArticlePickNote(ctx: RemovedDayContext, hasCandidates: boolean): string {
  const base = "This day was cleared during calendar review. Pick a new article for this date.";
  if (!hasCandidates) {
    return `${base} No Exa candidates were found yet — confirm empty or reject to widen search.`;
  }
  return `${base} Previous coverage is shown below for reference.`;
}

export function buildStoredArticleCandidates(row: {
  topArticleId: string | null;
  tieredArticles: unknown;
  analyzedArticles: unknown;
  targetDate: string;
}): ArticleCandidate[] {
  const out: ArticleCandidate[] = [];
  const seen = new Set<string>();
  const push = (article: ArticleData, tier: "bitcoin" | "crypto" | "macro", rank: number) => {
    const candidate = storedArticleToCandidate({
      article,
      tier,
      rank,
      currentTopArticleId: row.topArticleId,
      targetDate: row.targetDate,
    });
    if (!candidate) return;
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  if (isRecord(row.tieredArticles)) {
    for (const key of ["bitcoin", "crypto", "macro"] as const) {
      const arr = row.tieredArticles[key];
      if (!Array.isArray(arr)) continue;
      arr.forEach((article, index) => {
        if (isRecord(article)) push(article as unknown as ArticleData, key, index);
      });
    }
  }

  if (Array.isArray(row.analyzedArticles)) {
    row.analyzedArticles.forEach((article, index) => {
      if (!isRecord(article)) return;
      const tier = tierFromStoredKey(String(article.tier ?? article.tierUsed ?? "bitcoin"));
      push(article as unknown as ArticleData, tier, index);
    });
  }

  out.sort((a, b) => {
    const scoreDiff = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.rank - b.rank;
  });
  // Same rule as the gated fetch path: do NOT auto-recommend a candidate that
  // fails story/calendar sanity. Stale stored articles often look fine by
  // tier but trip the new sanity rules; in that case let the operator pick.
  const recommended = out.find((c) => c.calendarSanityOk) ?? null;
  if (recommended) {
    recommended.recommended = true;
    recommended.relevanceNotes = ["recommended from already fetched articles with date sanity", ...(recommended.relevanceNotes ?? [])];
  }
  return out.slice(0, 18);
}

async function applyNeighborCollisionPenalties(
  targetDate: string,
  candidates: ArticleCandidate[],
): Promise<ArticleCandidate[]> {
  if (candidates.length === 0) return candidates;

  const from = addCalendarDaysForReview(targetDate, -STORYLINE_REVIEW_COLLISION_WINDOW_DAYS);
  const to = addCalendarDaysForReview(targetDate, STORYLINE_REVIEW_COLLISION_WINDOW_DAYS);
  const neighbors = await db
    .select({
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
    })
    .from(historicalNewsAnalyses)
    .where(
      and(
        ne(historicalNewsAnalyses.date, targetDate),
        gte(historicalNewsAnalyses.date, from),
        lte(historicalNewsAnalyses.date, to),
      ),
    );

  const scored = candidates.map((candidate) => {
    const collisions = neighbors
      .map((neighbor) => evaluateCandidateNeighborCollision(candidate, neighbor))
      .filter((result) => result.collides)
      .sort((a, b) => b.tokenJaccard - a.tokenJaccard);

    if (collisions.length === 0) return { candidate, collisionCount: 0 };

    const strongest = collisions[0];
    const penalty = Math.min(0.55, 0.32 + collisions.length * 0.08);
    return {
      candidate: {
        ...candidate,
        relevanceScore: Math.max(0, Math.round(((candidate.relevanceScore ?? 0) - penalty) * 1000) / 1000),
        relevanceNotes: [
          ...(candidate.relevanceNotes ?? []),
          `${strongest.note}; already represented nearby`,
          ...(strongest.sharedKeys.length ? [`shared story keys: ${strongest.sharedKeys.join(", ")}`] : []),
        ],
        recommended: false,
      },
      collisionCount: collisions.length,
    };
  });

  scored.sort((a, b) => {
    const scoreDiff = (b.candidate.relevanceScore ?? 0) - (a.candidate.relevanceScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.collisionCount - b.collisionCount || a.candidate.rank - b.candidate.rank;
  });

  const recommended =
    scored.find(({ candidate, collisionCount }) => candidate.calendarSanityOk && collisionCount === 0)?.candidate ??
    scored.find(({ candidate }) => candidate.calendarSanityOk)?.candidate ??
    null;
  if (recommended) {
    recommended.recommended = true;
    recommended.relevanceNotes = [
      "recommended from already fetched articles with date sanity and neighbor-collision check",
      ...(recommended.relevanceNotes ?? []).filter((note) => !/^recommended from already fetched articles/i.test(note)),
    ];
  }

  return scored.map(({ candidate }) => candidate).slice(0, 18);
}

export async function continueExistingDayChecksAfterKeepingStoryline(opts: {
  runId: string;
  stepId: string | null;
  date: string;
  triage: TriageItem;
  reviewer?: string | null;
}): Promise<{ ok: boolean; message: string; queuedReviewId?: string }> {
  const [row] = await db
    .select({
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      isOrphan: historicalNewsAnalyses.isOrphan,
      isFlagged: historicalNewsAnalyses.isFlagged,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      tags: historicalNewsAnalyses.tags,
      tieredArticles: historicalNewsAnalyses.tieredArticles,
      analyzedArticles: historicalNewsAnalyses.analyzedArticles,
      suppressedTagSuggestions: historicalNewsAnalyses.suppressedTagSuggestions,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, opts.date))
    .limit(1);

  if (!row) {
    return { ok: false, message: `Could not continue checks because ${opts.date} has no analysis row.` };
  }

  const articleText = collectArticleTextForGrounding(row.tieredArticles, row.analyzedArticles);
  const canonicalTagIndex = await loadCanonicalTagIndex();
  const proposals = await buildCorrectionProposalsAsync({
    date: opts.date,
    summary: row.summary,
    topArticleId: row.topArticleId,
    isOrphan: row.isOrphan,
    isFlagged: row.isFlagged,
    tagsVersion2: row.tagsVersion2,
    topicCategories: row.topicCategories,
    legacyTags: row.tags,
    articleText,
    canonicalTagIndex,
    suppressedGroundedTags: row.suppressedTagSuggestions,
  });
  const { automatic: automaticProposals, manual: manualProposals } = splitAutomaticCorrectionProposals(proposals);
  const autoApplied = await applyAutomaticCorrectionProposals({
    date: opts.date,
    proposals: automaticProposals,
  });

  if (manualProposals.length > 0 || (opts.triage.route === "existing_needs_correction" && proposals.length === 0)) {
    const [queued] = await db
      .insert(humanReviewQueue)
      .values({
        runId: opts.runId,
        stepId: opts.stepId,
        status: "pending",
        priority: opts.triage.route === "existing_needs_correction" ? 75 : 55,
        eventDate: opts.date,
        package: {
          phase: "awaiting_correction_approval",
          triage: opts.triage,
          proposals: manualProposals,
          note:
            manualProposals.length > 0
              ? `Current summary kept. Pipeline auto-applied ${automaticProposals.length} safe fix(es) and detected ${manualProposals.length} remaining suggested fix(es).`
              : "Current summary kept. Pipeline still sees issues but has no safe automatic fix.",
        },
        reviewer: null,
        reviewedAt: null,
      })
      .returning({ id: humanReviewQueue.id });

    return {
      ok: true,
      queuedReviewId: queued?.id,
      message: `Kept current summary for ${opts.date}; auto-applied ${autoApplied.length} safe fix(es), queued ${manualProposals.length} remaining fix(es).`,
    };
  }

  if (autoApplied.length > 0) {
    return {
      ok: true,
      message: `Kept current summary for ${opts.date}; auto-applied ${autoApplied.join("; ")}.`,
    };
  }

  const [queued] = await db
    .insert(humanReviewQueue)
    .values({
      runId: opts.runId,
      stepId: opts.stepId,
      status: "approved",
      priority: 50,
      eventDate: opts.date,
      package: {
        triage: opts.triage,
        note: "Current summary kept; remaining checks passed with no changes.",
      },
      reviewer: opts.reviewer ?? "auto",
      reviewedAt: new Date(),
    })
    .returning({ id: humanReviewQueue.id });

  return {
    ok: true,
    queuedReviewId: queued?.id,
    message: `Kept current summary for ${opts.date}; remaining checks passed.`,
  };
}

/**
 * V3 deterministic checks for existing days. Priority: canonical mismatch
 * (very serious — wrong-date data) > strong duplicate (operator must decide
 * which day owns the story) > correction proposals (small fixes). When no
 * issue is detected the day is auto-approved with a clear note.
 *
 * Returns the next step index and whether an auto-approve was issued.
 */
async function queueRefetchArticlePickForExistingDay(opts: {
  runId: string;
  stepIndex: number;
  triage: TriageItem;
  note: string;
  rejectionReason: string;
  evidence?: Record<string, unknown>;
}): Promise<number> {
  const pool = await fetchCandidatesForDate(opts.triage.date, {
    requestId: `pipeline-refetch-${opts.runId}-${opts.triage.date}`,
    source: "editorial-pipeline-refetch",
  });
  const stepId = await createStep({
    runId: opts.runId,
    stepIndex: opts.stepIndex,
    agentName: "SourceFinderAgent",
    status: pool.hasCandidates ? "completed" : "rejected",
    confidence: pool.hasCandidates ? 0.84 : 0.45,
    input: { date: opts.triage.date, mode: "refetch-after-junk-winner" },
    output: buildStepOutput({
      summary: pool.hasCandidates
        ? `Refetched ${pool.candidates.length} candidate article(s) for ${opts.triage.date}.`
        : `No replacement articles found for ${opts.triage.date}.`,
      findings: pool.candidates.slice(0, 6).map((c) => `${c.tier}: ${c.title}`),
    }),
    evidence: {
      perTierCounts: pool.perTierCounts,
      totalCandidates: pool.candidates.length,
      ...(opts.evidence ?? {}),
    },
    rejectionReason: pool.hasCandidates ? null : opts.rejectionReason,
    suggestedAction: "manual_review",
  });

  const pickPkg: ArticlePickPackage = {
    phase: "awaiting_article_pick",
    scenario: "better_storyline",
    triage: opts.triage,
    candidates: pool.candidates,
    hasCandidates: pool.hasCandidates,
    note: opts.note,
  };

  await db.insert(humanReviewQueue).values({
    runId: opts.runId,
    stepId,
    status: "pending",
    priority: 92,
    eventDate: opts.triage.date,
    package: pickPkg,
    reviewer: null,
    reviewedAt: null,
  });

  return opts.stepIndex + 1;
}

async function runV3ExistingDayChecks(opts: {
  runId: string;
  triage: TriageItem;
  triageStepId: string;
  startStepIndex: number;
  checkScopes: Set<PipelineCheckScope>;
}): Promise<{ nextStepIndex: number; autoApproved: boolean }> {
  const { runId, triage, triageStepId } = opts;
  let stepIndex = opts.startStepIndex;
  const checkScopes = opts.checkScopes;

  const [row] = await db
    .select({
      id: historicalNewsAnalyses.id,
      summary: historicalNewsAnalyses.summary,
      topArticleId: historicalNewsAnalyses.topArticleId,
      isOrphan: historicalNewsAnalyses.isOrphan,
      isFlagged: historicalNewsAnalyses.isFlagged,
      tagsVersion2: historicalNewsAnalyses.tagsVersion2,
      topicCategories: historicalNewsAnalyses.topicCategories,
      tags: historicalNewsAnalyses.tags,
      tieredArticles: historicalNewsAnalyses.tieredArticles,
      analyzedArticles: historicalNewsAnalyses.analyzedArticles,
      suppressedTagSuggestions: historicalNewsAnalyses.suppressedTagSuggestions,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.date, triage.date))
    .limit(1);

  if (!row || !triage.analysisId) {
    // Defensive: triage said the row exists but we can't load it. Fall back to a
    // bare review item so the operator sees something rather than nothing.
    await db.insert(humanReviewQueue).values({
      runId,
      stepId: triageStepId,
      status: "pending",
      priority: 70,
      eventDate: triage.date,
      package: { triage, note: "Triage thought this day existed but the row could not be loaded." },
      reviewer: null,
      reviewedAt: null,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  const summary = (row.summary ?? "").trim();

  // 1. Canonical / LLM date consistency (highest priority)
  if (checkScopes.has("date") && summary && triage.analysisId) {
    const dateCheck = await evaluateDateConsistencyForDay({
      date: triage.date,
      analysisId: triage.analysisId,
      summary,
    });

    const calendarExpected =
      dateCheck.status === "canonical"
        ? dateCheck.expectedDate
        : dateCheck.status === "mismatch" && dateCheck.duplicateOfDate
          ? dateCheck.duplicateOfDate
          : null;

    if (calendarExpected && calendarExpected !== triage.date) {
      const ruleId =
        dateCheck.status === "canonical" ? dateCheck.ruleId : "llm-duplicate-slot";
      let neighborSummaryPreview: string | null = null;
      if (dateCheck.status === "mismatch") {
        const [neighborRow] = await db
          .select({ summary: historicalNewsAnalyses.summary })
          .from(historicalNewsAnalyses)
          .where(eq(historicalNewsAnalyses.date, calendarExpected))
          .limit(1);
        neighborSummaryPreview = neighborRow?.summary?.trim() ?? null;
      }
      const reason = formatCalendarDecisionExplanation({
        ruleId,
        currentDate: triage.date,
        expectedDate: calendarExpected,
        canonicalReason: dateCheck.status === "canonical" ? dateCheck.reason : undefined,
        llmIssues: dateCheck.status === "mismatch" ? dateCheck.issues : undefined,
        neighborSummaryPreview,
      });
      const [conflict] = await db
        .select({ id: historicalNewsAnalyses.id })
        .from(historicalNewsAnalyses)
        .where(eq(historicalNewsAnalyses.date, calendarExpected))
        .limit(1);
      const calendarPkg: CalendarDecisionPackage = {
        phase: "awaiting_calendar_decision",
        triage,
        currentDate: triage.date,
        expectedDate: calendarExpected,
        ruleId,
        reason,
        canonicalDateOccupied: Boolean(conflict),
        note: `Summary may belong on ${calendarExpected}. Decide whether to move, keep, or delete.`,
      };

      const stepId = await createStep({
        runId,
        stepIndex,
        agentName: "DateConsistencyAgent",
        status: "rejected",
        confidence: dateCheck.status === "canonical" ? 0.9 : 0.82,
        input: { date: triage.date, ruleId, dateCheckStatus: dateCheck.status },
        output: buildStepOutput({
          summary: `Date mismatch detected (${ruleId}); expected ${calendarExpected}.`,
          findings: [reason],
        }),
        evidence: { expectedDate: calendarExpected, dateCheckStatus: dateCheck.status },
        rejectionReason: reason,
        suggestedAction: "manual_review",
      });
      stepIndex += 1;

      await db.insert(humanReviewQueue).values({
        runId,
        stepId,
        status: "pending",
        priority: 100,
        eventDate: triage.date,
        package: calendarPkg,
        reviewer: null,
        reviewedAt: null,
      });
      return { nextStepIndex: stepIndex, autoApproved: false };
    }
  }

  // Legacy regex-only fallback when analysis id missing
  const canonical = summary ? detectCanonicalDateMismatch(summary, triage.date) : null;
  if (checkScopes.has("date") && canonical && !triage.analysisId) {
    const [conflict] = await db
      .select({ id: historicalNewsAnalyses.id })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, canonical.expectedDate))
      .limit(1);
    const calendarPkg: CalendarDecisionPackage = {
      phase: "awaiting_calendar_decision",
      triage,
      currentDate: triage.date,
      expectedDate: canonical.expectedDate,
      ruleId: canonical.ruleId,
      reason: canonical.reason,
      canonicalDateOccupied: Boolean(conflict),
      note: `Summary text matches ${canonical.ruleId}; canonical date is ${canonical.expectedDate}. Decide whether to move, keep, or delete.`,
    };

    const stepId = await createStep({
      runId,
      stepIndex,
      agentName: "DateConsistencyAgent",
      status: "rejected",
      confidence: 0.9,
      input: { date: triage.date, ruleId: canonical.ruleId },
      output: buildStepOutput({
        summary: `Canonical date mismatch detected (${canonical.ruleId}); expected ${canonical.expectedDate}.`,
        findings: [canonical.reason],
      }),
      evidence: { canonicalRule: canonical.ruleId, expectedDate: canonical.expectedDate },
      rejectionReason: canonical.reason,
      suggestedAction: "manual_review",
    });
    stepIndex += 1;

    await db.insert(humanReviewQueue).values({
      runId,
      stepId,
      status: "pending",
      priority: 100,
      eventDate: triage.date,
      package: calendarPkg,
      reviewer: null,
      reviewedAt: null,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  // 2. Strong duplicate neighbor
  const duplicateCtx = summary
    ? await getEditorialDuplicateNeighborContext({
        date: triage.date,
        analysisId: triage.analysisId,
        windowDays: 56,
        maxNeighbors: 6,
      })
    : null;
  const strongNeighbors = duplicateCtx?.neighbors.filter(isStrongDuplicateNeighbor) ?? [];
  if (checkScopes.has("duplicates") && strongNeighbors.length > 0 && duplicateCtx) {
    const dupePkg: DuplicateDecisionPackage = {
      phase: "awaiting_duplicate_decision",
      triage,
      focal: {
        date: triage.date,
        summaryPreview: duplicateCtx.focalSummaryPreview,
        tags: duplicateCtx.focalTags,
        topics: duplicateCtx.focalTopics,
      },
      neighbors: strongNeighbors,
      note: `Detected ${strongNeighbors.length} strong duplicate neighbor(s). Pick: keep both, delete one, or differentiate.`,
    };
    const stepId = await createStep({
      runId,
      stepIndex,
      agentName: "DuplicateCheckerAgent",
      status: "rejected",
      confidence: 0.85,
      input: { date: triage.date },
      output: buildStepOutput({
        summary: `Found ${strongNeighbors.length} strong duplicate neighbor(s); operator must decide.`,
        findings: strongNeighbors.map(
          (n) => `${n.date}: j=${n.tokenJaccard.toFixed(2)} sharedTags=${n.sharedTags.length} sharedTopics=${n.sharedTopics.length}`,
        ),
      }),
      evidence: { neighborsConsidered: duplicateCtx.neighbors.length },
      rejectionReason: "Strong duplicate neighbors found",
      suggestedAction: "manual_review",
    });
    stepIndex += 1;

    await db.insert(humanReviewQueue).values({
      runId,
      stepId,
      status: "pending",
      priority: 92,
      eventDate: triage.date,
      package: dupePkg,
      reviewer: null,
      reviewedAt: null,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  if (checkScopes.has("duplicates") && duplicateCtx?.neighbors.length && summary) {
    for (const neighbor of duplicateCtx.neighbors.filter(isBorderlineDuplicateNeighbor).slice(0, 2)) {
      const semantic = await evaluateSemanticDuplicateForDay({ date: triage.date, summary, neighbor });
      if (semantic.status === "duplicate") {
        const dupePkg: DuplicateDecisionPackage = {
          phase: "awaiting_duplicate_decision",
          triage,
          focal: {
            date: triage.date,
            summaryPreview: duplicateCtx.focalSummaryPreview,
            tags: duplicateCtx.focalTags,
            topics: duplicateCtx.focalTopics,
          },
          neighbors: [neighbor],
          note: formatDuplicateQueueNote(semantic.neighborDate),
        };
        const stepId = await createStep({
          runId,
          stepIndex,
          agentName: "DuplicateCheckerAgent",
          status: "rejected",
          confidence: semantic.verdict.confidence,
          input: { date: triage.date, mode: "semantic-duplicate" },
          output: buildStepOutput({
            summary: "Semantic duplicate neighbor detected",
            findings: [formatDuplicateQueueNote(semantic.neighborDate)],
          }),
          evidence: { neighbor: neighbor.date, verdict: semantic.verdict },
          rejectionReason: formatDuplicateQueueNote(semantic.neighborDate),
          suggestedAction: "manual_review",
        });
        stepIndex += 1;
        await db.insert(humanReviewQueue).values({
          runId,
          stepId,
          status: "pending",
          priority: 91,
          eventDate: triage.date,
          package: dupePkg,
          reviewer: null,
          reviewedAt: null,
        });
        return { nextStepIndex: stepIndex, autoApproved: false };
      }
    }
  }

  // 3. Relevance Agent — off-topic / insufficient stories need article pick
  const storyline = currentStorylineQuality(row);
  const suppressedCandidateSignals = await loadSuppressedCandidateSignals(triage.date);
  const storedCandidatesRaw = await applyNeighborCollisionPenalties(
    triage.date,
    buildStoredArticleCandidates({ ...row, targetDate: triage.date }),
  );
  const storedCandidates = filterSuppressedCandidates(storedCandidatesRaw, suppressedCandidateSignals);
  const winningResolved = resolveStoredWinningArticle({
    topArticleId: row.topArticleId,
    tieredArticles: row.tieredArticles,
    analyzedArticles: row.analyzedArticles,
  });
  const articlePickContext = winningResolved
    ? {
        title: winningResolved.article.title,
        snippet: `${winningResolved.article.summary ?? ""}\n${winningResolved.article.text ?? ""}`.slice(0, 1600),
      }
    : null;
  const badWinner = summaryNeedsBetterArticleSource(summary, row.topArticleId, articlePickContext);
  const badWinnerNote = badWinnerOperatorNote(summary, row.topArticleId, articlePickContext);

  if (badWinner) {
    if (storedCandidates.length > 0) {
      const pickPkg: ArticlePickPackage = {
        phase: "awaiting_article_pick",
        scenario: "better_storyline",
        triage,
        candidates: storedCandidates,
        hasCandidates: true,
        note: `${badWinnerNote}. Pick a single dated article from stored candidates.`,
      };
      const stepId = await createStep({
        runId,
        stepIndex,
        agentName: "RelevanceCheckerAgent",
        status: "rejected",
        confidence: 0.86,
        input: { date: triage.date, mode: "bad-winner" },
        output: buildStepOutput({
          summary: "Current winning article is not a single dated event",
          findings: [badWinnerNote, ...(isRoundupMultiStorySummary(summary) ? ["roundup_summary=true"] : [])],
        }),
        evidence: { badWinner: true, topArticleId: row.topArticleId },
        rejectionReason: badWinnerNote,
        suggestedAction: "manual_review",
      });
      stepIndex += 1;
      await db.insert(humanReviewQueue).values({
        runId,
        stepId,
        status: "pending",
        priority: 90,
        eventDate: triage.date,
        package: pickPkg,
        reviewer: null,
        reviewedAt: null,
      });
      return { nextStepIndex: stepIndex, autoApproved: false };
    }

    stepIndex = await queueRefetchArticlePickForExistingDay({
      runId,
      stepIndex,
      triage,
      note: `${badWinnerNote}. No stored alternatives — fresh search results are shown below.`,
      rejectionReason: badWinnerNote,
      evidence: { badWinner: true, topArticleId: row.topArticleId },
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  if (checkScopes.has("relevance") && summary.length >= 15) {
    const relevance = await evaluateRelevanceWithAgent({
      date: triage.date,
      summary,
      tags: normalizedTagsFromRow(row.tagsVersion2),
      topics: topicLabelsFromRow(row.topicCategories),
      topArticleId: row.topArticleId,
    });
    const needsArticlePick = relevanceRequiresArticlePick(relevance);

    if (needsArticlePick && storedCandidates.length > 0) {
      const pickPkg: ArticlePickPackage = {
        phase: "awaiting_article_pick",
        scenario: "better_storyline",
        triage,
        candidates: storedCandidates,
        hasCandidates: true,
        note: relevanceOperatorNote(relevance.classification),
      };
      const stepId = await createStep({
        runId,
        stepIndex,
        agentName: "RelevanceCheckerAgent",
        status: "rejected",
        confidence: relevance.confidence === "high" ? 0.84 : 0.7,
        input: { date: triage.date, mode: "relevance-agent" },
        output: buildStepOutput({
          summary: "Story failed relevance classification",
          findings: [`classification=${relevance.classification}`],
        }),
        evidence: { relevance },
        rejectionReason: relevanceOperatorNote(relevance.classification),
        suggestedAction: "manual_review",
      });
      stepIndex += 1;
      await db.insert(humanReviewQueue).values({
        runId,
        stepId,
        status: "pending",
        priority: 88,
        eventDate: triage.date,
        package: pickPkg,
        reviewer: null,
        reviewedAt: null,
      });
      return { nextStepIndex: stepIndex, autoApproved: false };
    }

    if (needsArticlePick && storedCandidates.length === 0) {
      stepIndex = await queueRefetchArticlePickForExistingDay({
        runId,
        stepIndex,
        triage,
        note: `${relevanceOperatorNote(relevance.classification)} No stored alternatives — fresh search results are shown below.`,
        rejectionReason: relevanceOperatorNote(relevance.classification),
        evidence: { relevance, topArticleId: row.topArticleId },
      });
      return { nextStepIndex: stepIndex, autoApproved: false };
    }
  }

  // 4. Storyline quality: if the current summary is valid but too generic,
  // ask the operator to pick a better article from the already fetched pool.
  const betterStorylineWaived = await hasBetterStorylineWaiver(triage.date);
  if (checkScopes.has("relevance") && betterStorylineWaived) {
    await continueExistingDayChecksAfterKeepingStoryline({
      runId,
      stepId: null,
      date: triage.date,
      triage,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }
  const recommendedStored = storedCandidates.find((c) => c.recommended) ?? storedCandidates[0] ?? null;
  const currentTop = String(row.topArticleId ?? "").trim();
  const hasBetterStoredCandidate =
    Boolean(recommendedStored) &&
    recommendedStored!.id !== currentTop &&
    recommendedStored!.calendarSanityOk &&
    (recommendedStored!.relevanceScore ?? 0) >= STORYLINE_REVIEW_MIN_BETTER_CANDIDATE_SCORE &&
    (recommendedStored!.relevanceScore ?? 0) - storyline.score >= STORYLINE_REVIEW_MIN_SCORE_GAP &&
    !storyline.acceptable &&
    (recommendedStored!.relevanceScore ?? 0) >= STORYLINE_REVIEW_STRONG_REPLACEMENT_SCORE &&
    candidateMatchesCurrentStory(recommendedStored!, row.summary).matches;

  if (checkScopes.has("relevance") && hasBetterStoredCandidate && storedCandidates.length > 1) {
    const pickPkg: ArticlePickPackage = {
      phase: "awaiting_article_pick",
      scenario: "better_storyline",
      triage,
      candidates: storedCandidates,
      hasCandidates: true,
      note:
        "Current summary is valid but generic. Pick a stronger Bitcoin-specific article from the already fetched candidates, or keep the current day by rejecting this review.",
    };
    const stepId = await createStep({
      runId,
      stepIndex,
      agentName: "RelevanceCheckerAgent",
      status: "rejected",
      confidence: 0.78,
      input: { date: triage.date, mode: "stored-candidate-storyline-review" },
      output: buildStepOutput({
        summary: "Current story is valid but weak compared with stored alternatives.",
        findings: [
          `Current storyline score=${storyline.score}`,
          ...storyline.reasons,
          `Recommended stored candidate=${recommendedStored!.title}`,
          `Candidate score=${recommendedStored!.relevanceScore ?? 0}`,
          `Candidate/current overlap=${candidateMatchesCurrentStory(recommendedStored!, row.summary).overlap}`,
        ],
      }),
      evidence: {
        currentTopArticleId: row.topArticleId,
        currentStorylineScore: storyline.score,
        currentStorylineReasons: storyline.reasons,
        candidateCount: storedCandidates.length,
        recommendedCandidateId: recommendedStored!.id,
      },
      rejectionReason: "Current storyline is vague and a stronger stored article is available",
      suggestedAction: "manual_review",
    });
    stepIndex += 1;

    await db.insert(humanReviewQueue).values({
      runId,
      stepId,
      status: "pending",
      priority: 89,
      eventDate: triage.date,
      package: pickPkg,
      reviewer: null,
      reviewedAt: null,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  // 4. Correction proposals
  const articleText = collectArticleTextForGrounding(row.tieredArticles, row.analyzedArticles);
  const canonicalTagIndex = await loadCanonicalTagIndex();
  const proposals = await buildScopedCorrectionProposals({
    input: {
      date: triage.date,
      summary: row.summary,
      topArticleId: row.topArticleId,
      isOrphan: row.isOrphan,
      isFlagged: row.isFlagged,
      tagsVersion2: row.tagsVersion2,
      topicCategories: row.topicCategories,
      legacyTags: row.tags,
      articleText,
      canonicalTagIndex,
      suppressedGroundedTags: row.suppressedTagSuggestions,
    },
    neighborHints: neighborHintsFromDuplicateContext(duplicateCtx),
    checkScopes,
  });
  const { automatic: automaticProposals, manual: manualProposals } = splitAutomaticCorrectionProposals(proposals);
  const autoApplied = await applyAutomaticCorrectionProposals({
    date: triage.date,
    proposals: automaticProposals,
  });

  if (manualProposals.length > 0 || (triage.route === "existing_needs_correction" && proposals.length === 0)) {
    const correctionPkg: CorrectionApprovalPackage = {
      phase: "awaiting_correction_approval",
      triage,
      proposals: manualProposals,
      note:
        manualProposals.length > 0
          ? `Pipeline auto-applied ${automaticProposals.length} safe fix(es) and detected ${manualProposals.length} suggested fix(es). Each remaining fix is opt-in below.`
          : "Pipeline detected issues but has no safe automatic fix. Use the action plan to edit, reject, or find another event.",
    };
    const stepId = await createStep({
      runId,
      stepIndex,
      agentName: "TagManagerAgent",
      status: "completed",
      confidence: 0.8,
      input: { date: triage.date, route: triage.route },
      output: buildStepOutput({
        summary: `Auto-applied ${automaticProposals.length} safe correction(s); built ${manualProposals.length} correction proposal(s) for operator review.`,
        findings: [
          ...automaticProposals.map((p) => `auto:${p.kind}`),
          ...manualProposals.map((p) => `${p.kind}`),
        ],
      }),
      evidence: {
        v2TagCountBefore: normalizedTagsFromRow(row.tagsVersion2).length,
        topicCountBefore: topicLabelsFromRow(row.topicCategories).length,
      },
    });
    stepIndex += 1;

    await db.insert(humanReviewQueue).values({
      runId,
      stepId,
      status: "pending",
      priority: triage.route === "existing_needs_correction" ? 75 : 55,
      eventDate: triage.date,
      package: correctionPkg,
      reviewer: null,
      reviewedAt: null,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  if (autoApplied.length > 0) {
    const [freshRow] = await db
      .select({ topicCategories: historicalNewsAnalyses.topicCategories })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, triage.date))
      .limit(1);
    const topicIssuesAfterAuto =
      checkScopes.has("topics") ?
        invalidTopicReasons(topicLabelsFromRow(freshRow?.topicCategories))
      : [];

    if (topicIssuesAfterAuto.length > 0) {
      const topicProposals = (
        await buildCorrectionProposalsAsync(
          {
            date: triage.date,
            summary: row.summary,
            topArticleId: row.topArticleId,
            isOrphan: row.isOrphan,
            isFlagged: row.isFlagged,
            tagsVersion2: row.tagsVersion2,
            topicCategories: freshRow?.topicCategories ?? row.topicCategories,
            legacyTags: row.tags,
            articleText,
            canonicalTagIndex,
            suppressedGroundedTags: row.suppressedTagSuggestions,
          },
          { neighborHints: neighborHintsFromDuplicateContext(duplicateCtx) },
        )
      ).filter(
        (proposal) => proposal.kind === "set_topic_categories" && proposalMatchesCheckScopes(proposal, checkScopes),
      );

      const correctionPkg: CorrectionApprovalPackage = {
        phase: "awaiting_correction_approval",
        triage,
        proposals: topicProposals,
        note: `Auto-applied ${automaticProposals.length} safe fix(es), but topic hierarchy is still invalid: ${topicIssuesAfterAuto.join("; ")}. Assign exactly one homepage storyline leaf.`,
      };
      const stepId = await createStep({
        runId,
        stepIndex,
        agentName: "TopicValidatorAgent",
        status: "rejected",
        confidence: 0.45,
        input: { date: triage.date, route: triage.route },
        output: buildStepOutput({
          summary: "Topic hierarchy still invalid after auto-corrections",
          findings: [...autoApplied, ...topicIssuesAfterAuto],
        }),
        rejectionReason: topicIssuesAfterAuto.join("; "),
        suggestedAction: "manual_review",
      });
      stepIndex += 1;

      await db.insert(humanReviewQueue).values({
        runId,
        stepId,
        status: "pending",
        priority: 78,
        eventDate: triage.date,
        package: correctionPkg,
        reviewer: null,
        reviewedAt: null,
      });
      return { nextStepIndex: stepIndex, autoApproved: false };
    }

    await createStep({
      runId,
      stepIndex,
      agentName: "TagManagerAgent",
      status: "approved",
      confidence: 0.88,
      input: { date: triage.date, route: triage.route },
      output: buildStepOutput({
        summary: `Approved after auto-applying safe correction(s): ${autoApplied.join("; ")}.`,
        findings: automaticProposals.map((p) => `auto:${p.kind}`),
      }),
      evidence: {
        autoAppliedCorrections: automaticProposals.map((p) => p.kind),
      },
    });
    stepIndex += 1;
    return { nextStepIndex: stepIndex, autoApproved: true };
  }

  // 5. No issue detected — auto-approve only when topic hierarchy is publishable.
  if (checkScopes.has("topics")) {
    const topicIssues = invalidTopicReasons(topicLabelsFromRow(row.topicCategories));
    if (topicIssues.length > 0) {
      const topicProposals = proposals.filter(
        (proposal) => proposal.kind === "set_topic_categories" && proposalMatchesCheckScopes(proposal, checkScopes),
      );
      const correctionPkg: CorrectionApprovalPackage = {
        phase: "awaiting_correction_approval",
        triage,
        proposals: topicProposals,
        note: `Topic hierarchy check failed: ${topicIssues.join("; ")}. Each day must carry exactly one homepage storyline leaf.`,
      };
      const stepId = await createStep({
        runId,
        stepIndex,
        agentName: "TopicValidatorAgent",
        status: "rejected",
        confidence: 0.45,
        input: { date: triage.date, route: triage.route },
        output: buildStepOutput({
          summary: "Topic hierarchy check failed before auto-approve",
          findings: topicIssues,
        }),
        rejectionReason: topicIssues.join("; "),
        suggestedAction: "manual_review",
      });
      stepIndex += 1;

      await db.insert(humanReviewQueue).values({
        runId,
        stepId,
        status: "pending",
        priority: 76,
        eventDate: triage.date,
        package: correctionPkg,
        reviewer: null,
        reviewedAt: null,
      });
      return { nextStepIndex: stepIndex, autoApproved: false };
    }
  }

  // 6. Tags-only runs must not auto-approve while tags_version2 is still empty.
  if (
    checkScopes.has("tags") &&
    normalizedTagsFromRow(row.tagsVersion2).length === 0 &&
    proposals.filter((proposal) => proposalMatchesCheckScopes(proposal, checkScopes)).length === 0
  ) {
    const correctionPkg: CorrectionApprovalPackage = {
      phase: "awaiting_correction_approval",
      triage,
      proposals: [],
      note: "Tag Agent found no grounded tags to add for this summary. Review manually or reject.",
    };
    const stepId = await createStep({
      runId,
      stepIndex,
      agentName: "TagManagerAgent",
      status: "completed",
      confidence: 0.55,
      input: { date: triage.date, route: triage.route },
      output: buildStepOutput({
        summary: "No tag proposals generated for an untagged day",
        findings: ["tags_version2 is empty", "tag_agent_proposals=0"],
      }),
    });
    stepIndex += 1;

    await db.insert(humanReviewQueue).values({
      runId,
      stepId,
      status: "pending",
      priority: 72,
      eventDate: triage.date,
      package: correctionPkg,
      reviewer: null,
      reviewedAt: null,
    });
    return { nextStepIndex: stepIndex, autoApproved: false };
  }

  // 7. No issue detected — auto-approve. This is the v3 "I looked and the
  // deterministic checks all pass" path; the legacy run still gets an entry so
  // operator can review history later.
  await db.insert(humanReviewQueue).values({
    runId,
    stepId: triageStepId,
    status: "approved",
    priority: 50,
    eventDate: triage.date,
    package: { triage, note: "V3 checks passed: no canonical mismatch, no strong duplicate, no proposals." },
    reviewer: "auto",
    reviewedAt: new Date(),
  });
  return { nextStepIndex: stepIndex, autoApproved: true };
}

async function executeRun(runId: string, opts: StartOpts, signal?: AbortSignal): Promise<void> {
  const checkScopes = normalizeCheckScopes(opts.checkScopes);
  await db
    .update(pipelineRuns)
    .set({
      stats: {
        phase: "triaging",
        heartbeatIso: new Date().toISOString(),
        checkScopes: Array.from(checkScopes),
      },
    })
    .where(eq(pipelineRuns.id, runId));

  let triage = await triageRange({
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    maxDaysToConsider: Math.max(1, Math.min(opts.maxDaysToConsider, 365)),
  });
  if (opts.targetDates?.length) {
    const allowed = new Set(opts.targetDates.filter(isIsoDate));
    triage = triage.filter((item) => allowed.has(item.date));
  }
  if (opts.partialRun) {
    triage = triage.filter((t) => t.date === opts.partialRun!.date);
  }

  triage.sort((a, b) => a.date.localeCompare(b.date));

  const effectiveTriageForStats: TriageItem[] = [];
  let autoApprovedCount = 0;

  let stepIndex = 1;
  for (const item of triage) {
    const [lockRow] = await db
      .select({ isLocked: historicalNewsAnalyses.isLocked })
      .from(historicalNewsAnalyses)
      .where(eq(historicalNewsAnalyses.date, item.date))
      .limit(1);
    if (lockRow?.isLocked) {
      const skipStepId = await createStep({
        runId,
        stepIndex,
        agentName: "NewsManager",
        status: "skipped",
        confidence: 100,
        input: { date: item.date, analysisId: item.analysisId },
        output: buildStepOutput({
          summary: `Skipped ${item.date} — operator locked this day`,
          findings: ["Day is locked; pipeline will not modify this record."],
        }),
        evidence: { reason: "operator_locked" },
      });
      await recordConfidence(runId, skipStepId, "NewsManager", 100, "Operator locked");
      stepIndex += 1;
      effectiveTriageForStats.push(item);
      continue;
    }

    const baseAgentsForDay =
      opts.partialRun && opts.partialRun.date === item.date ? opts.partialRun.agents : item.requiredAgents;
    const agentsForDay = baseAgentsForDay.filter((agent) => agentMatchesCheckScopes(agent, checkScopes));

    // NewsManager triage step
    const triageStepId = await createStep({
      runId,
      stepIndex,
      agentName: "NewsManager",
      status: "completed",
      confidence: item.confidence,
      input: { date: item.date, analysisId: item.analysisId },
      output: buildStepOutput({
        summary: `Triage route ${item.route} selected for ${item.date}`,
        findings: item.reasons,
      }),
      evidence: {
        triageRuleVersion: "v1",
        requiredAgents: item.requiredAgents,
        executedAgents: agentsForDay,
        selectedCheckScopes: Array.from(checkScopes),
        partialRun: Boolean(opts.partialRun && opts.partialRun.date === item.date),
      },
    });
    await recordConfidence(runId, triageStepId, "NewsManager", item.confidence, item.reasons.join("; "));
    stepIndex += 1;

    // V3 gated fetch: for empty/missing days, fetch Exa candidates only and
    // hand off to a human picker. The legacy chain is intentionally skipped —
    // summary/tag/topic generation happens after the operator picks an article.
    const useGatedFetch = shouldUseGatedArticlePick(item.route, checkScopes);

    if (useGatedFetch) {
      const pool = await fetchCandidatesForDate(item.date, {
        requestId: `pipeline-${runId}-${item.date}`,
        source: "editorial-pipeline-v3",
      });

      const sourceStepId = await createStep({
        runId,
        stepIndex,
        agentName: "SourceFinderAgent",
        status: pool.hasCandidates ? "completed" : "rejected",
        confidence: pool.hasCandidates ? 0.85 : 0.4,
        input: { date: item.date, route: item.route, mode: "v3-gated-fetch" },
        output: buildStepOutput({
          summary:
            pool.hasCandidates ?
              `Fetched ${pool.candidates.length} candidate article(s) across tiers (bitcoin=${pool.perTierCounts.bitcoin}, crypto=${pool.perTierCounts.crypto}, macro=${pool.perTierCounts.macro}); awaiting human pick.`
            : `No candidate articles found from Exa across any tier for ${item.date}. Operator should confirm the day is truly empty.`,
          findings: pool.candidates.slice(0, 6).map((c) => `${c.tier}: ${c.title} (${c.url})`),
        }),
        evidence: {
          perTierCounts: pool.perTierCounts,
          totalCandidates: pool.candidates.length,
          calendarSanityWarnings: pool.candidates.filter((c) => !c.calendarSanityOk).length,
        },
        rejectionReason: pool.hasCandidates ? null : "Empty candidate pool from Exa",
        suggestedAction: pool.hasCandidates ? null : "manual_review",
      });
      await recordConfidence(
        runId,
        sourceStepId,
        "SourceFinderAgent",
        pool.hasCandidates ? 0.85 : 0.4,
        pool.hasCandidates ? "Candidates ready for human pick" : "No candidates fetched from Exa",
      );
      stepIndex += 1;

      const removedCtx =
        opts.removedDayContext && item.date === opts.dateFrom ? opts.removedDayContext : undefined;
      const pickPackage: ArticlePickPackage = {
        phase: "awaiting_article_pick",
        scenario: item.route === "empty_day" ? "empty_day" : "missing_day",
        triage: item,
        candidates: pool.candidates,
        hasCandidates: pool.hasCandidates,
        removedDayContext: removedCtx,
        note: removedCtx
          ? removedDayArticlePickNote(removedCtx, pool.hasCandidates)
          : pool.hasCandidates
            ? "Exa returned candidates for this day. Pick the winning article (or reject as empty). Summary, tags, and topics will be generated after your pick."
            : "Exa returned zero candidates across all three tiers. If this day really has no significant news, confirm as empty. Otherwise reject and we'll widen the search.",
      };

      await db.insert(humanReviewQueue).values({
        runId,
        stepId: sourceStepId,
        status: "pending",
        priority: item.route === "missing_day" ? 95 : 90,
        eventDate: item.date,
        package: pickPackage,
        reviewer: null,
        reviewedAt: null,
      });

      effectiveTriageForStats.push(item);
      // Skip the legacy handoff chain — operator gate intervenes here.
      continue;
    }

    // Unified existing-day branch: deterministic + LLM checks via corpus-clean graph.
    const useUnifiedExistingChecks = shouldUseUnifiedExistingDayClean(item.route, item.analysisId);

    if (useUnifiedExistingChecks) {
      const handled = await runV3ExistingDayChecks({
        runId,
        triage: item,
        triageStepId,
        startStepIndex: stepIndex,
        checkScopes,
      });
      stepIndex = handled.nextStepIndex;
      if (handled.autoApproved) autoApprovedCount += 1;
      effectiveTriageForStats.push(item);
      continue;
    }

    if (agentsForDay.length === 0 || (!item.analysisId && !checkScopes.has("relevance"))) {
      effectiveTriageForStats.push(item);
      autoApprovedCount += 1;
      await db.insert(humanReviewQueue).values({
        runId,
        stepId: triageStepId,
        status: "approved",
        priority: 40,
        eventDate: item.date,
        package: {
          triage: item,
          note: "Selected checks are not applicable to this route; no action needed.",
          selectedCheckScopes: Array.from(checkScopes),
        },
        reviewer: "auto",
        reviewedAt: new Date(),
      });
      continue;
    }

    const handoffChain = buildHandoffChain({
      fromAgent: "NewsManager",
      toAgents: agentsForDay,
      analysisId: item.analysisId,
      date: item.date,
      confidence: item.confidence,
      reasons: item.reasons,
      route: item.route,
      sourceStepId: triageStepId,
    });

    let hadRejected = false;
    let hadSkipped = false;
    let firstBlocker: {
      agent: PipelineAgentName;
      reason?: string;
      suggestedAction?: string;
    } | null = null;
    let executedAgentSteps = 0;
    for (const handoff of handoffChain) {
      const toAgent = handoff.toAgent;
      await db.insert(pipelineHandoffs).values({
        runId,
        fromAgent: handoff.fromAgent,
        toAgent: handoff.toAgent,
        payload: handoff.payload,
      });
      const out = await runAgentWithRetry(runId, item, toAgent, stepIndex);
      stepIndex = out.nextStepIndex;
      executedAgentSteps += 1;
      if (out.lastStatus === "rejected" || out.lastStatus === "error") hadRejected = true;
      if (out.lastStatus === "skipped") hadSkipped = true;
      if (!firstBlocker && (out.lastStatus === "rejected" || out.lastStatus === "error")) {
        const rej = extractRejection(out.lastOutput);
        firstBlocker = {
          agent: toAgent,
          reason: rej?.reason ?? out.lastStatus,
          suggestedAction: rej?.suggestedAction,
        };
      }
      if (out.lastStepId) {
        await db.insert(pipelineHandoffs).values({
          runId,
          fromAgent: toAgent,
          toAgent: "NewsManager",
          payload: buildHandoffPayload({
            analysisId: item.analysisId,
            date: item.date,
            status: "needs_review",
            confidence: 0.8,
            reason: `${toAgent} completed`,
            nextAgent: "NewsManager",
            metadata: { sourceStepId: out.lastStepId },
          }),
        });
      }
      if (
        EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT &&
        (out.lastStatus === "rejected" || out.lastStatus === "error")
      ) {
        break;
      }
    }

    const shortCircuited =
      EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT &&
      hadRejected &&
      executedAgentSteps < handoffChain.length;

    let queueTriage = item;
    if (item.route === "empty_day" && item.analysisId) {
      const refreshed = await retriageSingleExistingDate(item.date);
      if (refreshed) queueTriage = refreshed;
    }
    effectiveTriageForStats.push(queueTriage);

    const reviewNote =
      item.route === "empty_day" && queueTriage.route !== item.route ?
        `Initial triage: ${item.route}. Re-evaluated after agents using latest DB row: ${queueTriage.route}.`
      : "Generated by NewsManager + stage executors. Existing search and summary flows are preserved.";

    const autoApprove =
      queueTriage.route === "existing_ok" &&
      item.route === "existing_ok" &&
      !hadRejected &&
      !hadSkipped;
    if (autoApprove) autoApprovedCount += 1;

    await db.insert(humanReviewQueue).values({
      runId,
      stepId: triageStepId,
      status: autoApprove ? "approved" : "pending",
      priority:
        queueTriage.route === "missing_day" ? 95
        : queueTriage.route === "empty_day" ? 90
        : queueTriage.route === "existing_needs_correction" ? 75
        : 50,
      eventDate: item.date,
      package: {
        triage: queueTriage,
        initialTriageRoute: item.route !== queueTriage.route ? item.route : undefined,
        note: autoApprove ? "Auto-approved: all checks passed with no changes." : reviewNote,
        operatorSnapshot: {
          shortCircuitOnReject: EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT,
          shortCircuited,
          firstBlocker,
          resumeStartsAvailable: validResumeStarts(item.requiredAgents),
          executedAgentSteps,
          scheduledAgentSteps: handoffChain.length,
          partialRun:
            opts.partialRun && opts.partialRun.date === item.date ?
              { date: opts.partialRun.date, agents: opts.partialRun.agents }
            : null,
        },
      },
      reviewer: autoApprove ? "auto" : null,
      reviewedAt: autoApprove ? new Date() : null,
    });
  }

  const managerNarrative = await generateManagerNarrative(effectiveTriageForStats, signal);
  const [pendingReview] = await db
    .select({ c: count() })
    .from(humanReviewQueue)
    .where(and(eq(humanReviewQueue.runId, runId), eq(humanReviewQueue.status, "pending")));

  await db
    .update(pipelineRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      stats: {
        phase: "completed",
        triageCount: triage.length,
        routeCounts: effectiveTriageForStats.reduce<Record<string, number>>((acc, tri) => {
          acc[tri.route] = (acc[tri.route] || 0) + 1;
          return acc;
        }, {}),
        managerNarrative,
        humanReviewQueued: Number(pendingReview?.c ?? 0),
        autoApprovedCount,
        shortCircuitOnReject: EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT,
      },
    })
    .where(eq(pipelineRuns.id, runId));
}

export async function startEditorialPipelineRun(opts: StartOpts): Promise<{ runId: string }> {
  if (!EDITORIAL_PIPELINE_ENABLED) {
    throw new Error("Editorial pipeline is disabled by feature flag (EDITORIAL_PIPELINE_ENABLED=0).");
  }
  const [created] = await db
    .insert(pipelineRuns)
    .values({
      status: "running",
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      model: EDITORIAL_DEFAULT_MODEL,
      requestedBy: opts.requestedBy || "admin-ui",
      config: {
        maxDaysToConsider: opts.maxDaysToConsider,
        mode: "triage-first",
        preserveExistingSearchAndSummary: true,
        resumedFromRunId: opts.resumedFromRunId || null,
        partialRun: opts.partialRun ?? null,
        shortCircuitOnReject: EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT,
      },
      stats: { phase: "queued" },
    })
    .returning({ id: pipelineRuns.id });

  const runId = created.id;
  const controller = new AbortController();
  controllers.set(runId, controller);

  void executeRun(runId, opts, controller.signal)
    .catch(async (error) => {
      await db
        .update(pipelineRuns)
        .set({
          status: /abort|cancel/i.test(String(error)) ? "stopped" : "error",
          completedAt: new Date(),
          stats: {
            phase: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .where(eq(pipelineRuns.id, runId));
    })
    .finally(() => {
      controllers.delete(runId);
    });

  return { runId };
}

export function stopEditorialPipelineRun(runId: string): boolean {
  const c = controllers.get(runId);
  if (!c) return false;
  c.abort();
  return true;
}

export function pauseEditorialPipelineRun(runId: string): boolean {
  const c = controllers.get(runId);
  if (!c) return false;
  c.abort();
  void db
    .update(pipelineRuns)
    .set({ status: "paused", completedAt: new Date(), stats: { phase: "paused" } })
    .where(eq(pipelineRuns.id, runId));
  return true;
}

export async function resumeEditorialPipelineRun(runId: string): Promise<{ runId: string }> {
  const [runRow] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!runRow) throw new Error("Run not found");
  return startEditorialPipelineRun({
    dateFrom: runRow.dateFrom,
    dateTo: runRow.dateTo,
    maxDaysToConsider: Number((runRow.config as any)?.maxDaysToConsider || 60),
    requestedBy: "admin-ui",
    resumedFromRunId: runId,
  });
}

/** Triage + ordered anchors where a slice re-run may start (for operator UI). */
export async function getEditorialResumeOptions(date: string): Promise<{
  triage: TriageItem;
  resumeStartsAvailable: PipelineAgentName[];
}> {
  const triage = await triageRange({
    dateFrom: date,
    dateTo: date,
    maxDaysToConsider: 1,
  });
  const item = triage[0];
  if (!item) {
    throw new Error(`No triage for ${date} (no analysis in range or empty window).`);
  }
  return { triage: item, resumeStartsAvailable: validResumeStarts(item.requiredAgents) };
}

/**
 * Starts a **new** pipeline run for a single date, executing only the suffix of the triage chain
 * beginning at `startAgent` (inclusive). Use {@link getEditorialResumeOptions} to list valid starts.
 */
export async function startEditorialPipelineResumeSlice(opts: {
  date: string;
  startAgent: PipelineAgentName;
  requestedBy?: string;
}): Promise<{ runId: string }> {
  const triage = await triageRange({
    dateFrom: opts.date,
    dateTo: opts.date,
    maxDaysToConsider: 1,
  });
  const item = triage[0];
  if (!item) {
    throw new Error(`No triage item for ${opts.date}`);
  }
  const agents = agentsTailFromStart(item.requiredAgents, opts.startAgent);
  return startEditorialPipelineRun({
    dateFrom: opts.date,
    dateTo: opts.date,
    maxDaysToConsider: 1,
    requestedBy: opts.requestedBy ?? "resume-slice",
    partialRun: { date: opts.date, agents },
  });
}

export function isEditorialPipelineRunActive(runId: string): boolean {
  return controllers.has(runId);
}

export async function getEditorialPipelineRun(runId: string): Promise<{
  run: unknown;
  steps: unknown[];
  humanReviewItems: unknown[];
  handoffs: unknown[];
  live: { activeInThisRuntime: boolean };
} | null> {
  const [runRow] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!runRow) return null;
  const steps = await db
    .select()
    .from(pipelineSteps)
    .where(eq(pipelineSteps.runId, runId))
    .orderBy(asc(pipelineSteps.stepIndex));
  const humanReviewItems = await db
    .select({
      id: humanReviewQueue.id,
      stepId: humanReviewQueue.stepId,
      eventDate: humanReviewQueue.eventDate,
      status: humanReviewQueue.status,
      createdAt: humanReviewQueue.createdAt,
    })
    .from(humanReviewQueue)
    .where(eq(humanReviewQueue.runId, runId))
    .orderBy(asc(humanReviewQueue.createdAt));
  const handoffs = await db
    .select()
    .from(pipelineHandoffs)
    .where(eq(pipelineHandoffs.runId, runId))
    .orderBy(desc(pipelineHandoffs.createdAt));
  return {
    run: runRow,
    steps,
    humanReviewItems,
    handoffs,
    live: {
      activeInThisRuntime: isEditorialPipelineRunActive(runId),
    },
  };
}

export async function shadowValidatePipelineWindow(opts: {
  dateFrom: string;
  dateTo: string;
  maxDaysToConsider: number;
}): Promise<{
  triageCount: number;
  routeCounts: Record<string, number>;
  reviewQueueCreated: number;
}> {
  const triage = await triageRange(opts);
  const routeCounts = triage.reduce<Record<string, number>>((acc, item) => {
    acc[item.route] = (acc[item.route] || 0) + 1;
    return acc;
  }, {});
  return {
    triageCount: triage.length,
    routeCounts,
    reviewQueueCreated: triage.length,
  };
}

export function getEditorialCutoverStatus() {
  return {
    featureFlagEnabled: EDITORIAL_PIPELINE_ENABLED,
    requiredHumanApproval: true,
    autoApprovalEnabled: true,
    defaultModel: EDITORIAL_DEFAULT_MODEL,
    shortCircuitOnReject: EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT,
    cutoverReadyChecks: {
      featureFlagEnabled: EDITORIAL_PIPELINE_ENABLED,
      humanApprovalGatePresent: true,
      autoApprovalEnabled: true,
      parallelModeOnly: true,
      shortCircuitOnReject: EDITORIAL_PIPELINE_SHORT_CIRCUIT_ON_REJECT,
    },
  };
}

import { z } from "zod";

import { apiMonitor } from "../api-monitor";

export type ResearchTier = "bitcoin" | "crypto" | "macro";

export type DayResearchResult = {
  found: boolean;
  tier: ResearchTier | null;
  eventTitle: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  eventSnippet: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  citations: string[];
};

export const RESEARCH_TIER_ORDER: ResearchTier[] = ["bitcoin", "crypto", "macro"];

const BASE_URL = "https://api.perplexity.ai/chat/completions";
const DEFAULT_MODEL = "sonar";
const MAX_RATE_LIMIT_RETRIES = 5;
const BASE_RETRY_MS = 2_000;

const tierResponseSchema = z.object({
  found: z.boolean(),
  eventDate: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  sourceTitle: z.string().nullable().optional(),
  eventSnippet: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  reasoning: z.string().optional(),
});

/** Hostnames we never accept as the manual-entry source. */
export const BLOCKED_SOURCE_HOSTS = [
  "youtube.com",
  "youtu.be",
  "wikipedia.org",
  "wikimedia.org",
  "howlongagogo.com",
  "thefactsite.com",
  "onthisday.com",
  "britannica.com",
  "investopedia.com",
  "medium.com",
  "reddit.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "globalissues.org",
  "timeanddate.com",
  "history.com",
];

/** Recognised wire, newspaper, broadcast, and crypto trade press. */
export const RECOGNIZED_MEDIA_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "ap.org",
  "afp.com",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
  "latimes.com",
  "cnn.com",
  "nbcnews.com",
  "cbsnews.com",
  "abcnews.go.com",
  "npr.org",
  "politico.com",
  "thehill.com",
  "bbc.com",
  "bbc.co.uk",
  "theguardian.com",
  "ft.com",
  "telegraph.co.uk",
  "independent.co.uk",
  "economist.com",
  "cnbc.com",
  "marketwatch.com",
  "forbes.com",
  "fortune.com",
  "businessinsider.com",
  "coindesk.com",
  "cointelegraph.com",
  "theblock.co",
  "decrypt.co",
  "news.bitcoin.com",
  "bitcoinmagazine.com",
  "arstechnica.com",
  "techcrunch.com",
  "wired.com",
  "axios.com",
  "pbs.org",
  "whitehouse.gov",
  "treasury.gov",
  "sec.gov",
  "federalreserve.gov",
  "justice.gov",
  "congress.gov",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.toLowerCase().includes("rate limit");
}

function normalizeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function citationHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isBlockedSourceUrl(url: string): boolean {
  const host = citationHost(url);
  if (!host) return true;
  return BLOCKED_SOURCE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function isRecognizedMediaUrl(url: string): boolean {
  const host = citationHost(url);
  if (!host || isBlockedSourceUrl(url)) return false;
  if (host.endsWith(".gov") || host.endsWith(".edu")) return true;
  return RECOGNIZED_MEDIA_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

const REJECTABLE_EVENT_COPY =
  /\b(no (?:significant )?event|not verified|could not verify|no .*? event|nothing (?:significant )?happened|evergreen|on this day in history|anniversary piece|retrospective|explainer|background article|history of)\b/i;

/** Reject self-contradicting or evergreen research copy. */
export function isRejectableEventCopy(...parts: Array<string | null | undefined>): boolean {
  const text = parts.filter(Boolean).join(" ").trim();
  if (!text) return true;
  return REJECTABLE_EVENT_COPY.test(text);
}

export function validateEventDateClaim(
  eventDate: string | null | undefined,
  targetDate: string,
): string | null {
  if (!eventDate?.trim()) {
    return "missing eventDate — must equal target calendar day";
  }
  const normalized = eventDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `invalid eventDate "${eventDate}"`;
  }
  if (normalized !== targetDate) {
    return `eventDate ${normalized} does not match target ${targetDate}`;
  }
  return null;
}

function domainScore(url: string): number {
  const host = citationHost(url);
  if (!host) return 0;
  const idx = RECOGNIZED_MEDIA_DOMAINS.findIndex(
    (hint) => host === hint || host.endsWith(`.${hint}`),
  );
  if (idx >= 0) return RECOGNIZED_MEDIA_DOMAINS.length - idx;
  if (host.endsWith(".gov")) return 50;
  return 0;
}

/** Pick best Sonar citation from recognised media only (https, not blocked). */
export function pickBestCitationUrl(citations: string[]): string | null {
  const candidates = citations
    .map((c) => normalizeHttpsUrl(c))
    .filter((c): c is string => Boolean(c))
    .filter((c) => isRecognizedMediaUrl(c));

  const unique = [...new Set(candidates)];
  if (unique.length === 0) return null;

  unique.sort((a, b) => {
    const scoreDiff = domainScore(b) - domainScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.length - b.length;
  });

  return unique[0] ?? null;
}

export type ResearchAcceptance = {
  accepted: boolean;
  reasons: string[];
};

/** Code-level gate after Sonar responds — stricter than the prompt alone. */
export function evaluateResearchAcceptance(input: {
  targetDate: string;
  found: boolean;
  confidence: "high" | "medium" | "low";
  eventDate?: string | null;
  eventTitle?: string | null;
  eventSnippet?: string | null;
  reasoning?: string | null;
  sourceUrl?: string | null;
}): ResearchAcceptance {
  const reasons: string[] = [];
  if (!input.found) reasons.push("sonar returned found=false");
  if (input.confidence !== "high") reasons.push(`confidence is ${input.confidence}, need high`);

  const dateError = validateEventDateClaim(input.eventDate, input.targetDate);
  if (dateError) reasons.push(dateError);

  if (isRejectableEventCopy(input.eventTitle, input.eventSnippet, input.reasoning)) {
    reasons.push("event copy looks evergreen or self-contradicting");
  }

  if (!input.sourceUrl) {
    reasons.push("no recognised-media citation URL");
  } else if (!isRecognizedMediaUrl(input.sourceUrl)) {
    reasons.push("citation is not recognised media");
  } else if (isBlockedSourceUrl(input.sourceUrl)) {
    reasons.push("citation host is blocked");
  }

  return { accepted: reasons.length === 0, reasons };
}

function tierScope(tier: ResearchTier): string {
  if (tier === "bitcoin") {
    return "Bitcoin-only: price moves, protocol upgrades, mining, adoption, regulation directly about Bitcoin/BTC, Lightning, halvings, ETF flows tied to Bitcoin.";
  }
  if (tier === "crypto") {
    return "Broader crypto/Web3: Ethereum, altcoins, DeFi, NFTs, exchanges, stablecoins, crypto policy — but NOT pure Bitcoin-only stories unless nothing else exists.";
  }
  return "Global macroeconomics: central banks, rates, inflation, GDP, geopolitics, major financial markets — only when no relevant Bitcoin or crypto event exists for that date.";
}

function buildTierPrompt(
  date: string,
  tier: ResearchTier,
  opts?: { priorSummary?: string; topicLeaf?: string | null },
): string {
  const priorBlock = opts?.priorSummary?.trim()
    ? `\nThe calendar currently shows this summary (likely wrong or undated): "${opts.priorSummary.trim()}"\nDo NOT reuse it unless you verify a matching event ON ${date}.`
    : "";
  const topicBlock = opts?.topicLeaf?.trim()
    ? `\nPreferred storyline leaf (secondary hint only): ${opts.topicLeaf.trim()}`
    : "";

  return `Find ONE concrete news event that happened ON the exact calendar date ${date} — no exceptions.

Scope (${tier} tier — ${tierScope(tier)}):
- The event must have occurred ON ${date} only (UTC calendar day). Not the day before, not the day after.
- Do NOT use events merely "announced", "remembered", "recapped", or "first reported" on a different day.
- You MUST cite a contemporaneous article published ON ${date} from recognised media (Reuters, AP, BBC, NYT, WSJ, Bloomberg, NPR, CoinDesk, etc.).
- REJECT: Wikipedia, YouTube, "on this day" pages, explainers, retrospectives, anniversary pieces, evergreen background.
- If no event in this tier scope occurred ON ${date} with a recognised-media source from that day, set found=false.
${priorBlock}${topicBlock}

Return JSON only:
{
  "found": boolean,
  "eventDate": "${date}",
  "eventTitle": "headline of the event" | null,
  "sourceUrl": "https://..." | null,
  "sourceTitle": "publication name" | null,
  "eventSnippet": "1-3 sentences describing what happened ON ${date}" | null,
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation proving the event and source are from ${date}"
}`;
}

const TIER_SYSTEM_PROMPT =
  "You are a strict historical news researcher. Use web search. Only accept events that occurred on the exact target calendar date with contemporaneous recognised-media reporting from that same date. If unsure, set found=false. Respond with valid JSON only.";

type FetchImpl = typeof fetch;

async function callPerplexityTier(
  date: string,
  tier: ResearchTier,
  opts: { priorSummary?: string; topicLeaf?: string | null } | undefined,
  fetchImpl: FetchImpl,
  apiKey: string,
): Promise<DayResearchResult> {
  const startTime = Date.now();
  const requestId = apiMonitor.logRequest({
    service: "perplexity",
    endpoint: "/chat/completions",
    method: "POST",
    status: "pending",
    context: "day-research-tier",
    date,
    purpose: `Research ${tier} tier event for ${date}`,
    requestData: { model: DEFAULT_MODEL, tier },
  });

  const prompt = buildTierPrompt(date, tier, opts);
  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: TIER_SYSTEM_PROMPT },
      { role: "user", content: `${prompt}\n\nRespond ONLY with valid JSON.` },
    ],
    temperature: 0.1,
    max_tokens: 900,
    return_citations: true,
    web_search_options: { search_context_size: "medium" },
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(BASE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Perplexity API error: ${response.status} ${text}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; citations?: string[] } }>;
        citations?: string[];
      };

      const text = data.choices?.[0]?.message?.content ?? "{}";
      const cleanContent = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const jsonStart = cleanContent.indexOf("{");
      if (jsonStart === -1) {
        throw new Error("No JSON object found in Perplexity response");
      }

      let braceCount = 0;
      let jsonEnd = jsonStart;
      for (let i = jsonStart; i < cleanContent.length; i += 1) {
        if (cleanContent[i] === "{") braceCount += 1;
        if (cleanContent[i] === "}") braceCount -= 1;
        if (braceCount === 0) {
          jsonEnd = i + 1;
          break;
        }
      }

      const parsed = tierResponseSchema.parse(JSON.parse(cleanContent.substring(jsonStart, jsonEnd)));

      const citations: string[] = [];
      if (Array.isArray(data.citations)) citations.push(...data.citations);
      if (Array.isArray(data.choices?.[0]?.message?.citations)) {
        citations.push(...(data.choices?.[0]?.message?.citations ?? []));
      }

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

      const result: DayResearchResult = {
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

      apiMonitor.updateRequest(requestId, {
        status: "success",
        duration: Date.now() - startTime,
        responseData: { tier, found: result.found },
      });

      return result;
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
        break;
      }
      const waitMs = BASE_RETRY_MS * 2 ** (attempt - 1);
      await sleep(waitMs);
    }
  }

  apiMonitor.updateRequest(requestId, {
    status: "error",
    duration: Date.now() - startTime,
    error: (lastError as Error)?.message ?? String(lastError),
  });
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Run tier waterfall; inject researchTierFn in tests. */
export async function runResearchWaterfall(
  date: string,
  opts: { priorSummary?: string; topicLeaf?: string | null } | undefined,
  researchTierFn: (
    tier: ResearchTier,
  ) => Promise<DayResearchResult>,
): Promise<DayResearchResult> {
  const misses: string[] = [];

  for (const tier of RESEARCH_TIER_ORDER) {
    const result = await researchTierFn(tier);
    if (result.found && result.sourceUrl) {
      return { ...result, tier };
    }
    if (result.found && !result.sourceUrl) {
      misses.push(`${tier}: found event but no https source`);
    } else {
      misses.push(`${tier}: ${result.reasoning || "no significant dated event"}`);
    }
  }

  return {
    found: false,
    tier: null,
    eventTitle: null,
    sourceUrl: null,
    sourceTitle: null,
    eventSnippet: null,
    confidence: "low",
    reasoning: misses.join(" | "),
    citations: [],
  };
}

export async function researchSignificantEventForDate(
  date: string,
  opts?: { priorSummary?: string; topicLeaf?: string | null },
  deps?: { fetch?: FetchImpl; apiKey?: string },
): Promise<DayResearchResult> {
  const apiKey = deps?.apiKey ?? process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("PERPLEXITY_API_KEY environment variable is required");
  }

  const fetchImpl = deps?.fetch ?? fetch;

  return runResearchWaterfall(date, opts, (tier) =>
    callPerplexityTier(date, tier, opts, fetchImpl, apiKey),
  );
}

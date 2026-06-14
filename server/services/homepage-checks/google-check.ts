import { evaluateGoogleCheckRetrospectiveHeuristic } from "../../../shared/google-check-heuristics";
import { aiService } from "../ai";
import type { AiProviderType } from "../ai/types";

/** Verdict: did the substantive event happen on this calendar date? */
export type GoogleCheckHappened = "yes" | "no" | "uncertain";

export type GoogleCheckRowResult = {
  happened: GoogleCheckHappened;
};

export type GoogleCheckBatchResult = {
  totalDays: number;
  yesDays: number;
  noDays: number;
  uncertainDays: number;
  skippedDays: number;
  affectedDates: string[];
  skippedDates: string[];
  results: Record<string, GoogleCheckRowResult>;
};

export function isGoogleCheckAlreadyDone(
  value: string | null | undefined,
): value is GoogleCheckHappened {
  return value === "yes" || value === "no" || value === "uncertain";
}

export function partitionGoogleCheckItems(
  items: GoogleCheckInputItem[],
  existingByDate: Map<string, string | null | undefined>,
): {
  toCheck: GoogleCheckInputItem[];
  skipped: Array<{ date: string; happened: GoogleCheckHappened }>;
} {
  const toCheck: GoogleCheckInputItem[] = [];
  const skipped: Array<{ date: string; happened: GoogleCheckHappened }> = [];

  for (const item of items) {
    const existing = existingByDate.get(item.date);
    if (isGoogleCheckAlreadyDone(existing)) {
      skipped.push({ date: item.date, happened: existing });
    } else {
      toCheck.push(item);
    }
  }

  return { toCheck, skipped };
}

export function mergeGoogleCheckBatchWithSkipped(
  batchResult: GoogleCheckBatchResult | null,
  skipped: Array<{ date: string; happened: GoogleCheckHappened }>,
): GoogleCheckBatchResult {
  const skippedResults: Record<string, GoogleCheckRowResult> = {};
  for (const skip of skipped) {
    skippedResults[skip.date] = { happened: skip.happened };
  }

  if (!batchResult) {
    return {
      totalDays: 0,
      yesDays: 0,
      noDays: 0,
      uncertainDays: 0,
      skippedDays: skipped.length,
      affectedDates: [],
      skippedDates: skipped.map((row) => row.date),
      results: skippedResults,
    };
  }

  return {
    ...batchResult,
    skippedDays: skipped.length,
    skippedDates: skipped.map((row) => row.date),
    results: { ...skippedResults, ...batchResult.results },
  };
}

export type GoogleCheckInputItem = {
  date: string;
  summary: string;
  topicLeaf?: string | null;
};

const MAX_ITEMS = 50;
const DEFAULT_CONCURRENCY = 1;
const MAX_RATE_LIMIT_RETRIES = 5;

/** Homepage verify provider (env: GOOGLE_CHECK_PROVIDER, default openai). */
export function getGoogleCheckProviderType(): AiProviderType {
  const raw = process.env.GOOGLE_CHECK_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "gemini" || raw === "perplexity") {
    return raw;
  }
  return "openai";
}

/** Parallel row checks (env: GOOGLE_CHECK_CONCURRENCY, legacy PERPLEXITY_CHECK_CONCURRENCY). */
export function getGoogleCheckConcurrency(): number {
  const raw =
    process.env.GOOGLE_CHECK_CONCURRENCY?.trim() ||
    process.env.PERPLEXITY_CHECK_CONCURRENCY?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return DEFAULT_CONCURRENCY;
}
const BASE_RETRY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.toLowerCase().includes("rate limit");
}

async function callVerifyHomepageEvent(
  item: GoogleCheckInputItem,
): Promise<GoogleCheckRowResult> {
  const summary = item.summary?.trim() ?? "";
  if (!summary) {
    return { happened: "uncertain" };
  }

  const retrospective = evaluateGoogleCheckRetrospectiveHeuristic(summary);
  if (retrospective.isRetrospective) {
    return { happened: "no" };
  }

  const providerType = getGoogleCheckProviderType();
  let verifyProvider;
  try {
    verifyProvider = aiService.getProvider(providerType);
  } catch (error) {
    console.warn(`${providerType} check skipped for ${item.date}: provider unavailable`, error);
    return { happened: "uncertain" };
  }

  if (!verifyProvider || !("verifyHomepageEvent" in verifyProvider)) {
    console.warn(`${providerType} check skipped for ${item.date}: verifyHomepageEvent not supported`);
    return { happened: "uncertain" };
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await (
        verifyProvider as {
          verifyHomepageEvent: (
            summary: string,
            date: string,
            topicLeaf?: string | null,
          ) => Promise<GoogleCheckRowResult>;
        }
      ).verifyHomepageEvent(summary, item.date, item.topicLeaf?.trim() || null);
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
        break;
      }
      const waitMs = BASE_RETRY_MS * 2 ** (attempt - 1);
      console.warn(
        `${providerType} rate limited for ${item.date}; retry ${attempt}/${MAX_RATE_LIMIT_RETRIES} in ${waitMs}ms`,
      );
      await sleep(waitMs);
    }
  }

  console.warn(`${providerType} check failed for ${item.date}:`, (lastError as Error)?.message ?? lastError);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function verifyRow(item: GoogleCheckInputItem): Promise<GoogleCheckRowResult> {
  try {
    return await callVerifyHomepageEvent(item);
  } catch {
    return { happened: "uncertain" };
  }
}

export async function runGoogleCheckSingleWithRetry(
  input: {
    date: string;
    summary: string;
    topicLeaf?: string | null;
  },
  opts?: { throwOnFailure?: boolean; delayAfterMs?: number },
): Promise<GoogleCheckRowResult> {
  const result = await callVerifyHomepageEvent({
    date: input.date,
    summary: input.summary,
    topicLeaf: input.topicLeaf ?? null,
  });
  if (opts?.delayAfterMs && opts.delayAfterMs > 0) {
    await sleep(opts.delayAfterMs);
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await fn(items[current]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

export async function runGoogleCheckBatch(items: GoogleCheckInputItem[]): Promise<GoogleCheckBatchResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items array is required");
  }
  if (items.length > MAX_ITEMS) {
    throw new Error(`Cannot verify more than ${MAX_ITEMS} rows at once`);
  }

  const normalized = items.map((item) => ({
    date: item.date,
    summary: item.summary ?? "",
    topicLeaf: item.topicLeaf ?? null,
  }));

  const rowResults = await mapWithConcurrency(normalized, getGoogleCheckConcurrency(), verifyRow);

  const results: Record<string, GoogleCheckRowResult> = {};
  let yesDays = 0;
  let noDays = 0;
  let uncertainDays = 0;

  normalized.forEach((item, idx) => {
    const row = rowResults[idx]!;
    results[item.date] = row;
    if (row.happened === "yes") yesDays += 1;
    else if (row.happened === "no") noDays += 1;
    else uncertainDays += 1;
  });

  return {
    totalDays: normalized.length,
    yesDays,
    noDays,
    uncertainDays,
    skippedDays: 0,
    affectedDates: normalized.map((item) => item.date),
    skippedDates: [],
    results,
  };
}

export async function runGoogleCheckSingle(input: {
  date: string;
  summary: string;
  topicLeaf?: string | null;
}): Promise<GoogleCheckRowResult> {
  return verifyRow({
    date: input.date,
    summary: input.summary,
    topicLeaf: input.topicLeaf ?? null,
  });
}

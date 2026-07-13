import {
  buildRarityAgentUserPrompt,
  RARITY_AGENT_SYSTEM_PROMPT,
} from "../../../shared/rarity-prompts";
import { normalizeRarity, parseRarityModelOutput, type Rarity } from "../../../shared/rarity";
import { storage } from "../../storage";
import { OpenAIProvider } from "../ai/openai-provider";

export const RARITY_AGENT_MODEL =
  process.env.RARITY_MODEL?.trim() || "gpt-5.4-mini";

const MAX_ITEMS = 100;
const DEFAULT_CONCURRENCY = 2;

export type RarityCheckInputItem = {
  date: string;
  summary: string;
};

export type RarityRowResult = {
  rarity: Rarity | null;
  error?: string;
};

export type RarityBatchResult = {
  totalDays: number;
  assignedDays: number;
  failedDays: number;
  results: Record<string, RarityRowResult>;
};

function getConcurrency(): number {
  const raw = process.env.RARITY_CONCURRENCY?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return DEFAULT_CONCURRENCY;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

let rarityProvider: OpenAIProvider | null = null;

function getRarityProvider(): OpenAIProvider {
  if (!rarityProvider) {
    rarityProvider = new OpenAIProvider();
  }
  return rarityProvider;
}

export async function classifyRarityFromSummary(summary: string): Promise<Rarity | null> {
  const trimmed = summary.trim();
  if (!trimmed) return null;

  const provider = getRarityProvider();
  const text = await provider.complete(buildRarityAgentUserPrompt(trimmed), {
    model: RARITY_AGENT_MODEL,
    systemPrompt: RARITY_AGENT_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 8,
  });

  return parseRarityModelOutput(text);
}

export async function runRarityBatch(items: RarityCheckInputItem[]): Promise<RarityBatchResult> {
  if (items.length === 0) {
    return { totalDays: 0, assignedDays: 0, failedDays: 0, results: {} };
  }
  if (items.length > MAX_ITEMS) {
    throw new Error(`Cannot assign rarity for more than ${MAX_ITEMS} days at once`);
  }

  const concurrency = getConcurrency();
  const rowResults = await mapWithConcurrency(items, concurrency, async (item) => {
    try {
      const rarity = await classifyRarityFromSummary(item.summary);
      if (!rarity) {
        return { date: item.date, result: { rarity: null, error: "unparseable" } as RarityRowResult };
      }
      return { date: item.date, result: { rarity } as RarityRowResult };
    } catch (error) {
      return {
        date: item.date,
        result: {
          rarity: null,
          error: error instanceof Error ? error.message : String(error),
        } as RarityRowResult,
      };
    }
  });

  const results: Record<string, RarityRowResult> = {};
  let assignedDays = 0;
  let failedDays = 0;

  for (const row of rowResults) {
    results[row.date] = row.result;
    if (row.result.rarity) assignedDays += 1;
    else failedDays += 1;
  }

  return {
    totalDays: items.length,
    assignedDays,
    failedDays,
    results,
  };
}

export async function persistRarityResults(batch: RarityBatchResult): Promise<number> {
  let updated = 0;
  for (const [date, row] of Object.entries(batch.results)) {
    if (!row.rarity) continue;
    await storage.updateAnalysis(date, { rarity: row.rarity });
    updated += 1;
  }
  return updated;
}

/** Re-classify invalid stored values. */
export async function fixInvalidRarityForDate(
  date: string,
  summary: string,
): Promise<Rarity | null> {
  const rarity = await classifyRarityFromSummary(summary);
  if (!rarity) return null;
  await storage.updateAnalysis(date, { rarity });
  return rarity;
}

export function normalizeStoredRarity(value: string | null | undefined): Rarity | null {
  return normalizeRarity(value);
}

/**
 * Per-leaf batch cleanup worker for Perplexity bulk verification.
 *
 * Processes a batch of no/uncertain rows on a completed leaf (unchecked=0):
 *   1. Ensure winning article exists
 *   2. Summary / topic / tag agents when needed
 *   3. Re-verify with Perplexity
 *
 * Usage:
 *   npx tsx server/scripts/run-perplexity-cleanup-leaf.ts --leaf "Early Bitcoin history" --dates "2020-01-01,2020-01-02" --batch-index 1 --batch-total 3
 *   npx tsx server/scripts/run-perplexity-cleanup-leaf.ts --leaf "Protocol & upgrades" --batch-offset 0 --batch-size 10 --batch-index 1 --batch-total 19 --apply
 *   npx tsx server/scripts/run-perplexity-cleanup-leaf.ts --leaf "DeFi" --apply --max-rows 5
 */

import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve("client/.env") });

import { getGoogleCheckProviderType } from "../services/homepage-checks/google-check";
import {
  CLEANUP_BATCH_SIZE,
  batchAgentLabel,
  computeLeafBatches,
  createBatchLogger,
  createLeafLogger,
  createWorkerLogger,
  flaggedDatesFromRows,
  leafCleanupAgentLabel,
  randomDelayMs,
  runBatchCleanup,
  runLeafCleanup,
  runWorkerCleanup,
  setBatchProcessIdentity,
  setLeafProcessIdentity,
  setWorkerProcessIdentity,
  workerAgentLabel,
} from "./perplexity-cleanup-shared";
import { storage } from "../storage";

type Args = {
  leaf: string | null;
  apply: boolean;
  maxRows: number | null;
  delayMs: number;
  dates: string[] | null;
  batchIndex: number | null;
  batchTotal: number | null;
  batchOffset: number | null;
  batchSize: number | null;
  workerIndex: number | null;
  workerTotal: number | null;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const readFlagValue = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const delayRaw = readFlagValue("--delay-ms");
  const maxRowsRaw = readFlagValue("--max-rows");
  const batchIndexRaw = readFlagValue("--batch-index");
  const batchTotalRaw = readFlagValue("--batch-total");
  const batchOffsetRaw = readFlagValue("--batch-offset");
  const batchSizeRaw = readFlagValue("--batch-size");
  const datesRaw = readFlagValue("--dates");
  const workerIndexRaw = readFlagValue("--worker-index");
  const workerTotalRaw = readFlagValue("--worker-total");

  const delayMs =
    delayRaw != null
      ? Number(delayRaw)
      : process.env.CLEANUP_DELAY_MS?.trim()
        ? Number(process.env.CLEANUP_DELAY_MS.trim())
        : randomDelayMs();
  const maxRows = maxRowsRaw != null ? Number(maxRowsRaw) : null;
  const batchIndex = batchIndexRaw != null ? Number(batchIndexRaw) : null;
  const batchTotal = batchTotalRaw != null ? Number(batchTotalRaw) : null;
  const batchOffset = batchOffsetRaw != null ? Number(batchOffsetRaw) : null;
  const batchSize = batchSizeRaw != null ? Number(batchSizeRaw) : null;
  const workerIndex = workerIndexRaw != null ? Number(workerIndexRaw) : null;
  const workerTotal = workerTotalRaw != null ? Number(workerTotalRaw) : null;

  const dates =
    datesRaw?.trim()
      ? datesRaw
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      : null;

  return {
    leaf: readFlagValue("--leaf") ?? null,
    apply: argv.includes("--apply"),
    maxRows: maxRows != null && Number.isFinite(maxRows) && maxRows > 0 ? maxRows : null,
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0,
    dates,
    batchIndex:
      batchIndex != null && Number.isFinite(batchIndex) && batchIndex > 0 ? Math.floor(batchIndex) : null,
    batchTotal:
      batchTotal != null && Number.isFinite(batchTotal) && batchTotal > 0 ? Math.floor(batchTotal) : null,
    batchOffset:
      batchOffset != null && Number.isFinite(batchOffset) && batchOffset >= 0
        ? Math.floor(batchOffset)
        : null,
    batchSize:
      batchSize != null && Number.isFinite(batchSize) && batchSize > 0
        ? Math.floor(batchSize)
        : null,
    workerIndex:
      workerIndex != null && Number.isFinite(workerIndex) && workerIndex > 0
        ? Math.floor(workerIndex)
        : null,
    workerTotal:
      workerTotal != null && Number.isFinite(workerTotal) && workerTotal > 0
        ? Math.floor(workerTotal)
        : null,
  };
}

async function resolveBatchDates(args: Args): Promise<{
  dates: string[];
  batchIndex: number;
  batchTotal: number;
} | null> {
  if (args.dates && args.dates.length > 0) {
    const batchIndex = (args.batchIndex ?? 1) - 1;
    const batchTotal = args.batchTotal ?? 1;
    return { dates: args.dates, batchIndex, batchTotal };
  }

  if (args.batchOffset == null && args.batchSize == null && args.batchIndex == null) {
    return null;
  }

  const leaf = args.leaf!.trim();
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const allDates = flaggedDatesFromRows(rows);
  const size = args.batchSize ?? CLEANUP_BATCH_SIZE;
  const plans = computeLeafBatches(allDates, size);

  if (args.batchIndex != null) {
    const plan = plans[args.batchIndex - 1];
    if (!plan) {
      throw new Error(`Batch ${args.batchIndex} not found for leaf (${plans.length} batch(es) total)`);
    }
    return {
      dates: plan.dates,
      batchIndex: plan.batchIndex,
      batchTotal: plan.batchTotal,
    };
  }

  const offset = args.batchOffset ?? 0;
  const plan = plans.find((p) => p.batchIndex * size === offset) ?? plans.find((p) => {
    const start = p.batchIndex * size;
    return start === offset;
  });
  if (!plan) {
    const sliced = allDates.slice(offset, offset + size);
    if (sliced.length === 0) {
      throw new Error(`No dates at offset ${offset} for leaf`);
    }
    return {
      dates: sliced,
      batchIndex: Math.floor(offset / size),
      batchTotal: plans.length || Math.ceil(allDates.length / size),
    };
  }

  return {
    dates: plan.dates,
    batchIndex: plan.batchIndex,
    batchTotal: plan.batchTotal,
  };
}

async function main() {
  const args = parseArgs();

  if (!args.leaf?.trim()) {
    console.error('Required: --leaf "Leaf name"');
    process.exit(1);
  }

  const googleCheckProvider = getGoogleCheckProviderType();
  if (googleCheckProvider === "openai") {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      console.error("OPENAI_API_KEY is required when GOOGLE_CHECK_PROVIDER=openai (client/.env)");
      process.exit(1);
    }
  } else if (googleCheckProvider === "gemini") {
    if (
      !process.env.GOOGLE_API_KEY?.trim() &&
      !process.env.GEMINI_API_KEY?.trim()
    ) {
      console.error("GOOGLE_API_KEY or GEMINI_API_KEY is required when GOOGLE_CHECK_PROVIDER=gemini");
      process.exit(1);
    }
  } else if (!process.env.PERPLEXITY_API_KEY?.trim()) {
    console.error("PERPLEXITY_API_KEY is required when GOOGLE_CHECK_PROVIDER=perplexity (client/.env)");
    process.exit(1);
  }

  const leaf = args.leaf.trim();
  const batch = await resolveBatchDates(args);

  try {
    if (args.workerIndex != null && args.workerTotal != null) {
      setWorkerProcessIdentity(leaf, args.workerIndex, args.workerTotal);
      const logger = createWorkerLogger(leaf, args.workerIndex, args.workerTotal);
      await runWorkerCleanup({
        leaf,
        workerIndex: args.workerIndex,
        workerTotal: args.workerTotal,
        apply: args.apply,
        maxRows: args.maxRows,
        delayMs: args.delayMs,
        logger,
      });
      return;
    }

    if (batch) {
      setBatchProcessIdentity(leaf, batch.batchIndex, batch.batchTotal);
      const logger = createBatchLogger(leaf, batch.batchIndex, batch.batchTotal);
      await runBatchCleanup({
        leaf,
        dates: batch.dates,
        batchIndex: batch.batchIndex,
        batchTotal: batch.batchTotal,
        apply: args.apply,
        delayMs: args.delayMs,
        logger,
      });
      return;
    }

    setLeafProcessIdentity(leaf);
    const logger = createLeafLogger(leaf);
    await runLeafCleanup({
      leaf,
      apply: args.apply,
      maxRows: args.maxRows,
      delayMs: args.delayMs,
      logger,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const label = batch
      ? batchAgentLabel(leaf, batch.batchIndex, batch.batchTotal)
      : args.workerIndex != null && args.workerTotal != null
        ? workerAgentLabel(leaf, args.workerIndex, args.workerTotal)
        : leafCleanupAgentLabel(leaf);
    console.error(`${label} failed:`, message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Cleanup leaf worker failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

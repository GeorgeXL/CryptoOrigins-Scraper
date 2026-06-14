/**
 * Run Perplexity homepage checks leaf-by-leaf (or corpus-wide).
 *
 * Usage:
 *   npx tsx server/scripts/run-perplexity-check-all-leaves.ts --dry-run --all-leaves
 *   npx tsx server/scripts/run-perplexity-check-all-leaves.ts --all-leaves --retry-uncertain
 *   npx tsx server/scripts/run-perplexity-check-all-leaves.ts --leaf "Halving events"
 *   npx tsx server/scripts/run-perplexity-check-all-leaves.ts --all-leaves --uncertain-only --delay-ms 0
 */

import "dotenv/config";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve("client/.env") });

import { asc, eq } from "drizzle-orm";

import { historicalNewsAnalyses } from "../../shared/schema";
import {
  TOPIC_HIERARCHY,
  TOPIC_HIERARCHY_LEAVES,
  formatTopicLeafWithGroup,
} from "../../shared/topic-hierarchy";
import { db } from "../db";
import { runGoogleCheckSingleWithRetry } from "../services/homepage-checks/google-check";
import { storage } from "../storage";

type Args = {
  dryRun: boolean;
  allLeaves: boolean;
  leaf: string | null;
  retryUncertain: boolean;
  uncertainOnly: boolean;
  delayMs: number;
  limit: number | null;
  concurrency: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const readFlagValue = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const concurrencyRaw = readFlagValue("--concurrency");
  const concurrency = concurrencyRaw != null ? Number(concurrencyRaw) : 1;

  return {
    dryRun: !argv.includes("--apply"),
    allLeaves: argv.includes("--all-leaves"),
    leaf: readFlagValue("--leaf") ?? null,
    retryUncertain: argv.includes("--retry-uncertain"),
    uncertainOnly: argv.includes("--uncertain-only"),
    delayMs: Number(readFlagValue("--delay-ms") ?? "0"),
    limit: readFlagValue("--limit") ? Number(readFlagValue("--limit")) : null,
    concurrency: Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1,
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

function shouldCheck(
  googleCheckHappened: string | null | undefined,
  args: Args,
): boolean {
  if (args.uncertainOnly) {
    return googleCheckHappened === "uncertain";
  }
  if (googleCheckHappened == null) return true;
  return args.retryUncertain && googleCheckHappened === "uncertain";
}

async function processUncertainCorpus(
  args: Args,
  stats: { checked: number; yes: number; no: number; uncertain: number; skipped: number; errors: number },
): Promise<void> {
  const rows = await db
    .select({
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.googleCheckHappened, "uncertain"))
    .orderBy(asc(historicalNewsAnalyses.date));

  console.log(`\n=== All uncertain rows === todo ${rows.length}${args.dryRun ? " (dry-run)" : ""}`);

  let limitReached = false;

  await mapWithConcurrency(rows, args.concurrency, async (row) => {
    if (limitReached) return;
    if (args.limit != null && stats.checked >= args.limit) {
      limitReached = true;
      return;
    }

    if (args.dryRun) {
      console.log(`  · would check ${row.date}`);
      stats.skipped += 1;
      return;
    }

    try {
      const result = await runGoogleCheckSingleWithRetry(
        { date: row.date, summary: row.summary, topicLeaf: null },
        { delayAfterMs: args.delayMs },
      );

      await storage.updateAnalysisGoogleCheck(row.date, {
        googleCheckHappened: result.happened,
        googleCheckCheckedAt: new Date(),
      });

      stats.checked += 1;
      if (result.happened === "yes") stats.yes += 1;
      else if (result.happened === "no") stats.no += 1;
      else stats.uncertain += 1;

      console.log(`  ✓ ${row.date} → ${result.happened}`);

      if (stats.checked % 25 === 0) {
        console.log(
          `  … ${stats.checked} done · yes ${stats.yes} · no ${stats.no} · uncertain ${stats.uncertain}`,
        );
      }
    } catch (error) {
      stats.errors += 1;
      console.error(`  ✗ ${row.date}: ${error instanceof Error ? error.message : error}`);
    }
  });

  if (limitReached) {
    console.log("Limit reached; stopping.");
  }
}

async function processLeaf(
  leaf: string,
  args: Args,
  stats: { checked: number; yes: number; no: number; uncertain: number; skipped: number; errors: number },
): Promise<boolean> {
  const rows = await storage.getAnalysesForStorylineLeaf(leaf);
  const todo = rows.filter((row) => shouldCheck(row.googleCheckHappened, args));

  console.log(
    `\n=== ${formatTopicLeafWithGroup(leaf)} === rows ${rows.length} · todo ${todo.length}${args.dryRun ? " (dry-run)" : ""}`,
  );

  let limitReached = false;

  await mapWithConcurrency(todo, args.concurrency, async (row) => {
    if (limitReached) return;
    if (args.limit != null && stats.checked >= args.limit) {
      limitReached = true;
      return;
    }

    if (args.dryRun) {
      console.log(`  · would check ${row.date}`);
      stats.skipped += 1;
      return;
    }

    try {
      const result = await runGoogleCheckSingleWithRetry(
        {
          date: row.date,
          summary: row.summary,
          topicLeaf: leaf,
        },
        { delayAfterMs: args.delayMs },
      );

      await storage.updateAnalysisGoogleCheck(row.date, {
        googleCheckHappened: result.happened,
        googleCheckCheckedAt: new Date(),
      });

      stats.checked += 1;
      if (result.happened === "yes") stats.yes += 1;
      else if (result.happened === "no") stats.no += 1;
      else stats.uncertain += 1;

      console.log(`  ✓ ${row.date} → ${result.happened}`);

      if (stats.checked % 25 === 0) {
        console.log(
          `  … ${stats.checked} done · yes ${stats.yes} · no ${stats.no} · uncertain ${stats.uncertain}`,
        );
      }
    } catch (error) {
      stats.errors += 1;
      console.error(`  ✗ ${row.date}: ${error instanceof Error ? error.message : error}`);
    }
  });

  if (limitReached) {
    console.log("Limit reached; stopping.");
    return true;
  }
  return false;
}

async function main() {
  const args = parseArgs();

  if (!args.allLeaves && !args.leaf && !args.uncertainOnly) {
    console.error("Provide --all-leaves, --leaf \"Leaf name\", or --uncertain-only");
    process.exit(1);
  }

  if (!process.env.PERPLEXITY_API_KEY?.trim()) {
    console.error("PERPLEXITY_API_KEY is required");
    process.exit(1);
  }

  const leaves = args.uncertainOnly
    ? []
    : args.allLeaves
      ? TOPIC_HIERARCHY_LEAVES
      : [args.leaf!.trim()];

  console.log("=== Perplexity check batch ===");
  console.log(`Mode: ${args.dryRun ? "dry-run" : "apply"}`);
  console.log(`Leaves: ${leaves.length}`);
  console.log(`Retry uncertain: ${args.retryUncertain ? "yes" : "no"}`);
  console.log(`Uncertain only: ${args.uncertainOnly ? "yes" : "no"}`);
  console.log(`Delay between rows: ${args.delayMs}ms`);
  console.log(`Concurrency: ${args.concurrency} parallel Perplexity call(s)`);
  if (args.limit != null) console.log(`Limit: ${args.limit} rows`);

  const stats = { checked: 0, yes: 0, no: 0, uncertain: 0, skipped: 0, errors: 0 };

  if (args.uncertainOnly) {
    await processUncertainCorpus(args, stats);
  } else {
    for (const group of TOPIC_HIERARCHY) {
      for (const leaf of group.leaves) {
        if (!leaves.includes(leaf)) continue;
        const stop = await processLeaf(leaf, args, stats);
        if (stop || (args.limit != null && stats.checked >= args.limit)) break;
      }
      if (args.limit != null && stats.checked >= args.limit) break;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Checked: ${stats.checked}`);
  console.log(`Yes: ${stats.yes} · No: ${stats.no} · Uncertain: ${stats.uncertain}`);
  console.log(`Dry-run skipped: ${stats.skipped} · Errors (not saved): ${stats.errors}`);
}

main().catch((error) => {
  console.error("Batch failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

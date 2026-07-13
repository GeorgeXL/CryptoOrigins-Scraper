/**
 * Classify a random sample of locked days with the Rarity agent.
 *
 * Usage:
 *   npx tsx server/scripts/sample-locked-rarity.ts
 *   npx tsx server/scripts/sample-locked-rarity.ts --count 25 --seed 42
 *   npx tsx server/scripts/sample-locked-rarity.ts --non-bitcoin 15
 *   npx tsx server/scripts/sample-locked-rarity.ts --count 50 --seed 42 --persist
 */
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db } from "../db";
import { historicalNewsAnalyses } from "@shared/schema";
import { classifyRarityFromSummary, persistRarityResults, runRarityBatch } from "../services/homepage-checks/rarity-check";
import { RARITY_LABELS, type Rarity } from "../../shared/rarity";

const BITCOIN_RE =
  /\b(bitcoin|btc|crypto|blockchain|ethereum|eth|defi|nft|satoshi|halving|binance|coinbase|ftx|mt\.?gox|silk road|web3|stablecoin)\b/i;
const MACRO_RE =
  /\b(fed|federal reserve|inflation|gdp|recession|treasury|ecb|interest rate|cpi|unemployment|lehman|bailout|stimulus|election|president|congress|sec\b|regulation|housing|oil|opec|war|ukraine|china|tariff)\b/i;

function parseArgs() {
  const countIdx = process.argv.indexOf("--count");
  const seedIdx = process.argv.indexOf("--seed");
  const nonBitcoinIdx = process.argv.indexOf("--non-bitcoin");
  return {
    count: countIdx >= 0 ? Number(process.argv[countIdx + 1]) : 20,
    seed: seedIdx >= 0 ? Number(process.argv[seedIdx + 1]) : Date.now(),
    nonBitcoinOnly: nonBitcoinIdx >= 0,
    nonBitcoinCount:
      nonBitcoinIdx >= 0 ? Number(process.argv[nonBitcoinIdx + 1] || "15") : 0,
    persist: process.argv.includes("--persist"),
  };
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function bucketSummary(summary: string): "bitcoin-crypto" | "macro-policy" | "other" {
  if (BITCOIN_RE.test(summary)) return "bitcoin-crypto";
  if (MACRO_RE.test(summary)) return "macro-policy";
  return "other";
}

async function main() {
  const { count, seed, nonBitcoinOnly, nonBitcoinCount, persist } = parseArgs();

  const locked = await db
    .select({
      date: historicalNewsAnalyses.date,
      summary: historicalNewsAnalyses.summary,
      rarity: historicalNewsAnalyses.rarity,
    })
    .from(historicalNewsAnalyses)
    .where(eq(historicalNewsAnalyses.isLocked, true));

  let pool = locked;
  if (nonBitcoinOnly || nonBitcoinCount > 0) {
    const n = nonBitcoinCount || count;
    pool = locked.filter((row) => !BITCOIN_RE.test(row.summary ?? ""));
    const sample = shuffle(pool, seed).slice(0, n);
    await classifyAndPrint(sample, seed, pool.length, locked.length, "non-bitcoin locked", persist);
    return;
  }

  const sample = shuffle(pool, seed).slice(0, count);
  await classifyAndPrint(sample, seed, pool.length, locked.length, "all locked", persist);
}

async function classifyAndPrint(
  sample: { date: string; summary: string; rarity: string | null }[],
  seed: number,
  poolSize: number,
  lockedTotal: number,
  label: string,
  persist = false,
) {
  console.log(`Pool: ${label} · ${poolSize} rows (of ${lockedTotal} locked) · sample ${sample.length} · seed ${seed}${persist ? " · persist" : ""}\n`);

  const byBucket: Record<string, number> = {};
  const byRarity: Record<string, number> = {};

  const items = sample
    .map((row) => ({
      date: row.date,
      summary: row.summary?.trim() ?? "",
    }))
    .filter((row) => row.summary.length > 0);

  const batch = persist
    ? await runRarityBatch(items)
    : null;

  for (const row of sample) {
    const summary = row.summary?.trim() ?? "";
    const bucket = bucketSummary(summary);
    byBucket[bucket] = (byBucket[bucket] ?? 0) + 1;

    const rarity = persist
      ? batch?.results[row.date]?.rarity ?? null
      : await classifyRarityFromSummary(summary);
    const key = rarity ?? "null";
    byRarity[key] = (byRarity[key] ?? 0) + 1;

    console.log(
      [
        row.date,
        bucket.padEnd(14),
        (rarity ? RARITY_LABELS[rarity as Rarity] : "—").padEnd(14),
        summary.length > 100 ? `${summary.slice(0, 100)}…` : summary,
      ].join(" · "),
    );
  }

  console.log("\n---");
  console.log("Story bucket:", byBucket);
  console.log("Rarity:", byRarity);

  if (persist && batch) {
    const updated = await persistRarityResults(batch);
    console.log(`Persisted: ${updated}/${batch.totalDays} (failed: ${batch.failedDays})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

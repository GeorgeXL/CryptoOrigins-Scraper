/**
 * Re-classify locked days with rarity in {artifact, infamous, landmark}
 * and report / optionally fix mismatches vs current prompt.
 *
 * Usage:
 *   npx tsx server/scripts/verify-rarity-tiers.ts
 *   npx tsx server/scripts/verify-rarity-tiers.ts --fix
 *   npx tsx server/scripts/verify-rarity-tiers.ts --shard 0/4 --fix
 */
import "dotenv/config";

import { classifyRarityFromSummary } from "../services/homepage-checks/rarity-check";
import { RARITY_LABELS, type Rarity } from "../../shared/rarity";

type Row = { date: string; summary: string; rarity: Rarity };

const TARGET = new Set(["artifact", "infamous", "landmark"]);

function parseArgs() {
  const shardIdx = process.argv.indexOf("--shard");
  let shardIndex = 0;
  let shardCount = 1;
  if (shardIdx >= 0) {
    const [a, b] = String(process.argv[shardIdx + 1] ?? "0/1").split("/").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= 1 && a >= 0 && a < b) {
      shardIndex = a;
      shardCount = b;
    }
  }
  return {
    fix: process.argv.includes("--fix"),
    shardIndex,
    shardCount,
  };
}

function getConcurrency(): number {
  const n = Number(process.env.RARITY_CONCURRENCY ?? "5");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function restHeaders(key: string, extra?: Record<string, string>) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...(extra ?? {}) };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await fn(items[current]!, current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function fetchTargetRows(): Promise<Row[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY required");

  const pageSize = 1000;
  const out: Row[] = [];
  let offset = 0;
  for (;;) {
    const endpoint =
      `${url}/rest/v1/historical_news_analyses` +
      `?select=date,summary,rarity` +
      `&is_locked=eq.true` +
      `&rarity=in.(artifact,infamous,landmark)` +
      `&order=date.asc` +
      `&limit=${pageSize}` +
      `&offset=${offset}`;
    const res = await fetch(endpoint, { headers: restHeaders(key) });
    if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const rows = (await res.json()) as Row[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (TARGET.has(row.rarity) && row.summary?.trim()) out.push(row);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function persistRarity(date: string, rarity: Rarity): Promise<void> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const res = await fetch(
    `${url}/rest/v1/historical_news_analyses?date=eq.${encodeURIComponent(date)}`,
    {
      method: "PATCH",
      headers: restHeaders(key, {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      }),
      body: JSON.stringify({ rarity }),
    },
  );
  if (!res.ok) {
    throw new Error(`PATCH ${date} failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function main() {
  const { fix, shardIndex, shardCount } = parseArgs();
  const concurrency = getConcurrency();
  const label = shardCount > 1 ? `shard ${shardIndex}/${shardCount}` : "all";

  const all = await fetchTargetRows();
  const items =
    shardCount <= 1 ? all : all.filter((row) => hash(row.date) % shardCount === shardIndex);

  console.log(
    `Verify rarity tiers · ${label} · pool=${all.length} · this=${items.length} · fix=${fix} · concurrency=${concurrency}\n`,
  );

  let agree = 0;
  let disagree = 0;
  let failed = 0;
  let fixed = 0;
  const transitions: Record<string, number> = {};
  const samples: string[] = [];

  await mapWithConcurrency(items, concurrency, async (item, i) => {
    try {
      const next = await classifyRarityFromSummary(item.summary);
      if (!next) {
        failed += 1;
        console.log(`[${label}] ${item.date} stored=${item.rarity} → null`);
        return;
      }
      if (next === item.rarity) {
        agree += 1;
      } else {
        disagree += 1;
        const key = `${item.rarity}→${next}`;
        transitions[key] = (transitions[key] ?? 0) + 1;
        const line = `${item.date} · ${RARITY_LABELS[item.rarity]} → ${RARITY_LABELS[next]} · ${item.summary.slice(0, 90)}`;
        if (samples.length < 40) samples.push(line);
        console.log(`[${label}] ✗ ${line}`);
        if (fix) {
          await persistRarity(item.date, next);
          fixed += 1;
        }
      }
      if ((i + 1) % 100 === 0 || i + 1 === items.length) {
        console.log(`[${label}] progress ${i + 1}/${items.length} · agree=${agree} disagree=${disagree}`);
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[${label}] ${item.date} FAILED`,
        error instanceof Error ? error.message : error,
      );
    }
  });

  console.log(`\n--- [${label}] ---`);
  console.log(`Agree ${agree} · disagree ${disagree} · failed ${failed}${fix ? ` · fixed ${fixed}` : ""}`);
  console.log("Transitions:", transitions);
  if (samples.length) {
    console.log("\nSample mismatches:");
    for (const s of samples.slice(0, 20)) console.log(`  ${s}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

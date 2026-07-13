/**
 * Backfill rarity for locked days missing rarity via Supabase REST (HTTPS)
 * + Rarity Agent (gpt-5.4-mini).
 *
 * Usage:
 *   RARITY_CONCURRENCY=5 npx tsx server/scripts/backfill-rarity-rest.ts --all --shard 0/4
 *   RARITY_CONCURRENCY=5 npx tsx server/scripts/backfill-rarity-rest.ts --count 500
 */
import "dotenv/config";

import { classifyRarityFromSummary } from "../services/homepage-checks/rarity-check";
import type { Rarity } from "../../shared/rarity";

type Row = { date: string; summary: string };

function parseArgs() {
  const countIdx = process.argv.indexOf("--count");
  const shardIdx = process.argv.indexOf("--shard");
  const all = process.argv.includes("--all");
  let shardIndex = 0;
  let shardCount = 1;
  if (shardIdx >= 0) {
    const raw = String(process.argv[shardIdx + 1] ?? "0/1");
    const [a, b] = raw.split("/").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= 1 && a >= 0 && a < b) {
      shardIndex = a;
      shardCount = b;
    }
  }
  const count =
    countIdx >= 0 && Number.isFinite(Number(process.argv[countIdx + 1]))
      ? Math.floor(Number(process.argv[countIdx + 1]))
      : all
        ? Number.POSITIVE_INFINITY
        : 500;
  return { count, shardIndex, shardCount, all };
}

function getConcurrency(): number {
  const n = Number(process.env.RARITY_CONCURRENCY ?? "5");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
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

function restHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(extra ?? {}),
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function fetchAllLockedNoRarity(): Promise<Row[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY required");

  const pageSize = 1000;
  const out: Row[] = [];
  let offset = 0;

  for (;;) {
    const endpoint =
      `${url}/rest/v1/historical_news_analyses` +
      `?select=date,summary` +
      `&is_locked=eq.true` +
      `&rarity=is.null` +
      `&summary=not.is.null` +
      `&order=date.asc` +
      `&limit=${pageSize}` +
      `&offset=${offset}`;

    const res = await fetch(endpoint, { headers: restHeaders(key) });
    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const rows = (await res.json()) as Row[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (typeof row.summary === "string" && row.summary.trim().length > 0) {
        out.push(row);
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

function selectShard(rows: Row[], shardIndex: number, shardCount: number, count: number): Row[] {
  const shardRows =
    shardCount <= 1
      ? rows
      : rows.filter((row) => hash(row.date) % shardCount === shardIndex);
  if (!Number.isFinite(count) || count === Number.POSITIVE_INFINITY) return shardRows;
  return shardRows.slice(0, count);
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
  const { count, shardIndex, shardCount } = parseArgs();
  const concurrency = getConcurrency();
  const label = shardCount > 1 ? `shard ${shardIndex}/${shardCount}` : "single";
  console.log(`Backfill rarity · ${label} · concurrency=${concurrency}`);

  const pool = await fetchAllLockedNoRarity();
  const items = selectShard(pool, shardIndex, shardCount, count);
  console.log(`Pool ${pool.length} locked-no-rarity · this worker ${items.length}`);

  const byRarity: Record<string, number> = {};
  let assigned = 0;
  let failed = 0;
  let written = 0;

  await mapWithConcurrency(items, concurrency, async (item, i) => {
    try {
      const rarity = await classifyRarityFromSummary(item.summary);
      if (!rarity) {
        failed += 1;
        byRarity.null = (byRarity.null ?? 0) + 1;
        console.log(`[${label}] [${i + 1}/${items.length}] ${item.date} → —`);
        return;
      }
      await persistRarity(item.date, rarity);
      assigned += 1;
      written += 1;
      byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
      if ((i + 1) % 50 === 0 || i === 0 || i + 1 === items.length) {
        console.log(`[${label}] [${i + 1}/${items.length}] ${item.date} → ${rarity}`);
      }
    } catch (error) {
      failed += 1;
      byRarity.error = (byRarity.error ?? 0) + 1;
      console.error(
        `[${label}] [${i + 1}/${items.length}] ${item.date} FAILED`,
        error instanceof Error ? error.message : error,
      );
    }
  });

  console.log(`\n--- [${label}] ---`);
  console.log(`Assigned ${assigned} · written ${written} · failed ${failed}`);
  console.log("Rarity:", byRarity);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Report §12 KPIs for a sample of days (calls LLM when enabled).
 * Usage: npx tsx server/scripts/corpus-metrics-report.ts --from 2010-01-01 --to 2020-12-31 --count 14
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { computeCorpusMetricsForDates } from "../services/editorial-pipeline/corpus-metrics";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    from: get("--from") ?? "2010-01-01",
    to: get("--to") ?? "2020-12-31",
    count: Number(get("--count") ?? "14"),
    seed: get("--seed") ?? "metrics",
  };
}

function seededShuffle<T>(items: T[], seedStr: string): T[] {
  const arr = [...items];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i += 1) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = await db.execute(sql`
    SELECT date::text AS date FROM historical_news_analyses
    WHERE date >= ${args.from}::date AND date <= ${args.to}::date
    ORDER BY date ASC
  `);
  const dates = seededShuffle(
    (pool.rows as { date: string }[]).map((r) => r.date),
    args.seed,
  ).slice(0, args.count);

  console.log(`Metrics sample: ${dates.length} days (${args.from} → ${args.to})\n`);
  const report = await computeCorpusMetricsForDates(dates);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

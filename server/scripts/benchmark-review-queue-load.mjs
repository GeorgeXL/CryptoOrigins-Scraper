/**
 * Benchmark review-queue list loading (legacy vs optimized).
 * Usage: node server/scripts/benchmark-review-queue-load.mjs [--mode=legacy|optimized|both]
 */
import pg from "pg";
import dotenv from "dotenv";
import { performance } from "node:perf_hooks";

dotenv.config();

const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "both";
const STATUS = "pending";
const LIMIT = 200;

function normalizeEventDate(d) {
  if (d == null) return null;
  if (typeof d === "string") return d.length >= 10 ? d.slice(0, 10) : null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

function isCorrectionPackage(pkg) {
  return pkg && typeof pkg === "object" && Array.isArray(pkg.proposals);
}

function needsHeavyArticles(row) {
  const ymd = normalizeEventDate(row.event_date);
  if (!ymd) return false;
  const pkg = row.package;
  if (!isCorrectionPackage(pkg)) return false;
  return pkg.proposals.some((p) => p?.kind === "redo_summary" || p?.kind === "edit_summary");
}

async function legacyLoad(pool) {
  const t0 = performance.now();
  let queryCount = 0;

  const q = async (sql, params) => {
    queryCount += 1;
    return pool.query(sql, params);
  };

  const rowsRes = await q(
    `SELECT * FROM human_review_queue WHERE status = $1 ORDER BY priority DESC, created_at ASC LIMIT $2`,
    [STATUS, LIMIT],
  );
  const rows = rowsRes.rows;

  const dates = [...new Set(rows.map((r) => normalizeEventDate(r.event_date)).filter(Boolean))];
  const calendarExpectedDates = [
    ...new Set(
      rows
        .map((r) => (r.package?.expectedDate && typeof r.package.expectedDate === "string" ? r.package.expectedDate : null))
        .filter(Boolean),
    ),
  ];
  const analysisLookupDates = [...new Set([...dates, ...calendarExpectedDates])];

  let analysisBytes = 0;
  if (analysisLookupDates.length) {
    const analysesRes = await q(
      `SELECT date, summary, top_article_id, tiered_articles, analyzed_articles, topic_categories, tags_version2,
              total_articles_fetched, tier_used, winning_tier
       FROM historical_news_analyses WHERE date = ANY($1::date[])`,
      [analysisLookupDates],
    );
    for (const a of analysesRes.rows) {
      analysisBytes += Buffer.byteLength(JSON.stringify(a.tiered_articles ?? null));
      analysisBytes += Buffer.byteLength(JSON.stringify(a.analyzed_articles ?? null));
    }

    for (const ymd of dates) {
      await q(`SELECT top_article_id, is_manual_override FROM historical_news_analyses WHERE date = $1 LIMIT 1`, [ymd]);
      await q(
        `SELECT slug, label, description FROM canonical_milestones WHERE expected_date = $1 LIMIT 1`,
        [ymd],
      );
      await q(`SELECT title, description FROM manual_news_entries WHERE date = $1`, [ymd]);
    }
  }

  const elapsedMs = performance.now() - t0;
  const packageBytes = rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.package ?? null)), 0);

  return {
    rows: rows.length,
    uniqueDates: dates.length,
    queryCount,
    elapsedMs,
    packageBytes,
    analysisBytes,
    payloadBytes: packageBytes + analysisBytes,
  };
}

async function optimizedLoad(pool) {
  const t0 = performance.now();
  let queryCount = 0;

  const q = async (sql, params) => {
    queryCount += 1;
    return pool.query(sql, params);
  };

  const rowsRes = await q(
    `SELECT id, run_id, step_id, status, priority, event_date, reviewer, review_notes, package, created_at, reviewed_at
     FROM human_review_queue WHERE status = $1 ORDER BY priority DESC, created_at ASC LIMIT $2`,
    [STATUS, LIMIT],
  );
  const rows = rowsRes.rows;

  const dates = [...new Set(rows.map((r) => normalizeEventDate(r.event_date)).filter(Boolean))];
  const calendarExpectedDates = [
    ...new Set(
      rows
        .map((r) => (r.package?.expectedDate && typeof r.package.expectedDate === "string" ? r.package.expectedDate : null))
        .filter(Boolean),
    ),
  ];
  const analysisLookupDates = [...new Set([...dates, ...calendarExpectedDates])];
  const heavyDates = [...new Set(rows.filter(needsHeavyArticles).map((r) => normalizeEventDate(r.event_date)).filter(Boolean))];

  let analysisBytes = 0;
  if (analysisLookupDates.length) {
    await q(
      `SELECT date, summary, top_article_id, topic_categories, tags_version2, total_articles_fetched, tier_used, winning_tier, is_manual_override
       FROM historical_news_analyses WHERE date = ANY($1::date[])`,
      [analysisLookupDates],
    );

    if (heavyDates.length) {
      const heavyRes = await q(
        `SELECT date, top_article_id, tiered_articles, analyzed_articles
         FROM historical_news_analyses WHERE date = ANY($1::date[])`,
        [heavyDates],
      );
      for (const a of heavyRes.rows) {
        analysisBytes += Buffer.byteLength(JSON.stringify(a.tiered_articles ?? null));
        analysisBytes += Buffer.byteLength(JSON.stringify(a.analyzed_articles ?? null));
      }
    }

    if (dates.length) {
      await q(
        `SELECT expected_date, slug, label, description FROM canonical_milestones WHERE expected_date = ANY($1::date[])`,
        [dates],
      );
      await q(`SELECT date, title, description FROM manual_news_entries WHERE date = ANY($1::date[])`, [dates]);
    }
  }

  const elapsedMs = performance.now() - t0;
  const packageBytes = rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.package ?? null)), 0);

  return {
    rows: rows.length,
    uniqueDates: dates.length,
    heavyDates: heavyDates.length,
    queryCount,
    elapsedMs,
    packageBytes,
    analysisBytes,
    payloadBytes: packageBytes + analysisBytes,
  };
}

async function run(label, fn, pool, iterations = 3) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    samples.push(await fn(pool));
  }
  samples.sort((a, b) => a.elapsedMs - b.elapsedMs);
  const med = samples[Math.floor(samples.length / 2)];
  console.log(`\n[${label}] median of ${iterations} runs`);
  console.log(JSON.stringify(med, null, 2));
  return med;
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

try {
  if (mode === "legacy" || mode === "both") {
    await run("legacy", legacyLoad, pool);
  }
  if (mode === "optimized" || mode === "both") {
    await run("optimized", optimizedLoad, pool);
  }
} finally {
  await pool.end();
}

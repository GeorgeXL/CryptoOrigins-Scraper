/**
 * Restore tiered_articles, article_tags, analyzed_articles from a backup DB into live,
 * matched by date. Only fills columns that are NULL on live and non-null on backup.
 *
 * Usage:
 *   RESTORE_DATABASE_URL='postgresql://...' npx tsx server/scripts/restore-analysis-artifacts-from-backup.ts
 *   RESTORE_DATABASE_URL='postgresql://...' npx tsx server/scripts/restore-analysis-artifacts-from-backup.ts --apply
 *   ... --batch-size 25
 */
import "dotenv/config";

import pg from "pg";

function parseArgs() {
  const batchIdx = process.argv.indexOf("--batch-size");
  const batchSize = batchIdx >= 0 ? Number(process.argv[batchIdx + 1]) : 25;
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("--batch-size must be a positive number");
  }
  return {
    apply: process.argv.includes("--apply"),
    batchSize,
  };
}

function pool(url: string, label: string) {
  if (!url) throw new Error(`${label} database URL is required`);
  return new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 30_000,
  });
}

type CandidateRow = {
  date: string;
  live_tiered: boolean;
  live_tags: boolean;
  live_analyzed: boolean;
  backup_tiered: boolean;
  backup_tags: boolean;
  backup_analyzed: boolean;
};

type ArtifactRow = {
  date: string;
  tiered_articles: unknown;
  article_tags: unknown;
  analyzed_articles: unknown;
};

async function loadCandidates(live: pg.Pool, backup: pg.Pool): Promise<CandidateRow[]> {
  const liveDates = await live.query<{ date: string }>(`
    SELECT date::text AS date
    FROM historical_news_analyses
    ORDER BY date ASC
  `);
  const dateSet = new Set(liveDates.rows.map((r) => r.date));
  const backupDates = await backup.query<{ date: string }>(`
    SELECT date::text AS date
    FROM historical_news_analyses
    ORDER BY date ASC
  `);

  const candidates: CandidateRow[] = [];
  const batchSize = 200;
  for (let i = 0; i < backupDates.rows.length; i += batchSize) {
    const chunk = backupDates.rows.slice(i, i + batchSize).filter((r) => dateSet.has(r.date));
    if (chunk.length === 0) continue;

    const dates = chunk.map((r) => r.date);
    const [liveRows, backupRows] = await Promise.all([
      live.query<{
        date: string;
        has_tiered: boolean;
        has_tags: boolean;
        has_analyzed: boolean;
      }>(
        `
        SELECT
          date::text AS date,
          tiered_articles IS NOT NULL AS has_tiered,
          article_tags IS NOT NULL AS has_tags,
          analyzed_articles IS NOT NULL AS has_analyzed
        FROM historical_news_analyses
        WHERE date = ANY($1::date[])
        `,
        [dates],
      ),
      backup.query<{
        date: string;
        has_tiered: boolean;
        has_tags: boolean;
        has_analyzed: boolean;
      }>(
        `
        SELECT
          date::text AS date,
          tiered_articles IS NOT NULL AS has_tiered,
          article_tags IS NOT NULL AS has_tags,
          analyzed_articles IS NOT NULL AS has_analyzed
        FROM historical_news_analyses
        WHERE date = ANY($1::date[])
        `,
        [dates],
      ),
    ]);

    const liveByDate = new Map(liveRows.rows.map((r) => [r.date, r]));
    for (const b of backupRows.rows) {
      const l = liveByDate.get(b.date);
      if (!l) continue;
      const restoreTiered = !l.has_tiered && b.has_tiered;
      const restoreTags = !l.has_tags && b.has_tags;
      const restoreAnalyzed = !l.has_analyzed && b.has_analyzed;
      if (!restoreTiered && !restoreTags && !restoreAnalyzed) continue;
      candidates.push({
        date: b.date,
        live_tiered: l.has_tiered,
        live_tags: l.has_tags,
        live_analyzed: l.has_analyzed,
        backup_tiered: b.has_tiered,
        backup_tags: b.has_tags,
        backup_analyzed: b.has_analyzed,
      });
    }
  }

  return candidates.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchBackupArtifacts(backup: pg.Pool, dates: string[]): Promise<Map<string, ArtifactRow>> {
  const result = await backup.query<ArtifactRow>(
    `
    SELECT
      date::text AS date,
      tiered_articles,
      article_tags,
      analyzed_articles
    FROM historical_news_analyses
    WHERE date = ANY($1::date[])
    `,
    [dates],
  );
  return new Map(result.rows.map((r) => [r.date, r]));
}

async function applyBatch(
  live: pg.Pool,
  backupArtifacts: Map<string, ArtifactRow>,
  candidates: CandidateRow[],
): Promise<number> {
  const client = await live.connect();
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const c of candidates) {
      const src = backupArtifacts.get(c.date);
      if (!src) continue;

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (!c.live_tiered && c.backup_tiered) {
        sets.push(`tiered_articles = $${idx++}::jsonb`);
        values.push(JSON.stringify(src.tiered_articles));
      }
      if (!c.live_tags && c.backup_tags) {
        sets.push(`article_tags = $${idx++}::jsonb`);
        values.push(JSON.stringify(src.article_tags));
      }
      if (!c.live_analyzed && c.backup_analyzed) {
        sets.push(`analyzed_articles = $${idx++}::jsonb`);
        values.push(JSON.stringify(src.analyzed_articles));
      }
      if (sets.length === 0) continue;

      values.push(c.date);
      await client.query(
        `
        UPDATE historical_news_analyses
        SET ${sets.join(", ")}
        WHERE date = $${idx}::date
        `,
        values,
      );
      updated += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return updated;
}

async function measureLive(live: pg.Pool) {
  const result = await live.query(`
    SELECT
      COUNT(*) FILTER (WHERE tiered_articles IS NOT NULL)::int AS with_tiered,
      COUNT(*) FILTER (WHERE article_tags IS NOT NULL)::int AS with_tags,
      COUNT(*) FILTER (WHERE analyzed_articles IS NOT NULL)::int AS with_analyzed
    FROM historical_news_analyses
  `);
  return result.rows[0];
}

async function main() {
  const { apply, batchSize } = parseArgs();
  const liveUrl = process.env.DATABASE_URL;
  const backupUrl = process.env.RESTORE_DATABASE_URL;
  const live = pool(liveUrl!, "LIVE (DATABASE_URL)");
  const backup = pool(backupUrl!, "BACKUP (RESTORE_DATABASE_URL)");

  try {
    const before = await measureLive(live);
    const candidates = await loadCandidates(live, backup);

    const summary = {
      mode: apply ? "apply" : "dry-run",
      candidateDates: candidates.length,
      restoreTiered: candidates.filter((c) => !c.live_tiered && c.backup_tiered).length,
      restoreTags: candidates.filter((c) => !c.live_tags && c.backup_tags).length,
      restoreAnalyzed: candidates.filter((c) => !c.live_analyzed && c.backup_analyzed).length,
      liveBefore: before,
      sampleDates: candidates.slice(0, 5).map((c) => c.date),
    };
    console.log(JSON.stringify(summary, null, 2));

    if (!apply) {
      console.log("\nDry run complete — pass --apply to restore columns from backup.");
      return;
    }

    if (candidates.length === 0) {
      console.log("\nNothing to restore.");
      return;
    }

    let restoredDates = 0;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const chunk = candidates.slice(i, i + batchSize);
      const artifacts = await fetchBackupArtifacts(
        backup,
        chunk.map((c) => c.date),
      );
      restoredDates += await applyBatch(live, artifacts, chunk);
      console.log(`Restored batch ${Math.floor(i / batchSize) + 1}: ${chunk.length} dates`);
    }

    const after = await measureLive(live);
    console.log(
      JSON.stringify(
        {
          restoredDates,
          liveAfter: after,
        },
        null,
        2,
      ),
    );
  } finally {
    await live.end();
    await backup.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

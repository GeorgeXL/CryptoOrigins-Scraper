import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres.gtfbpvohnmmcvhrbqayq:kseYMqRLcFaCiWBK@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 5000
});

try {
  const res = await pool.query("SELECT date, summary FROM historical_news_analyses WHERE date = '2024-12-30' LIMIT 1;");
  console.log('Query result:', res.rows);
} catch (err) {
  console.error('Query failed:', err);
} finally {
  await pool.end();
}

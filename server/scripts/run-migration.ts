import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Disable SSL certificate verification for self-signed certs (Supabase pooler)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config({ path: path.join(__dirname, '../../.env') });

const { Pool } = pg;

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL or POSTGRES_URL not set!');
  process.exit(1);
}

async function runMigration() {
  // Clean the connection string
  let cleanConnectionString = databaseUrl.split(/\s+/)[0].replace(/"/g, '');
  cleanConnectionString = cleanConnectionString.replace(/[?&]supa=[^&]*/g, '');
  cleanConnectionString = cleanConnectionString.replace(/\?&/, '?');
  
  if (!cleanConnectionString.includes('sslmode=')) {
    const separator = cleanConnectionString.includes('?') ? '&' : '?';
    cleanConnectionString += `${separator}sslmode=require`;
  }

  const pool = new Pool({
    connectionString: cleanConnectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '../../supabase/migrations/20251121213137_add_final_analysis_columns.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Running migration: add_final_analysis_columns');
    console.log('SQL:', migrationSQL);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migrationSQL);
      await client.query('COMMIT');
      console.log('✅ Migration completed successfully!');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();


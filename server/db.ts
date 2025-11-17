import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

// Disable SSL certificate verification for self-signed certs (Supabase pooler)
// This is safe because we're still using SSL encryption, just not verifying the cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Pool } = pg;
import * as schema from "@shared/schema";

// Function to get database URL lazily (not at module load time)
// This ensures Vercel's environment variables are available when accessed
function getDatabaseUrl(): string {
  const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("⚠️  WARNING: DATABASE_URL or POSTGRES_URL not set!");
    console.error("   The server will start but database operations will fail.");
    console.error("   Set DATABASE_URL in your .env file or Vercel environment variables.");
    throw new Error("FATAL: DATABASE_URL or POSTGRES_URL is not set in environment variables.");
  }
  
  // Log partial connection info for debugging (hide sensitive parts) - only on first access
  try {
    const urlParts = new URL(databaseUrl);
    console.log(`✅ DATABASE_URL found: ${urlParts.protocol}//${urlParts.hostname}:${urlParts.port}/${urlParts.pathname.split('/').pop()}`);
  } catch {
    // If URL parsing fails, just confirm it's set
    console.log(`✅ DATABASE_URL found (format: ${databaseUrl.substring(0, 20)}...)`);
  }
  
  return databaseUrl;
}

// Create connection pool for Supabase PostgreSQL
let poolInstance: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

function getDbInstance() {
  if (dbInstance) {
    return dbInstance;
  }

  // Get database URL lazily (reads from process.env at runtime, not module load time)
  const databaseUrl = getDatabaseUrl();

  try {
    const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const maxConnections = isServerless ? 2 : 15;

    console.log(`🔧 LAZY INIT: Creating database pool (serverless: ${isServerless}, max: ${maxConnections})...`);

    // Clean the connection string - remove supa parameter
    let cleanConnectionString = databaseUrl.replace(/[?&]supa=[^&]*/g, '');
    cleanConnectionString = cleanConnectionString.replace(/\?&/, '?');
    
    // Ensure sslmode=require is in the connection string
    if (!cleanConnectionString.includes('sslmode=')) {
      const separator = cleanConnectionString.includes('?') ? '&' : '?';
      cleanConnectionString += `${separator}sslmode=require`;
    }

    console.log(`🔧 Using connection string: ${cleanConnectionString.substring(0, 60)}...`);

    poolInstance = new Pool({
      connectionString: cleanConnectionString,
      max: maxConnections,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: false
      }
    });

    poolInstance.on('error', (err: Error) => {
      console.error('❌ Database pool runtime error:', err.message);
    });

    dbInstance = drizzle({ client: poolInstance, schema });
    console.log('✅ LAZY INIT: Database pool and drizzle instance created.');
    return dbInstance;

  } catch (error) {
    console.error('❌ LAZY INIT FAILED: Failed to create database pool:', error);
    if (error instanceof Error) {
        console.error('   Error message:', error.message);
    }
    // Re-throw the error to be caught by the handler in api/index.ts
    throw error;
  }
}

// Use a proxy to lazily initialize the db connection on first access
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    return (getDbInstance() as any)[prop];
  }
});

// Note: Direct export of the pool is removed as it's less safe.
// If direct pool access is needed, a similar proxy could be created.
// For now, all database access should go through the 'db' export.
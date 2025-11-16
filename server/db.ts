import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const { Pool } = pg;
import * as schema from "@shared/schema";

// Support both DATABASE_URL and POSTGRES_URL (Vercel Storage integration)
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// Log database URL status (without exposing the full connection string)
if (!databaseUrl) {
  console.error("⚠️  WARNING: DATABASE_URL or POSTGRES_URL not set!");
  console.error("   The server will start but database operations will fail.");
  console.error("   Set DATABASE_URL in your .env file or Vercel environment variables.");
} else {
  // Log partial connection info for debugging (hide sensitive parts)
  try {
    const urlParts = new URL(databaseUrl);
    console.log(`✅ DATABASE_URL found: ${urlParts.protocol}//${urlParts.hostname}:${urlParts.port}/${urlParts.pathname.split('/').pop()}`);
  } catch {
    // If URL parsing fails, just confirm it's set
    console.log(`✅ DATABASE_URL found (format: ${databaseUrl.substring(0, 20)}...)`);
  }
}

// Create connection pool for Supabase PostgreSQL
let poolInstance: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

if (databaseUrl) {
  try {
    // For serverless (Vercel), use smaller pool size to avoid connection limits
    const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const maxConnections = isServerless ? 2 : 15; // Vercel serverless functions have connection limits
    
    console.log(`🔧 Creating database pool (serverless: ${isServerless}, max: ${maxConnections})...`);
    
    // Use connection string directly - pg.Pool handles parsing
    poolInstance = new Pool({ 
      connectionString: databaseUrl,
      // Optimized for serverless environments
      max: maxConnections,
      idleTimeoutMillis: 30000, // 30 seconds for serverless
      connectionTimeoutMillis: 10000, // 10 second timeout
      ssl: {
        rejectUnauthorized: false // Required for Supabase - allows self-signed certs
      }
    });

    // Handle pool errors with better logging
    poolInstance.on('error', (err: Error) => {
      console.error('❌ Database pool error:', err.message);
      console.error('   Error code:', (err as any).code);
      // Don't exit - just log the error
    });

    dbInstance = drizzle({ client: poolInstance, schema });
    console.log('✅ Database pool and drizzle instance created');
    
    // Test the connection asynchronously (don't block module loading)
    // This is just for logging - don't fail if it doesn't work immediately
    poolInstance.connect()
      .then((client) => {
        return client.query('SELECT NOW()')
          .then(() => {
            client.release();
            console.log('✅ Database connection test successful');
          })
          .catch((testError) => {
            client.release();
            console.error('⚠️  Database connection test failed (non-blocking):', (testError as Error).message);
            console.error('   Connection will be retried on first query');
          });
      })
      .catch((connectError) => {
        console.error('⚠️  Database connection test failed (non-blocking):', (connectError as Error).message);
        console.error('   Connection will be retried on first query');
      });
  } catch (error) {
    console.error('❌ Failed to create database pool:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
    }
    // Don't throw - allow module to load, error will be thrown when db is used
  }
} else {
  console.warn('⚠️  No DATABASE_URL or POSTGRES_URL - database operations will fail');
}

// Export with proper initialization
// In serverless, the pool is created at module load time
// If it fails, we'll throw a clear error when it's used
export const pool = poolInstance || (() => {
  const error = new Error("Database pool not initialized. Check DATABASE_URL or POSTGRES_URL in Vercel environment variables.");
  console.error("❌", error.message);
  throw error;
})();

export const db = dbInstance || (() => {
  if (!poolInstance) {
    const error = new Error("Database not initialized. Check DATABASE_URL or POSTGRES_URL in Vercel environment variables.");
    console.error("❌", error.message);
    throw error;
  }
  dbInstance = drizzle({ client: poolInstance, schema });
  return dbInstance;
})();
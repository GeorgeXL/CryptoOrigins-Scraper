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
    
    // Use connection string directly - pg.Pool handles parsing
    const connectionString = databaseUrl;
    
    poolInstance = new Pool({ 
      connectionString: connectionString,
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
    
    // Test the connection asynchronously (don't block module loading)
    poolInstance.connect()
      .then((client) => {
        return client.query('SELECT NOW()')
          .then(() => {
            client.release();
            console.log('✅ Database connection pool created and tested successfully');
          })
          .catch((testError) => {
            client.release();
            console.error('❌ Database connection test failed:', (testError as Error).message);
            console.error('   This might indicate a connection string issue or network problem');
          });
      })
      .catch((connectError) => {
        console.error('❌ Failed to connect to database:', (connectError as Error).message);
        console.error('   Check your DATABASE_URL in Vercel environment variables');
      });
  } catch (error) {
    console.error('❌ Failed to create database pool:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
    }
  }
} else {
  console.warn('⚠️  No DATABASE_URL - database operations will fail');
}

// Export with null checks - will throw if used without proper DB connection
export const pool = poolInstance || (() => {
  throw new Error("Database pool not initialized. Check DATABASE_URL in .env file or Vercel environment variables.");
})();

export const db = dbInstance || (() => {
  throw new Error("Database not initialized. Check DATABASE_URL in .env file or Vercel environment variables.");
})();
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const { Pool } = pg;
import * as schema from "@shared/schema";

// Support both DATABASE_URL and POSTGRES_URL (Vercel Storage integration)
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error("⚠️  WARNING: DATABASE_URL or POSTGRES_URL not set!");
  console.error("   The server will start but database operations will fail.");
  console.error("   Set DATABASE_URL in your .env file or Vercel environment variables.");
  // Don't throw - allow server to start for development/testing
  // throw new Error("DATABASE_URL or POSTGRES_URL must be set");
}

// Create connection pool for Supabase PostgreSQL
let poolInstance: Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

if (databaseUrl) {
  try {
    // Use connection string directly but ensure SSL is properly configured
    poolInstance = new Pool({ 
      connectionString: databaseUrl.split('?')[0], // Remove sslmode query param, handle SSL in config
      // Supabase connection pool settings
      // Match Supabase's pool size (15) to handle concurrent year requests
      max: 15, // Increased to handle 16 concurrent year requests
      idleTimeoutMillis: 10000, // Close idle clients after 10 seconds
      connectionTimeoutMillis: 8000, // 8 second timeout
      ssl: {
        rejectUnauthorized: false // Required for Supabase - allows self-signed certs
      }
    });

    // Handle pool errors
    poolInstance.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      // Don't exit - just log the error
    });

    dbInstance = drizzle({ client: poolInstance, schema });
    console.log('✅ Database connection pool created');
  } catch (error) {
    console.error('❌ Failed to create database pool:', error);
  }
} else {
  console.warn('⚠️  No DATABASE_URL - database operations will fail');
}

// Export with null checks - will throw if used without proper DB connection
export const pool = poolInstance || (() => {
  throw new Error("Database pool not initialized. Check DATABASE_URL in .env file.");
})();

export const db = dbInstance || (() => {
  throw new Error("Database not initialized. Check DATABASE_URL in .env file.");
})();
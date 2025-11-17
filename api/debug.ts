// Simple debug endpoint to test API connections

// Disable SSL certificate verification for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export default async function handler(req: any, res: any) {
  const results: any = {
    timestamp: new Date().toISOString(),
    environment: {
      VERCEL: process.env.VERCEL || 'not set',
      NODE_ENV: process.env.NODE_ENV || 'not set',
      NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED || 'not set',
    },
    envVars: {
      DATABASE_URL: process.env.DATABASE_URL ? '✅ Set' : '❌ Not set',
      POSTGRES_URL: process.env.POSTGRES_URL ? '✅ Set' : '❌ Not set',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set',
      EXA_API_KEY: process.env.EXA_API_KEY ? '✅ Set' : '❌ Not set',
      PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY ? '✅ Set' : '❌ Not set',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set',
    },
    database: {
      status: 'testing...',
      error: null as any,
    },
  };

  // Test database connection
  try {
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    
    if (!databaseUrl) {
      results.database.status = '❌ Failed';
      results.database.error = 'No DATABASE_URL or POSTGRES_URL found';
    } else {
      // Clean the connection string - remove supa parameter
      let cleanConnectionString = databaseUrl.replace(/[?&]supa=[^&]*/g, '');
      cleanConnectionString = cleanConnectionString.replace(/\?&/, '?');
      
      results.database.connectionStringPreview = cleanConnectionString.substring(0, 60) + '...';
      results.database.hasSSLMode = cleanConnectionString.includes('sslmode');
      
      // Try to import pg and connect
      const pg = await import('pg');
      const { Pool } = pg.default || pg;
      
      const pool = new Pool({
        connectionString: cleanConnectionString,
        max: 1,
        connectionTimeoutMillis: 10000,
        // Don't specify ssl at all - let the connection string and NODE_TLS_REJECT_UNAUTHORIZED handle it
      });

      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as now, version() as version, current_database() as database');
      client.release();
      await pool.end();
      
      results.database.status = '✅ Connected';
      results.database.serverTime = result.rows[0].now;
      results.database.version = result.rows[0].version;
      results.database.database = result.rows[0].database;
    }
  } catch (error) {
    results.database.status = '❌ Failed';
    results.database.error = error instanceof Error ? error.message : String(error);
    results.database.errorStack = error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined;
  }

  // Return results
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(results);
}

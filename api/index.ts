// CRITICAL: Disable TLS certificate verification BEFORE any imports
// This must be the very first line to handle Supabase pooler's self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log('LOG: api/index.ts - Top-level execution start.');

import type { Express } from 'express';

// Import from built server code (built during Vercel build step)
// The build process creates dist/serverless.js from server/serverless.ts
// @ts-ignore - Vercel will compile this, and the server code is built first
import { createApp } from "../dist/serverless.js";

type AppContainer = { app: Express; server: any };

// Store the app promise but don't create it until first request
let appPromise: Promise<AppContainer> | null = null;

function getOrCreateApp(): Promise<AppContainer> {
  if (!appPromise) {
    console.log('LOG: getOrCreateApp() - Initializing app on first request...');
    appPromise = createApp().catch((error: Error) => {
      console.error('❌ FATAL: Failed to create app:', error);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
      // Reset promise so next request can retry
      appPromise = null;
      throw error;
    });
  } else {
    console.log('LOG: getOrCreateApp() - Reusing existing app promise.');
  }
  return appPromise as Promise<AppContainer>;
}

export default async function handler(req: any, res: any) {
  console.log(`LOG: Handler invoked for URL: ${req.url}`);

  // Barebones health check - NO DEPENDENCIES
  if (req.url === '/api/healthcheck') {
    console.log('LOG: /api/healthcheck endpoint hit. Responding directly.');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  try {
    console.log('LOG: Attempting to get or create Express app...');
    const { app } = await getOrCreateApp();
    console.log('LOG: Express app retrieved successfully.');

    // Handle the request with Express
    return new Promise((resolve) => {
      app(req, res, resolve);
    });
  } catch (error) {
    console.error('❌ Serverless function error:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
    }
    
    // Return a proper error response
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

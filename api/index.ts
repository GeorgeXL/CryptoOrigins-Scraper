// CRITICAL: Disable TLS certificate verification BEFORE any imports
// This must be the very first line to handle Supabase pooler's self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
    console.log('🔧 Initializing app on first request...');
    appPromise = createApp().catch((error: Error) => {
      console.error('❌ FATAL: Failed to create app:', error);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
      // Reset promise so next request can retry
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

export default async function handler(req: any, res: any) {
  try {
    const { app } = await getOrCreateApp();

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

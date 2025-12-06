// CRITICAL: Disable TLS certificate verification BEFORE any imports
// This must be the very first line to handle Supabase pooler's self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import type { Express } from 'express';

let createAppFn: typeof import("../dist/server/serverless.js").createApp | null = null;

async function loadCreateApp() {
  if (createAppFn) {
    return createAppFn;
  }

  try {
    // Explicit .js extension to avoid ESM resolution issues on Vercel
    const module = await import("../dist/server/serverless.js");
    createAppFn = module.createApp;
    return createAppFn;
  } catch (distError) {
    console.error("❌ Failed to load dist/server/serverless.js:", distError);
    throw distError;
  }
}

type AppContainer = { app: Express; server: any };

// Store the app promise but don't create it until first request
let appPromise: Promise<AppContainer> | null = null;

async function getOrCreateApp(): Promise<AppContainer> {
  if (!appPromise) {
    console.log('🔧 Initializing app on first request...');
    appPromise = (async () => {
      try {
        const createApp = await loadCreateApp();
        return await createApp();
      } catch (error) {
        console.error('❌ FATAL: Failed to create app:', error);
        console.error('   Error message:', (error as Error).message);
        console.error('   Error stack:', (error as Error).stack);
        throw error;
      }
    })().catch((error: Error) => {
      appPromise = null;
      throw error;
    });
  }
  return appPromise as Promise<AppContainer>;
}

export default async function handler(req: any, res: any) {
  try {
    if (req?.query?.ping === "1") {
      return res.status(200).json({
        ok: true,
        message: "Serverless handler reachable",
        env: {
          NODE_ENV: process.env.NODE_ENV,
          VERCEL: process.env.VERCEL,
          DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'MISSING',
          SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'MISSING',
        }
      });
    }

    // Debug endpoint to check app creation
    if (req?.query?.debug === "1") {
      try {
        const { app } = await getOrCreateApp();
        return res.status(200).json({
          ok: true,
          message: "App created successfully",
          hasApp: !!app
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }

    const { app } = await getOrCreateApp();

    // Handle the request with Express. Cast to any so TypeScript doesn't complain
    return new Promise<void>((resolve) => {
      (app as unknown as (req: any, res: any, next: any) => void)(req, res, resolve);
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

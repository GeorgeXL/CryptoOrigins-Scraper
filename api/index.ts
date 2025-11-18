// CRITICAL: Disable TLS certificate verification BEFORE any imports
// This must be the very first line to handle Supabase pooler's self-signed cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import type { Express } from 'express';

// Import from built server code (built during Vercel build step)
// The build process creates dist/server/serverless.js from server/serverless.ts
// @ts-ignore - Vercel will compile this, and the server code is built first
// import { createApp } from "../dist/server/serverless.js"; // Changed to dynamic import below

type AppContainer = { app: Express; server: any };

// Store the app promise but don't create it until first request
let appPromise: Promise<AppContainer> | null = null;

function getOrCreateApp(): Promise<AppContainer> {
  if (!appPromise) {
    console.log('🔧 Initializing app on first request...');
    console.log('📂 Current working directory:', process.cwd());
    console.log('📂 __dirname equivalent:', import.meta.url);
    console.log('🔍 Environment check:');
    console.log('   VERCEL:', process.env.VERCEL);
    console.log('   NODE_ENV:', process.env.NODE_ENV);
    console.log('   DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'NOT SET');
    console.log('   POSTGRES_URL:', process.env.POSTGRES_URL ? 'Set' : 'NOT SET');
    
    appPromise = (async () => {
      try {
        // Dynamic import to catch module loading errors
        const importPath = "../dist/server/serverless.js";
        console.log(`📦 Dynamically importing: ${importPath}...`);
        
        // Try to import the module
        const serverlessModule = await import(importPath);
        console.log('✅ Module imported successfully');
        console.log('📋 Module exports:', Object.keys(serverlessModule));
        
        if (!serverlessModule.createApp) {
          throw new Error('createApp function not found in serverless module');
        }
        
        console.log('🔧 Calling createApp()...');
        const appContainer = await serverlessModule.createApp();
        console.log('✅ App created successfully');
        return appContainer;
      } catch (err: any) {
        console.error('❌ FATAL: Failed to load server module');
        console.error('   Error type:', err?.constructor?.name);
        console.error('   Error message:', err?.message);
        console.error('   Error code:', err?.code);
        console.error('   Error stack:', err?.stack);
        if (err?.cause) {
          console.error('   Error cause:', err.cause);
        }
        throw err;
      }
    })().catch((error: Error) => {
      console.error('❌ FATAL: Failed to create app:', error);
      console.error('   Error message:', error.message);
      console.error('   Error stack:', error.stack);
      // Reset promise so next request can retry
      appPromise = null;
      throw error;
    });
  }
  return appPromise as Promise<AppContainer>;
}

export default async function handler(req: any, res: any) {
  try {
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

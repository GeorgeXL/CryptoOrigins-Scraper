import type { Express } from 'express';

// Import from built server code (built during Vercel build step)
// The build process creates dist/index.js from server/index.ts
// @ts-ignore - Vercel will compile this, and the server code is built first
import { createApp } from "../dist/index.js";

// Initialize the app promise outside of the handler
// This ensures it's only created once per serverless instance
const appPromise = createApp();

export default async function handler(req: any, res: any) {
  try {
    const { app } = await appPromise;

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
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

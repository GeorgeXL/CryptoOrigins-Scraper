// Import from built server code (built during Vercel build step)
// The build process creates dist/index.js from server/index.ts
// @ts-ignore - Vercel will compile this, and the server code is built first
import { createApp } from "../dist/index.js";

let appPromise: Promise<{ app: any }> | null = null;

export default async function handler(req: any, res: any) {
  // Initialize app on first request (lazy initialization for cold starts)
  if (!appPromise) {
    appPromise = createApp();
  }

  const { app } = await appPromise;

  // Handle the request with Express
  return new Promise((resolve) => {
    app(req, res, resolve);
  });
}

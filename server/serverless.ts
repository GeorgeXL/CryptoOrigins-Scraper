// Entry point for serverless deployment (Vercel)
// This file only exports what's needed for the serverless function
// without the server startup code

// NOTE: Do NOT import dotenv/config here - Vercel automatically injects environment variables
// Importing dotenv in serverless can cause module loading issues

// Re-export createApp for serverless environments
export { createApp } from "./index.js";


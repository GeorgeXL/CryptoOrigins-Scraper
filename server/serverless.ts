// Entry point for serverless deployment (Vercel)
// This file only exports what's needed for the serverless function
// without the server startup code

// Note: dotenv/config is NOT needed on Vercel - environment variables
// are automatically injected by Vercel's runtime

// Re-export createApp for serverless environments
export { createApp } from "./index.js";


// Entry point for serverless deployment (Vercel)
// This file only exports what's needed for the serverless function
// without the server startup code

import "dotenv/config";

// Re-export createApp for serverless environments
export { createApp } from "./index.js";


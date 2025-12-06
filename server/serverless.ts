// Entry point for serverless deployment (Vercel)
// This file creates the Express app WITHOUT vite.js to avoid rollup dependencies

import "dotenv/config";
import express, { type Request, Response, NextFunction, type Express } from "express";
import { registerRoutes } from "./routes";
import compression from "compression";
import { createServer, type Server } from "http";

export async function createApp(): Promise<{ app: Express; server: Server }> {
  const app = express();

  // Enable compression for all responses - 60-80% size reduction
  app.use(compression({
    level: 6, // Good balance between compression and speed
    threshold: 1024, // Only compress responses larger than 1KB
    filter: (req, res) => {
      // Don't compress already compressed content
      if (req.headers['x-no-compression']) {
        return false;
      }
      // Use compression for all other responses
      return compression.filter(req, res);
    }
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }

        console.log(logLine);
      }
    });

    next();
  });

  const server = await registerRoutes(app);

  // Generic error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Error handler:", err);
    res.status(status).json({ message });
  });

  // In serverless mode, we don't need to serve static files
  // Vercel serves static assets via its CDN

  return { app, server };
}

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

      log(logLine);
    }
  });

  next();
});

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite.js");
    await setupVite(app, server);
  } else {
    const { serveStatic } = await import("./vite.js");
    serveStatic(app);
  }

  return { app, server };
}

// Only start the server if this file is run directly (not imported)
// Check if we're running in a serverless environment (Vercel)
const isVercel = process.env.VERCEL === "1";
const isServerless = process.env.AWS_LAMBDA_FUNCTION_NAME || isVercel;

if (!isServerless) {
  (async () => {
    try {
      console.log("🚀 Starting server...");
      console.log("📋 Environment check:");
      console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`   PORT: ${process.env.PORT || '3000 (default)'}`);
      console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Not set'}`);
      
      console.log("🔧 Creating app...");
      const { server } = await createApp();
      console.log("✅ App created successfully");

      // Use PORT from environment variable (Vercel provides this) or default to 3000
      // Port 5000 is often used by AirPlay on macOS, so we use 3000 for local dev
      const port = Number(process.env.PORT || 3000);
      console.log(`📡 Starting server on port ${port}...`);
      
      server.listen(port, "0.0.0.0", () => {
        console.log(`✅ Server is running on http://localhost:${port}`);
      console.log(`serving on port ${port}`);
  });
      
      server.on('error', (err: any) => {
        console.error("❌ Server error:", err);
        if (err.code === 'EADDRINUSE') {
          console.error(`   Port ${port} is already in use. Try a different port.`);
        }
        process.exit(1);
      });
      
      // Keep process alive
      process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down gracefully');
        server.close(() => {
          process.exit(0);
        });
      });
      
    } catch (error) {
      console.error("❌ Failed to start server:", error);
      if (error instanceof Error) {
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      process.exit(1);
    }
})();
}
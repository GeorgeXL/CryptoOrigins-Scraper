import type { Express } from "express";
import { createServer, type Server } from "http";
import router from "./routes/index";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(router);

  const httpServer = createServer(app);
  return httpServer;
}

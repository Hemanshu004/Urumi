import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { serversRouter } from "./routes/servers.js";
import { auditRouter } from "./routes/audit.js";
import { chatRouter } from "./routes/chat.js";
import { permissionsRouter } from "./routes/permissions.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { setupMcpServer } from "./mcp/server.js";
import { seedDatabase } from "./db/seed.js";
import { clientManager } from "./mcp/clientManager.js";
import { logger } from "./utils/logger.js";
import { db } from "./db/index.js";
import { sql } from "drizzle-orm";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Setup MCP Server at /mcp
setupMcpServer(app);

import crypto from "crypto";

app.use(express.json({ limit: "1mb" }));

app.use((req: any, res: express.Response, next: express.NextFunction) => {
  req.id = crypto.randomUUID();
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info("HTTP Request", {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      userId: req.user?.id
    });
  });
  next();
});

app.get("/health/live", (req, res) => {
  res.json({ status: "healthy" });
});

app.get("/health/ready", async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ready" });
  } catch (err: any) {
    logger.error("Readiness check failed", { error: err.message });
    res.status(503).json({ status: "unready", error: "Database unavailable" });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "Urumi MCP Gateway API", version: "0.1.0" });
});

// Legacy endpoint for backward compatibility
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

app.use("/api/auth", authRouter);
app.use("/api/api-keys", apiKeysRouter);
app.use("/api/servers", serversRouter);
app.use("/api/audit", auditRouter);
app.use("/api/chat", chatRouter);
app.use("/api/permissions", permissionsRouter);

app.use(errorHandler);

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    logger.error("FATAL: JWT_SECRET environment variable is missing or insufficiently configured. It must be at least 32 characters long.");
    process.exit(1);
  }
  
  logger.info("Running database seed...");
  await seedDatabase();
  logger.info("Initializing upstream MCP clients...");
  await clientManager.initializeAll();
  
  clientManager.startHealthCheckLoop(30000);
  
  const server = app.listen(PORT, () => {
    logger.info(`Gateway listening on port ${PORT}`);
  });
  
  const shutdown = () => {
    logger.info("Shutting down gracefully...");
    clientManager.stopHealthCheckLoop();
    server.close(() => process.exit(0));
  };
  
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch(err => {
  logger.error("Failed to start gateway", { error: err.message });
  process.exit(1);
});

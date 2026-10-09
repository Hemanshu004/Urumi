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
import { setupMcpServer } from "./mcp/server.js";
import { seedDatabase } from "./db/seed.js";
import { clientManager } from "./mcp/clientManager.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Setup MCP Server at /mcp
setupMcpServer(app);

app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

app.use("/api/auth", authRouter);
app.use("/api/api-keys", apiKeysRouter);
app.use("/api/servers", serversRouter);
app.use("/api/audit", auditRouter);
app.use("/api/chat", chatRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err.message); // Never expose stack traces
  res.status(500).json({ error: "Internal Server Error" });
});

async function start() {
  console.log("⏳ Running database seed...");
  await seedDatabase();
  console.log("⏳ Initializing upstream MCP clients...");
  await clientManager.initializeAll();
  
  app.listen(PORT, () => {
    console.log(`Gateway listening on port ${PORT}`);
  });
}

start().catch(err => {
  console.error("Failed to start gateway:", err);
  process.exit(1);
});

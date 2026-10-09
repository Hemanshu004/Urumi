import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registry } from "./registry.js";
import { clientManager } from "./clientManager.js";
import { logAudit } from "../services/audit.js";
import { db } from "../db/index.js";
import { api_keys } from "../db/schema.js";
import { isNull } from "drizzle-orm";
import bcrypt from "bcrypt";

export function setupMcpServer(app: express.Application) {

  const server = new Server({
    name: "urumi-gateway",
    version: "1.0.0"
  }, {
    capabilities: { tools: {} }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = registry.getAllTools().map(t => ({
      name: t.namespacedName,
      description: t.description,
      inputSchema: t.inputSchema as any
    }));
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    // Extract userId from extra.request.headers (populated by express)
    const userId = (extra as any).requestInfo?.headers?.get("x-urumi-user-id");
    const serverId = (extra as any).requestInfo?.headers?.get("x-urumi-server-id");
    
    const tool = registry.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    const managed = clientManager.getClient(tool.serverName);
    if (!managed || managed.status !== "connected") {
      throw new Error(`Upstream server ${tool.serverName} is not available`);
    }

    const startedAt = new Date();
    let outcome: "success" | "error" | "timeout" = "success";
    let errorMessage: string | undefined;
    let result: any;

    try {
      const timeoutMs = 30000;
      
      result = await Promise.race([
        managed.client.callTool({
          name: tool.originalToolName,
          arguments: args
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
      ]);

    } catch (err: any) {
      if (err.message === "Timeout") {
        outcome = "timeout";
        errorMessage = "Upstream server timed out";
      } else {
        outcome = "error";
        errorMessage = err.message || "Unknown error calling upstream tool";
      }
      
      result = {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
      };
    } finally {
      const completedAt = new Date();
      await logAudit({
        userId: userId ? parseInt(userId, 10) : undefined,
        serverId: tool.serverId,
        namespacedTool: toolName,
        toolName: tool.originalToolName,
        requestParams: args,
        outcome,
        errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        source: "mcp-client",
        startedAt,
        completedAt
      });
    }

    return result;
  });

  // We need to inject user info into the request context before handing off to mcpHandler
  const mcpHandler = createMcpHandler(() => server as any);

  app.use("/mcp", express.raw({ type: "*/*" }), async (req, res) => {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const token = authHeader.substring(7);
    
    const activeKeys = await db.select({
      id: api_keys.id,
      user_id: api_keys.user_id,
      key_hash: api_keys.key_hash,
      key_prefix: api_keys.key_prefix
    }).from(api_keys).where(isNull(api_keys.revoked_at));

    let matchedUserId: number | null = null;
    let matchedKeyId: number | null = null;

    for (const key of activeKeys) {
      if (token.startsWith(key.key_prefix)) {
        const isValid = await bcrypt.compare(token, key.key_hash);
        if (isValid) {
          matchedUserId = key.user_id;
          matchedKeyId = key.id;
          break;
        }
      }
    }

    if (!matchedUserId) {
      return res.status(401).json({ error: "Invalid or revoked API key" });
    }

    try {
      const webReq = new Request("http://localhost/mcp", {
        method: req.method,
        headers: req.headers as any,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined
      });
      // Inject user ID for audit logging
      webReq.headers.set("x-urumi-user-id", matchedUserId.toString());
      if (matchedKeyId) {
        webReq.headers.set("x-urumi-key-id", matchedKeyId.toString());
      }
      
      const webRes = await mcpHandler.fetch(webReq);
      res.status(webRes.status);
      webRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      if (webRes.body) {
        const reader = webRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        res.end();
      }
    } catch (error) {
      console.error("MCP bridge error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });
}

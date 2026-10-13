import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { registry } from "./registry.js";
import { clientManager } from "./clientManager.js";
import { logAudit } from "../services/audit.js";
import { db } from "../db/index.js";
import { api_keys } from "../db/schema.js";
import { isNull } from "drizzle-orm";
import bcrypt from "bcrypt";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { mcpContext } from "./context.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { isToolAllowed } from "../utils/rbac.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function createMcpServerInstance() {
  const server = new Server({
    name: "urumi-gateway",
    version: "1.0.0"
  }, {
    capabilities: { tools: {} }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const ctx = mcpContext.getStore();
    const role = ctx?.role || "member";
    const allTools = registry.getAllTools();
    const allowedTools = [];
    for (const t of allTools) {
      if (await isToolAllowed(role, t.namespacedName)) {
        allowedTools.push(t);
      }
    }
    const tools = allowedTools.map(t => ({
        name: t.namespacedName,
        description: t.description,
        inputSchema: t.inputSchema as any
      }));
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startedAt = new Date();
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    
    const ctx = mcpContext.getStore();
    const userId = ctx?.userId ?? null;
    const role = ctx?.role || "member";
    const source = ctx?.source || "mcp-client";

    let auditLogged = false;
    const recordAudit = async (params: {
      serverId?: number | null;
      namespacedTool: string;
      originalToolName?: string;
      outcome: "success" | "error" | "timeout" | "denied";
      errorMessage?: string;
    }) => {
      if (auditLogged) return;
      auditLogged = true;
      const completedAt = new Date();
      await logAudit({
        userId,
        serverId: params.serverId ?? null,
        namespacedTool: params.namespacedTool,
        toolName: params.originalToolName || params.namespacedTool,
        requestParams: args,
        outcome: params.outcome,
        errorMessage: params.errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        source,
        startedAt,
        completedAt
      });
    };

    try {
      const tool = registry.getTool(toolName);
      if (!tool) {
        const prefix = toolName.includes("__") ? toolName.split("__")[0] : null;
        const matchingServerTool = prefix ? registry.getAllTools().find(t => t.serverName === prefix) : undefined;
        const serverId = matchingServerTool?.serverId ?? null;
        const originalToolName = toolName.includes("__") ? toolName.split("__").slice(1).join("__") : toolName;

        await recordAudit({
          serverId,
          namespacedTool: toolName,
          originalToolName,
          outcome: "error",
          errorMessage: `Tool not found: ${toolName}`
        });
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${toolName}`);
      }

      if (!(await isToolAllowed(role, toolName))) {
        await recordAudit({
          serverId: tool.serverId,
          namespacedTool: toolName,
          originalToolName: tool.originalToolName,
          outcome: "denied",
          errorMessage: `Access denied: Tool ${toolName} is not allowed for role ${role}`
        });
        throw new McpError(403, `Access denied: Tool ${toolName} is not allowed for role ${role}`);
      }

      const managed = clientManager.getClient(tool.serverName);
      if (!managed || managed.status !== "connected") {
        const errMsg = `Upstream server ${tool.serverName} is not available`;
        await recordAudit({
          serverId: tool.serverId,
          namespacedTool: toolName,
          originalToolName: tool.originalToolName,
          outcome: "error",
          errorMessage: errMsg
        });
        throw new McpError(ErrorCode.InternalError, errMsg);
      }

      let outcome: "success" | "error" | "timeout" = "success";
      let errorMessage: string | undefined;
      let result: any;

      try {
        result = await clientManager.callToolWithTimeout(tool.serverName, tool.originalToolName, args);
      } catch (err: any) {
        if (err.message === "Timeout") {
          outcome = "timeout";
          errorMessage = "Upstream server timed out";
        } else {
          outcome = "error";
          errorMessage = err.message || "Unknown error calling upstream tool";
          // Do not mark the server as permanently failed just because of a single timeout,
          // but do so for other hard errors if necessary.
          clientManager.markServerFailed(tool.serverName, errorMessage || "Unknown error").catch(err => logger.error("Failed to mark server failed", { error: err.message, server: tool.serverName }));
        }

        result = {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true
        };
      } finally {
        await recordAudit({
          serverId: tool.serverId,
          namespacedTool: toolName,
          originalToolName: tool.originalToolName,
          outcome,
          errorMessage
        });
      }

      return result;
    } catch (err: any) {
      if (!auditLogged) {
        const prefix = toolName.includes("__") ? toolName.split("__")[0] : null;
        const matchingServerTool = prefix ? registry.getAllTools().find(t => t.serverName === prefix) : undefined;
        const serverId = matchingServerTool?.serverId ?? null;
        const originalToolName = toolName.includes("__") ? toolName.split("__").slice(1).join("__") : toolName;

        await recordAudit({
          serverId,
          namespacedTool: toolName,
          originalToolName,
          outcome: "error",
          errorMessage: err.message || "Unknown error during tool execution"
        });
      }
      throw err;
    }
  });

  return server;
}

export function setupMcpServer(app: express.Application) {
  const sseTransports = new Map<string, SSEServerTransport>();
  const statelessHandler = createMcpHandler(() => createMcpServerInstance() as any);

  app.use("/mcp", express.raw({ type: "*/*" }), asyncHandler(async (req, res, next) => {
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

    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, matchedUserId));
    const role = user?.role || "member";

    try {
      await mcpContext.run({ userId: matchedUserId, keyId: matchedKeyId || undefined, role, source: "external" }, async () => {
        if (req.method === "GET" && (req.url === "/" || req.url === "" || req.url === "/sse" || req.url === "/sse/")) {
          const transport = new SSEServerTransport("/mcp/message", res as any);
          const serverInstance = createMcpServerInstance();
          await serverInstance.connect(transport);
          sseTransports.set(transport.sessionId, transport);
          res.on("close", () => {
            sseTransports.delete(transport.sessionId);
            serverInstance.close().catch(err => logger.error("Failed to close SSE server instance", { error: err.message }));
          });
          return;
        }

        if (req.method === "POST" && (req.url.startsWith("/message") || req.url.startsWith("/mcp/message"))) {
          const sessionId = req.query.sessionId as string;
          const transport = sseTransports.get(sessionId);
          if (!transport) {
            return res.status(404).json({ error: "Session not found" });
          }
          
          let parsedBody;
          try {
            parsedBody = JSON.parse(req.body.toString("utf8"));
          } catch (e) {
            return res.status(400).json({ error: "Invalid JSON" });
          }
          
          await transport.handlePostMessage(req as any, res as any, parsedBody);
          return;
        }

        const targetUrl = `http://localhost${req.url === '/' ? '' : req.url}`;
        const webReq = new Request(targetUrl, {
          method: req.method,
          headers: req.headers as any,
          body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined
        });
      
        const webRes = await statelessHandler.fetch(webReq);
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
      });
    } catch (error: any) {
      logger.error("MCP bridge error", { error: error.message });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  }));
}

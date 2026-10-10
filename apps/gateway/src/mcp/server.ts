import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
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

export function setupMcpServer(app: express.Application) {
  const sseTransports = new Map<string, SSEServerTransport>();

  function createMcpServerInstance() {

  const server = new Server({
    name: "urumi-gateway",
    version: "1.0.0"
  }, {
    capabilities: { tools: {} }
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const ctx = mcpContext.getStore();
    const role = ctx?.role || "member";
    const tools = registry.getAllTools()
      .filter(t => isToolAllowed(role, t.namespacedName))
      .map(t => ({
        name: t.namespacedName,
        description: t.description,
        inputSchema: t.inputSchema as any
      }));
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    
    const ctx = mcpContext.getStore();
    const userId = ctx?.userId;
    const role = ctx?.role || "member";
    
    const tool = registry.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    if (!isToolAllowed(role, toolName)) {
      await logAudit({
        userId: userId,
        serverId: tool.serverId,
        namespacedTool: toolName,
        toolName: tool.originalToolName,
        requestParams: args,
        outcome: "denied" as any,
        errorMessage: "Access denied to tool",
        durationMs: 0,
        source: ctx?.source || "mcp-client",
        startedAt: new Date(),
        completedAt: new Date()
      });
      // The requirement says: be rejected with HTTP/JSON-RPC 403 if directly invoked
      // Throwing an error with code -32000 (which is JSON-RPC standard for generic server error)
      // or we can just throw Error which will map to internal error.
      // We can create a specific MCP error, but throwing a standard Error is usually handled by the SDK.
      // Wait, can we throw McpError with code 403? The standard MCP errors don't easily allow arbitrary HTTP codes inside JSON-RPC.
      // But the requirement says "be rejected with HTTP/JSON-RPC 403 if directly invoked". 
      // The MCP SDK maps throw to JSON-RPC errors.
      // Let's throw a custom error.
      throw new McpError(403, `Access denied: Tool ${toolName} is not allowed for role ${role}`);
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
      
      clientManager.markServerFailed(tool.serverName, errorMessage || "Unknown error").catch(console.error);
      
      result = {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
      };
    } finally {
      const completedAt = new Date();
      await logAudit({
        userId: userId,
        serverId: tool.serverId,
        namespacedTool: toolName,
        toolName: tool.originalToolName,
        requestParams: args,
        outcome,
        errorMessage,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        source: ctx?.source || "mcp-client",
        startedAt,
        completedAt
      });
    }

    return result;
  });

  return server;
  }

  const statelessHandler = createMcpHandler(() => createMcpServerInstance() as any);

  app.use("/mcp", express.raw({ type: "*/*" }), async (req, res) => {
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
            serverInstance.close().catch(console.error);
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
    } catch (error) {
      console.error("MCP bridge error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  });
}

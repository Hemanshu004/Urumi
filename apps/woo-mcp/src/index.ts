import express from "express";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { handleProductsToolCall } from "./tools/products.js";
import { handleOrdersToolCall } from "./tools/orders.js";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3001;

const server = new McpServer({ name: "woo-mcp", version: "1.0.0" });

server.registerTool("list_products", {
  description: "List products from WooCommerce",
  inputSchema: z.object({
    page: z.number().optional().describe("Page number for pagination"),
    per_page: z.number().optional().describe("Number of products per page")
  }).shape
}, async (args: any) => {
  return await handleProductsToolCall("list_products", args);
});

server.registerTool("create_product", {
  description: "Create a new product in WooCommerce",
  inputSchema: z.object({
    name: z.string(),
    regular_price: z.string(),
    description: z.string().optional(),
    status: z.enum(["draft", "pending", "private", "publish"]).optional()
  }).shape
}, async (args: any) => {
  return await handleProductsToolCall("create_product", args);
});

server.registerTool("get_product", {
  description: "Get a product by ID from WooCommerce",
  inputSchema: z.object({
    id: z.number()
  }).shape
}, async (args: any) => {
  return await handleProductsToolCall("get_product", args);
});

server.registerTool("list_orders", {
  description: "List orders from WooCommerce",
  inputSchema: z.object({
    page: z.number().optional(),
    per_page: z.number().optional(),
    after: z.string().optional().describe("Filter by date after (ISO 8601)")
  }).shape
}, async (args: any) => {
  return await handleOrdersToolCall("list_orders", args);
});

server.registerTool("get_order", {
  description: "Get an order by ID",
  inputSchema: z.object({
    id: z.number()
  }).shape
}, async (args: any) => {
  return await handleOrdersToolCall("get_order", args);
});

server.registerTool("update_order_status", {
  description: "Update order status",
  inputSchema: z.object({
    id: z.number(),
    status: z.enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash"])
  }).shape
}, async (args: any) => {
  return await handleOrdersToolCall("update_order_status", args);
});

const mcpHandler = createMcpHandler(() => server);

app.use("/mcp", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const webReq = new Request("http://localhost" + (req.url === "/" ? "/sse" : req.url), {
      method: req.method,
      headers: req.headers as any,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined
    });
    
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

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

app.listen(PORT, () => {
  console.log(`WooCommerce MCP Server listening on port ${PORT}`);
});

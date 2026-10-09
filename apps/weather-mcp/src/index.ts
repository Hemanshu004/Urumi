import express from "express";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

const app = express();
const PORT = process.env.PORT || 3003;

const server = new McpServer({ name: "weather-mcp", version: "1.0.0" });

server.registerTool("get_weather", {
  description: "Get current weather for a location",
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number()
  }).shape
}, async (args) => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current_weather=true`;
  const res = await fetch(url);
  const data = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(data.current_weather, null, 2) }] };
});

server.registerTool("get_forecast", {
  description: "Get weather forecast for a location",
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number()
  }).shape
}, async (args) => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(data.daily, null, 2) }] };
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
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    
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
    if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

app.listen(PORT, () => {
  console.log(`Weather MCP Server listening on port ${PORT}`);
});

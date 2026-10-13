import express from "express";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Octokit } from "@octokit/rest";

const app = express();
const PORT = process.env.PORT || 3002;

const server = new McpServer({ name: "github-mcp", version: "1.0.0" });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

server.registerTool("search_repositories", {
  description: "Search for GitHub repositories",
  inputSchema: z.object({
    query: z.string(),
    per_page: z.number().optional()
  }).shape
}, async (args) => {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const perPage = Math.min(Math.max(1, args.per_page || 5), 10);
  const res = await octokit.rest.search.repos({ q: args.query, per_page: perPage });
  const pruned = (res.data.items || []).map((repo: any) => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description ? (repo.description.length > 150 ? repo.description.slice(0, 147) + "..." : repo.description) : null,
    html_url: repo.html_url,
    stargazers_count: repo.stargazers_count,
    language: repo.language,
    forks_count: repo.forks_count,
    open_issues_count: repo.open_issues_count,
    owner: repo.owner ? {
      login: repo.owner.login,
      html_url: repo.owner.html_url
    } : undefined
  }));
  return { content: [{ type: "text", text: JSON.stringify(pruned) }] };
});

server.registerTool("get_repo", {
  description: "Get repository details",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string()
  }).shape
}, async (args) => {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const res = await octokit.rest.repos.get({ owner: args.owner, repo: args.repo });
  const d = res.data;
  const pruned = {
    id: d.id,
    name: d.name,
    full_name: d.full_name,
    description: d.description,
    html_url: d.html_url,
    stargazers_count: d.stargazers_count,
    forks_count: d.forks_count,
    open_issues_count: d.open_issues_count,
    language: d.language,
    default_branch: d.default_branch,
    created_at: d.created_at,
    updated_at: d.updated_at,
    owner: d.owner ? { login: d.owner.login, html_url: d.owner.html_url } : undefined
  };
  return { content: [{ type: "text", text: JSON.stringify(pruned) }] };
});

server.registerTool("list_issues", {
  description: "List issues in a repository",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    state: z.enum(["open", "closed", "all"]).optional()
  }).shape
}, async (args) => {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const res = await octokit.rest.issues.listForRepo({ owner: args.owner, repo: args.repo, state: args.state || "open", per_page: 10 });
  const pruned = (res.data || []).map((issue: any) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    user: issue.user ? { login: issue.user.login } : undefined,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    html_url: issue.html_url
  }));
  return { content: [{ type: "text", text: JSON.stringify(pruned) }] };
});

server.registerTool("create_issue", {
  description: "Create a new issue in a repository",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string().optional()
  }).shape
}, async (args) => {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  const res = await octokit.rest.issues.create({ owner: args.owner, repo: args.repo, title: args.title, body: args.body });
  return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
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
  console.log(`GitHub MCP Server listening on port ${PORT}`);
});

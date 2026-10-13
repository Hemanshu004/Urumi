import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { chatRouter } from "./chat.js";
import { isToolAllowed } from "../utils/rbac.js";
import { registry } from "../mcp/registry.js";
import { clientManager } from "../mcp/clientManager.js";
import { getLLMProvider } from "../services/llm.js";
import * as auditService from "../services/audit.js";

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 1, role: "member" };
    next();
  }
}));

vi.mock("../utils/rbac.js", () => ({
  isToolAllowed: vi.fn()
}));

vi.mock("../mcp/registry.js", () => ({
  registry: {
    getAllTools: vi.fn(),
    getTool: vi.fn()
  }
}));

vi.mock("../mcp/clientManager.js", () => ({
  clientManager: {
    getClient: vi.fn(),
    callToolWithTimeout: vi.fn()
  }
}));

vi.mock("../services/llm.js", () => ({
  getLLMProvider: vi.fn()
}));

vi.mock("../services/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

const app = express();
app.use(express.json());
app.use("/chat", chatRouter);

describe("Chat Router", () => {
  let mockChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChat = vi.fn();
    (getLLMProvider as any).mockReturnValue({ chat: mockChat });
  });

  it("returns readable permission-denied message without invoking upstream tool", async () => {
    (isToolAllowed as any).mockResolvedValue(false);
    (registry.getAllTools as any).mockReturnValue([
      { namespacedName: "woocommerce__list_products", serverName: "woocommerce" }
    ]);
    (registry.getTool as any).mockReturnValue({
      serverId: 1,
      namespacedName: "woocommerce__list_products",
      originalToolName: "list_products",
      serverName: "woocommerce"
    });

    // LLM attempts to use the ungranted tool
    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            function: {
              name: "woocommerce__list_products",
              arguments: "{}"
            }
          }]
        }
      }]
    });

    const res = await request(app).post("/chat").send({ message: "List products" });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("You don't currently have permission to use the Woocommerce `list_products` tool");
    expect(res.body.message).not.toContain("{"); // No raw JSON
    expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", serverId: 1 }));
  });

  it("handles raw JSON hallucination in content fallback", async () => {
    (isToolAllowed as any).mockResolvedValue(false);
    (registry.getAllTools as any).mockReturnValue([]);

    // LLM outputs raw JSON instead of using tool protocol
    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: '{"action": "list_products", "parameters": {}}'
        }
      }]
    });

    const res = await request(app).post("/chat").send({ message: "List products" });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("You don't currently have permission to use the Woocommerce `list_products` tool");
    expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
  });

  it("granted tool works normally and produces normal response", async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getAllTools as any).mockReturnValue([
      { namespacedName: "weather__get_weather", serverName: "weather" }
    ]);
    (registry.getTool as any).mockReturnValue({
      serverId: 1,
      namespacedName: "weather__get_weather",
      originalToolName: "get_weather",
      serverName: "weather"
    });
    (clientManager.getClient as any).mockReturnValue({ status: "connected" });
    (clientManager.callToolWithTimeout as any).mockResolvedValue({
      content: [{ type: "text", text: "Sunny 25C" }]
    });

    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            function: { name: "weather__get_weather", arguments: "{}" }
          }]
        }
      }]
    }).mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: "The weather is Sunny 25C."
        }
      }]
    });

    const res = await request(app).post("/chat").send({ message: "Weather?" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("The weather is Sunny 25C.");
    expect(clientManager.callToolWithTimeout).toHaveBeenCalledTimes(1);
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("includes dynamic current date in ISO format in system prompt while preserving required instructions", async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getAllTools as any).mockReturnValue([]);

    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: "Hello! How can I help you today?"
        }
      }]
    });

    const expectedDate = new Date().toISOString().slice(0, 10);
    const res = await request(app).post("/chat").send({ message: "Hello" });

    expect(res.status).toBe(200);
    expect(mockChat).toHaveBeenCalledTimes(1);

    const callArgs = mockChat.mock.calls[0][0];
    const systemMsg = callArgs.find((m: any) => m.role === "system");
    expect(systemMsg).toBeDefined();

    // 1. Confirms the generated prompt contains the dynamic date in ISO format (YYYY-MM-DD)
    expect(systemMsg.content).toContain(`Today's date is ${expectedDate}.`);
    expect(systemMsg.content).toMatch(/Today's date is \d{4}-\d{2}-\d{2}\./);

    // 2. Confirms that existing required instructions remain intact
    expect(systemMsg.content).toContain("You are the Urumi MCP Agent.");
    expect(systemMsg.content).toContain("The frontend UI will render structured data tables for your tool results automatically. Therefore, YOUR RESPONSES MUST BE VERY CONCISE.");
    expect(systemMsg.content).toContain("SPECIFIC INSTRUCTION FOR GITHUB: When GitHub list_issues executes successfully and returns zero issues, you MUST respond clearly: 'No open issues were found in owner/repository.'");
  });

  it("denied call involving unknown/unregistered tool logs audit with serverId: null instead of 0", async () => {
    (isToolAllowed as any).mockResolvedValue(false);
    (registry.getAllTools as any).mockReturnValue([]);
    (registry.getTool as any).mockReturnValue(undefined);

    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_unknown",
            function: {
              name: "nonexistent__custom_tool",
              arguments: '{"param": "val"}'
            }
          }]
        }
      }]
    });

    const res = await request(app).post("/chat").send({ message: "Do nonexistent thing" });

    expect(res.status).toBe(200);
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "denied",
      serverId: null,
      namespacedTool: "nonexistent__custom_tool"
    }));
    expect(auditService.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({
      serverId: 0
    }));
  });

  it("handles large github__search_repositories results by pruning fields, bounding payload for LLM, and returning structured data for UI", async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getAllTools as any).mockReturnValue([
      { namespacedName: "github__search_repositories", serverName: "github" }
    ]);
    (registry.getTool as any).mockReturnValue({
      serverId: 2,
      namespacedName: "github__search_repositories",
      originalToolName: "search_repositories",
      serverName: "github"
    });
    (clientManager.getClient as any).mockReturnValue({ status: "connected" });

    // Generate 10 massive GitHub repo objects (each containing 80+ fields)
    const massiveRepos = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `repo-${i + 1}`,
      full_name: `owner/repo-${i + 1}`,
      html_url: `https://github.com/owner/repo-${i + 1}`,
      description: `Description for repository ${i + 1}`,
      stargazers_count: 500 * (i + 1),
      language: "TypeScript",
      forks_count: 50,
      open_issues_count: 10,
      blobs_url: "https://api.github.com/repos/owner/repo/blobs{/sha}",
      git_commits_url: "https://api.github.com/repos/owner/repo/git/commits{/sha}",
      comments_url: "https://api.github.com/repos/owner/repo/comments{/number}",
      issue_comment_url: "https://api.github.com/repos/owner/repo/issues/comments{/number}",
      contents_url: "https://api.github.com/repos/owner/repo/contents/{+path}",
      compare_url: "https://api.github.com/repos/owner/repo/compare/{base}...{head}",
      merges_url: "https://api.github.com/repos/owner/repo/merges",
      archive_url: "https://api.github.com/repos/owner/repo/{archive_format}{/ref}",
      downloads_url: "https://api.github.com/repos/owner/repo/downloads",
      issues_url: "https://api.github.com/repos/owner/repo/issues{/number}",
      pulls_url: "https://api.github.com/repos/owner/repo/pulls{/number}",
      milestones_url: "https://api.github.com/repos/owner/repo/milestones{/number}",
      notifications_url: "https://api.github.com/repos/owner/repo/notifications{?since,all,participating}",
      labels_url: "https://api.github.com/repos/owner/repo/labels{/name}",
      releases_url: "https://api.github.com/repos/owner/repo/releases{/id}",
      deployments_url: "https://api.github.com/repos/owner/repo/deployments"
    }));

    (clientManager.callToolWithTimeout as any).mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(massiveRepos) }]
    });

    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_search_1",
            function: {
              name: "github__search_repositories",
              arguments: '{"query": "typescript"}'
            }
          }]
        }
      }]
    }).mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: "Here are the top TypeScript repositories."
        }
      }]
    });

    const res = await request(app).post("/chat").send({ message: "Search for typescript repos" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Here are the top TypeScript repositories.");
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.toolCalls[0].tool).toBe("github__search_repositories");
    expect(res.body.toolCalls[0].status).toBe("success");

    // Verify structured displayResult for Dashboard ToolRenderer table
    const resultItems = res.body.toolCalls[0].result;
    expect(Array.isArray(resultItems)).toBe(true);
    expect(resultItems).toHaveLength(5);
    expect(resultItems[0].full_name).toBe("owner/repo-1");
    expect(resultItems[0].stargazers_count).toBe(500);
    expect(resultItems[0].language).toBe("TypeScript");
    expect(resultItems[0]).not.toHaveProperty("blobs_url");

    // Verify content forwarded to the LLM was pruned and compact (under 2,000 chars instead of 25KB+)
    const secondCallMessages = mockChat.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content.length).toBeLessThan(2000);
    const parsedLLMPayload = JSON.parse(toolMsg.content);
    expect(parsedLLMPayload._truncated).toBe(true);
    expect(parsedLLMPayload._total_found).toBe(10);
    expect(parsedLLMPayload.items).toHaveLength(5);
  });

  it("bounds conversation history while strictly preserving tool-call and tool-response sequences", async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getAllTools as any).mockReturnValue([]);

    // Construct 10 turns of history with tool calls
    const longHistory: any[] = [];
    for (let i = 1; i <= 10; i++) {
      longHistory.push({ role: "user", content: `Question ${i}` });
      longHistory.push({
        role: "assistant",
        content: null,
        tool_calls: [{ id: `call_${i}`, function: { name: "get_weather", arguments: "{}" } }]
      });
      longHistory.push({ role: "tool", tool_call_id: `call_${i}`, content: `Weather data ${i}` });
      longHistory.push({ role: "assistant", content: `Answer ${i}` });
    }

    mockChat.mockResolvedValueOnce({
      choices: [{
        message: {
          role: "assistant",
          content: "Final answer"
        }
      }]
    });

    const res = await request(app).post("/chat").send({
      message: "Current question",
      conversationHistory: longHistory
    });

    expect(res.status).toBe(200);
    expect(mockChat).toHaveBeenCalledTimes(1);

    const sentMessages = mockChat.mock.calls[0][0];
    // History should be bounded (not all 40 messages from 10 turns)
    expect(sentMessages.length).toBeLessThan(longHistory.length + 2);

    // Verify tool-call parity for every assistant message in sent prompt
    for (let i = 0; i < sentMessages.length; i++) {
      const msg = sentMessages[i];
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const hasMatchingTool = sentMessages.slice(i + 1).some((m: any) => m.role === "tool" && m.tool_call_id === tc.id);
          expect(hasMatchingTool).toBe(true);
        }
      }
      if (msg.role === "tool") {
        const precedingAssistant = sentMessages.slice(0, i).reverse().find((m: any) => m.role === "assistant" && m.tool_calls);
        expect(precedingAssistant).toBeDefined();
        const hasCallId = precedingAssistant.tool_calls.some((tc: any) => tc.id === msg.tool_call_id);
        expect(hasCallId).toBe(true);
      }
    }
  });

  it("handles HTTP 413 / TPM Request Too Large gracefully with 413 status and actionable error", async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getAllTools as any).mockReturnValue([]);

    const groq413Error: any = new Error(
      "LLM Error: 413 Request too large for model openai/gpt-oss-120b. TPM limit: 8000, requested: approximately 11683 tokens."
    );
    groq413Error.status = 413;

    mockChat.mockRejectedValue(groq413Error);

    const res = await request(app).post("/chat").send({ message: "Search for repos" });

    // Expect HTTP 413 with actionable error message instead of unexplained HTTP 500
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("REQUEST_TOO_LARGE");
    expect(res.body.error).toContain("exceeded the model token limit or context window");
    expect(res.body.error).toContain("shorten your request or clear chat history");

    // Do NOT retry the identical oversized request repeatedly
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { chatRouter } from "./chat.js";
import { isToolAllowed } from "../utils/rbac.js";
import { registry } from "../mcp/registry.js";
import { clientManager } from "../mcp/clientManager.js";
import { getLLMProvider } from "../services/llm.js";
import * as auditService from "../services/audit.js";
import { setupMcpServer, createMcpServerInstance } from "../mcp/server.js";


vi.mock("../mcp/context.js", () => ({
  mcpContext: {
    getStore: () => ({ userId: 1, role: "member" })
  }
}));
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
    callToolWithTimeout: vi.fn(),
    markServerFailed: vi.fn().mockResolvedValue(undefined)
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

describe("Regression Tests for Authorization and Provider Errors", () => {
  let mockChat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChat = vi.fn();
    (getLLMProvider as any).mockReturnValue({ chat: mockChat });
    
    // Default mocks for standard tool
    (registry.getTool as any).mockImplementation((name: string) => {
       if (name.includes("weather")) return { serverId: 1, namespacedName: name, originalToolName: "get_weather", serverName: "weather", available: true };
       if (name.includes("woocommerce")) return { serverId: 2, namespacedName: name, originalToolName: "list_orders", serverName: "woocommerce", available: true };
       if (name.includes("github")) return { serverId: 3, namespacedName: name, originalToolName: "list_issues", serverName: "github", available: true };
       return undefined;
    });
    
    (registry.getAllTools as any).mockReturnValue([]);
    (clientManager.getClient as any).mockReturnValue({ status: "connected" });
  });

  describe("Provider protocol tests", () => {
    it("1. No permitted tools available: normal text response, no invalid tool_choice conflict", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "I can help with general questions." } }]
      });

      const res = await request(app).post("/chat").send({ message: "Hello" });
      
      expect(mockChat).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("no tools available") })]),
        [] // empty available tools
      );
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("I can help with general questions.");
    });

    it("2. Provider attempts a tool despite no tools being available: readable denial, no upstream invocation", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      
      mockChat.mockResolvedValueOnce({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ function: { name: "weather__get_weather", arguments: "{}" } }]
          }
        }]
      });

      const res = await request(app).post("/chat").send({ message: "Weather?" });
      
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("You don't currently have permission to use the Weather `get_weather` tool");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("3 & 5. Provider returns the observed HTTP 400 error: no raw error exposed to the user, not a success", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      
      mockChat.mockRejectedValueOnce(new Error('LLM Error: 400 {"error":{"message":"Tool choice is none, but model called a tool","type":"invalid_request_error","code":"tool_use_failed","failed_generation":"{\\"name\\":\\"weather.run\\",\\"arguments\\":{\\"location\\":\\"Ahmedabad\\"}}"}}'));

      const res = await request(app).post("/chat").send({ message: "Weather in Ahmedabad?" });
      
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("You don't currently have permission to use the Weather `get_weather` tool");
      expect(res.body.message).not.toContain("400");
      expect(res.body.message).not.toContain("failed_generation");
      expect(res.body.message).not.toContain("I have completed the tasks.");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("4. The gateway does not retry the identical invalid request indefinitely", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      // The HTTP 400 rejection will break the loop and return the denial immediately.
      mockChat.mockRejectedValue(new Error('LLM Error: 400 {"error":{"failed_generation":"{\\"name\\":\\"unknown\\"}"}}'));

      const res = await request(app).post("/chat").send({ message: "Do something" });
      
      expect(mockChat).toHaveBeenCalledTimes(1); // Not 5 times!
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("doesn't exist or isn't supported");
    });
  });

  describe("Authorization tests", () => {
    it("6. Ungranted Weather tool: readable denial, no upstream call", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "weather__get_weather", arguments: "{}" } }] } }]
      });
      const res = await request(app).post("/chat").send({ message: "Weather" });
      expect(res.body.message).toContain("Weather `get_weather` tool");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("7. Ungranted WooCommerce orders tool: readable denial, no upstream call", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "woocommerce__list_orders", arguments: "{}" } }] } }]
      });
      const res = await request(app).post("/chat").send({ message: "Orders" });
      expect(res.body.message).toContain("Woocommerce `list_orders` tool");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("8. Ungranted GitHub tool: readable denial, no upstream call", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "github__list_issues", arguments: "{}" } }] } }]
      });
      const res = await request(app).post("/chat").send({ message: "Issues" });
      expect(res.body.message).toContain("Github `list_issues` tool");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("9. Granted tools from all three servers continue working", async () => {
      (isToolAllowed as any).mockResolvedValue(true);
      (registry.getAllTools as any).mockReturnValue([
        { namespacedName: "weather__get_weather" },
        { namespacedName: "woocommerce__list_orders" },
        { namespacedName: "github__list_issues" }
      ]);
      (clientManager.callToolWithTimeout as any).mockResolvedValue({ content: "Success" });
      
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "weather__get_weather", arguments: "{}" } }] } }]
      }).mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "Done" } }]
      });

      const res = await request(app).post("/chat").send({ message: "Weather" });
      expect(res.body.message).toBe("Done");
      expect(clientManager.callToolWithTimeout).toHaveBeenCalledTimes(1);
    });

    it("10. A revoked permission is denied on the next request in the same conversation", async () => {
      // Simulate history where tool was previously allowed
      const history = [
        { role: "user", content: "Weather before" },
        { role: "assistant", tool_calls: [{ id: "call_1", function: { name: "weather__get_weather", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "Sunny" },
        { role: "assistant", content: "It was sunny" }
      ];

      (isToolAllowed as any).mockResolvedValue(false); // NOW REVOKED
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "weather__get_weather", arguments: "{}" } }] } }]
      });

      const res = await request(app).post("/chat").send({ message: "Weather now", conversationHistory: history });
      expect(res.body.message).toContain("Weather `get_weather` tool");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("12. An unknown or ambiguously mapped tool name is never executed", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "random_unknown_tool", arguments: "{}" } }] } }]
      });
      const res = await request(app).post("/chat").send({ message: "Unknown" });
      expect(res.body.message).toContain("permission to access this capability");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });

    it("13. Database permission lookup failure denies member access", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "weather__get_weather", arguments: "{}" } }] } }]
      });
      const res = await request(app).post("/chat").send({ message: "Weather" });
      expect(res.body.message).toContain("Weather `get_weather` tool");
      expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
    });
  });

  describe("History and rendering tests", () => {
    it("15 & 16. A denied turn does not produce 'I have completed the tasks' or false success", async () => {
      (isToolAllowed as any).mockResolvedValue(false);
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ function: { name: "weather__get_weather", arguments: "{}" } }] } }]
      });
      const res = await request(app).post("/chat").send({ message: "Weather" });
      expect(res.body.message).not.toBe("I have completed the tasks.");
      expect(res.body.toolCalls[0].status).toBe("denied");
      expect(res.body.toolCalls[0].result).toContain("Access denied");
    });

    it("18. Provider tool-call history remains protocol-valid after denial", async () => {
      // If frontend forgets tool messages, gateway strips the tool calls from history to keep it valid
      const invalidHistory = [
        { role: "assistant", tool_calls: [{ id: "missing", function: { name: "weather", arguments: "{}" } }] }
      ];
      (isToolAllowed as any).mockResolvedValue(true);
      mockChat.mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "Fixed" } }] });

      await request(app).post("/chat").send({ message: "Hello", conversationHistory: invalidHistory });
      
      const args = mockChat.mock.calls[0][0]; // messages array sent to LLM
      const restoredAssistant = args.find((m: any) => m.role === "assistant" && !m.content?.includes("Urumi MCP Agent"));
      expect(restoredAssistant.tool_calls).toBeUndefined(); // It was stripped!
    });

    it("20. Genuine upstream errors remain distinguishable from permission denials", async () => {
      (isToolAllowed as any).mockResolvedValue(true);
      (clientManager.callToolWithTimeout as any).mockRejectedValue(new Error("Upstream disconnected"));
      
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", function: { name: "weather__get_weather", arguments: "{}" } }] } }]
      }).mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "Upstream failed." } }]
      });

      const res = await request(app).post("/chat").send({ message: "Weather" });
      expect(res.body.toolCalls[0].status).toBe("error");
      expect(res.body.toolCalls[0].result).toContain("Upstream disconnected");
      expect(res.body.message).toBe("Upstream failed.");
    });
  });
});



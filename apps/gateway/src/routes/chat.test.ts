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
    expect(auditService.logAudit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }));
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
});

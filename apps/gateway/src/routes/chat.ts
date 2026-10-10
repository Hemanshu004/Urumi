import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { clientManager } from "../mcp/clientManager.js";
import { logAudit } from "../services/audit.js";
import { registry } from "../mcp/registry.js";
import { getLLMProvider, ChatMessage } from "../services/llm.js";
import { stripNullArgs } from "../utils/toolArgs.js";
import { isToolAllowed } from "../utils/rbac.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

chatRouter.post("/", async (req: any, res) => {
  const { message, conversationHistory } = req.body;
  const userId = req.user.id;
  
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  const toolCallMetadata: any[] = [];
  const provider = getLLMProvider();

  const userRole = req.user.role || "member";
  const availableTools = registry.getAllTools().filter(t => isToolAllowed(userRole, t.namespacedName));
  
  const messages: ChatMessage[] = [
    { role: "system", content: "You are the Urumi MCP Agent. You have access to tools across multiple systems (e.g. WooCommerce, GitHub, Weather). Use them to help the user. The frontend UI will render structured data tables for your tool results automatically. Therefore, YOUR RESPONSES MUST BE VERY CONCISE. Do not explain the data in natural language or create markdown tables. E.g. simply say 'Here are the latest orders.' If the result is empty, just say 'No orders were found.' and offer a useful follow-up action. SPECIFIC INSTRUCTION FOR GITHUB: When GitHub list_issues executes successfully and returns zero issues, you MUST respond clearly: 'No open issues were found in owner/repository.' (use the actual repository owner/name from the request). Do NOT suggest creating a new issue unless a GitHub issue-creation MCP tool is actually available." }
  ];

  if (conversationHistory && Array.isArray(conversationHistory)) {
    for (const msg of conversationHistory) {
      if (msg.role === "user" || msg.role === "assistant" || msg.role === "system") {
        const m: ChatMessage = { role: msg.role as any, content: msg.content || "" };
        if (msg.tool_calls) m.tool_calls = msg.tool_calls;
        messages.push(m);
      }
    }
  }

  if (messages.length === 1 || messages[messages.length - 1].content !== message) {
      messages.push({ role: "user", content: message });
  }

  try {
    let loopCount = 0;
    const maxLoops = 5;
    
    while (loopCount < maxLoops) {
      loopCount++;
      const response = await provider.chat(messages, availableTools);
      const choice = response.choices[0];
      const responseMessage = choice.message;

      const m: ChatMessage = {
        role: responseMessage.role,
        content: responseMessage.content
      };
      if (responseMessage.tool_calls) {
        m.tool_calls = responseMessage.tool_calls;
      }
      messages.push(m);

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        for (const tc of responseMessage.tool_calls) {
          const toolName = tc.function.name;
          let args: Record<string, unknown> = {};
          try {
             args = JSON.parse(tc.function.arguments);
          } catch (e) {
            // Malformed JSON — fall back to empty args
          }

          // LLMs often emit `"key": null` for optional params they don't
          // intend to set.  MCP schemas declare those as typed (e.g. string),
          // so null would fail validation.  Strip null optionals generically.
          const registered = registry.getTool(toolName);
          args = stripNullArgs(args, registered?.inputSchema);

          const toolStart = Date.now();
          let toolResult = "";
          let toolStatus = "success";
          let serverId = 0;

          
          if (!registered) {
            toolResult = `Error: Tool ${toolName} not found or not enabled.`;
            toolStatus = "error";
          } else if (!isToolAllowed(userRole, toolName)) {
            toolResult = `Error: Access denied to tool ${toolName} for role ${userRole}.`;
            toolStatus = "denied";
            serverId = registered.serverId;
          } else {
            serverId = registered.serverId;
            const client = clientManager.getClient(registered.serverName);
            
            if (!client || client.status !== "connected") {
              toolResult = `Error: Server ${registered.serverName} is disconnected.`;
              toolStatus = "error";
            } else {
              try {
                const res: any = await client.client.callTool({
                  name: registered.originalToolName,
                  arguments: args
                });
                
                toolResult = JSON.stringify(res.content);
                toolStatus = res.isError ? "error" : "success";
              } catch (err: any) {
                toolResult = `Error executing tool: ${err.message}`;
                toolStatus = "error";
              }
            }
          }

          const toolDuration = Date.now() - toolStart;
          toolCallMetadata.push({ 
            tool: toolName, 
            status: toolStatus, 
            durationMs: toolDuration,
            args: args,
            result: toolStatus === "success" ? (
              (toolName === "woocommerce__list_orders" || toolName === "woocommerce__list_products" || toolName === "github__list_issues" || toolName === "github__search_repositories" || toolName === "weather__get_weather") 
                ? (() => { try { return JSON.parse(toolResult); } catch { return toolResult; } })() 
                : toolResult
            ) : toolResult
          });

          await logAudit({
            userId,
            serverId: serverId,
            namespacedTool: toolName,
            toolName: registered?.originalToolName || toolName,
            requestParams: args,
            outcome: toolStatus as any,
            durationMs: toolDuration,
            source: "chat-agent",
            startedAt: new Date(toolStart),
            completedAt: new Date()
          });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult
          });
        }
      } else {
        break;
      }
    }

    const finalMessage = messages[messages.length - 1];
    res.json({
      message: finalMessage.content || "I have completed the tasks.",
      toolCalls: toolCallMetadata
    });
  } catch (err: any) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

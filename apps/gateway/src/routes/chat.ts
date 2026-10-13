import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { clientManager } from "../mcp/clientManager.js";
import { logAudit } from "../services/audit.js";
import { registry } from "../mcp/registry.js";
import { getLLMProvider, ChatMessage } from "../services/llm.js";
import { stripNullArgs } from "../utils/toolArgs.js";
import { isToolAllowed } from "../utils/rbac.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { boundConversationHistory, formatAndBoundToolResult } from "../utils/contextBudget.js";

function resolveToolName(rawToolName: string): string {
  if (registry.getTool(rawToolName)) return rawToolName;
  if (rawToolName.includes(".")) {
    return rawToolName.replace(/\./g, "__");
  }
  return rawToolName;
}

function generateDenialMessage(toolName: string): string {
  const registered = registry.getTool(toolName);
  if (registered) {
    const serverNameDisplay = registered.serverName.charAt(0).toUpperCase() + registered.serverName.slice(1);
    const toolNameDisplay = registered.originalToolName;
    return `You don't currently have permission to use the ${serverNameDisplay} \`${toolNameDisplay}\` tool. Please ask your administrator to grant access.`;
  }
  
  const parts = toolName.split("__");
  if (parts.length > 1) {
     const serverNameDisplay = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
     const toolNameDisplay = parts.slice(1).join("__");
     return `You don't currently have permission to use the ${serverNameDisplay} \`${toolNameDisplay}\` tool. Please ask your administrator to grant access.`;
  }
  
  return `You don't currently have permission to access this capability. Please ask your administrator to grant access to the required tool.`;
}

export const chatRouter = Router();

chatRouter.use(requireAuth);

chatRouter.post("/", asyncHandler(async (req: any, res) => {
  const { message, conversationHistory } = req.body;
  const userId = req.user.id;
  
  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  const toolCallMetadata: any[] = [];
  const provider = getLLMProvider();

  const userRole = req.user.role || "member";
  const allTools = registry.getAllTools();
  const availableTools: any[] = [];
  for (const t of allTools) {
    if (await isToolAllowed(userRole, t.namespacedName)) {
      availableTools.push(t);
    }
  }
  
  const currentDate = new Date().toISOString().slice(0, 10);
  const messages: ChatMessage[] = [
    { role: "system", content: `Today's date is ${currentDate}. You are the Urumi MCP Agent. You have access to tools across multiple systems (e.g. WooCommerce, GitHub, Weather). Use them to help the user. The frontend UI will render structured data tables for your tool results automatically. Therefore, YOUR RESPONSES MUST BE VERY CONCISE. Do not explain the data in natural language or create markdown tables. E.g. simply say 'Here are the latest orders.' If the result is empty, just say 'No orders were found.' and offer a useful follow-up action. SPECIFIC INSTRUCTION FOR GITHUB: When GitHub list_issues executes successfully and returns zero issues, you MUST respond clearly: 'No open issues were found in owner/repository.' (use the actual repository owner/name from the request). Do NOT suggest creating a new issue unless a GitHub issue-creation MCP tool is actually available.` }
  ];

  if (availableTools.length === 0) {
      messages.push({
          role: "system",
          content: "You currently have no tools available or permissions have been revoked. Do NOT attempt to call any tools. If the user asks for an action that requires a tool, inform them that they do not have permission to use the necessary capabilities."
      });
  }

  if (conversationHistory && Array.isArray(conversationHistory)) {
    const boundedHistory = boundConversationHistory(conversationHistory);
    messages.push(...boundedHistory);
  }

  if (messages.length === 0 || messages[messages.length - 1].content !== message) {
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

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        let abortWithUserMessage: string | null = null;
        let deniedToolName: string | null = null;
        let deniedArgs: any = null;
        
        for (const tc of responseMessage.tool_calls) {
          const rawToolName = tc.function.name;
          const resolvedToolName = resolveToolName(rawToolName);
          if (!registry.getTool(resolvedToolName) || !(await isToolAllowed(userRole, resolvedToolName))) {
             abortWithUserMessage = generateDenialMessage(resolvedToolName);
             deniedToolName = resolvedToolName;
             try { deniedArgs = JSON.parse(tc.function.arguments); } catch { deniedArgs = {}; }
             break;
          }
        }

        if (abortWithUserMessage) {
           messages.push({
             role: "assistant",
             content: abortWithUserMessage
           });
           
           const registered = registry.getTool(deniedToolName!);
           await logAudit({
              userId,
              serverId: registered?.serverId ?? null,
              namespacedTool: deniedToolName!,
              toolName: registered ? registered.originalToolName : deniedToolName!,
              requestParams: deniedArgs,
              outcome: "denied",
              durationMs: 0,
              source: "chat-agent",
              startedAt: new Date(),
              completedAt: new Date()
           });
           
           logger.warn("Tool access denied", {
              requestId: req.id,
              userId,
              toolName: registered ? registered.originalToolName : deniedToolName!,
              namespacedTool: deniedToolName!,
              serverId: registered?.serverId ?? null,
              outcome: "denied"
           });

           toolCallMetadata.push({
             tool: deniedToolName!,
             status: "denied",
             durationMs: 0,
             args: deniedArgs,
             result: `Error: Access denied to tool ${deniedToolName}.`
           });
           break;
        }

        const m: ChatMessage = {
          role: responseMessage.role,
          content: responseMessage.content
        };
        m.tool_calls = responseMessage.tool_calls;
        messages.push(m);

        for (const tc of responseMessage.tool_calls) {
          const rawToolName = tc.function.name;
          const toolName = resolveToolName(rawToolName);
          let args: Record<string, unknown> = {};
          try {
             args = JSON.parse(tc.function.arguments);
          } catch (e) {
          }

          const registered = registry.getTool(toolName);
          args = stripNullArgs(args, registered?.inputSchema);

          const toolStart = Date.now();
          let toolResult = "";
          let toolStatus = "success";
          let serverId = registered?.serverId ?? null;
          let displayResult: any = "";

          const client = clientManager.getClient(registered!.serverName);
          
          if (!client || client.status !== "connected") {
            toolResult = `Error: Server ${registered!.serverName} is disconnected.`;
            displayResult = toolResult;
            toolStatus = "error";
          } else {
            try {
              const res: any = await clientManager.callToolWithTimeout(registered!.serverName, registered!.originalToolName, args);
              toolStatus = res.isError ? "error" : "success";
              const bounded = formatAndBoundToolResult(toolName, res.content ?? res);
              toolResult = bounded.llmContent;
              displayResult = toolStatus === "success" ? bounded.displayResult : toolResult;
            } catch (err: any) {
              if (err.message === "Timeout") {
                toolResult = `Error: Upstream server timed out after configured timeout.`;
                toolStatus = "timeout";
              } else {
                toolResult = `Error executing tool: ${err.message}`;
                toolStatus = "error";
              }
              displayResult = toolResult;
            }
          }

          const toolDuration = Date.now() - toolStart;
          toolCallMetadata.push({ 
            tool: toolName, 
            status: toolStatus, 
            durationMs: toolDuration,
            args: args,
            result: displayResult
          });

          await logAudit({
            userId,
            serverId: serverId,
            namespacedTool: toolName,
            toolName: registered!.originalToolName,
            requestParams: args,
            outcome: toolStatus as any,
            durationMs: toolDuration,
            source: "chat-agent",
            startedAt: new Date(toolStart),
            completedAt: new Date()
          });

          logger.info("Tool executed", {
            requestId: req.id,
            userId,
            toolName: registered!.originalToolName,
            namespacedTool: toolName,
            serverId,
            outcome: toolStatus,
            durationMs: toolDuration
          });

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult
          });
        }
      } else {
        const m: ChatMessage = {
          role: responseMessage.role,
          content: responseMessage.content
        };
        messages.push(m);
        break;
      }
    }

    let finalMessage = messages[messages.length - 1];
    
    if (finalMessage.role === "assistant" && finalMessage.content) {
       try {
         const parsed = JSON.parse(finalMessage.content);
         if (parsed && typeof parsed === "object") {
            if (parsed.action) {
               const resolvedName = resolveToolName(parsed.action);
               finalMessage.content = generateDenialMessage(resolvedName);
            }
         }
       } catch (e) {
       }
    }

    res.json({
      message: finalMessage.content || (availableTools.length === 0 
        ? "You do not currently have permission to use the necessary tools for this request." 
        : "Here is the information you requested."),
      toolCalls: toolCallMetadata
    });
  } catch (err: any) {
    const errMsg = err.message || "";
    const errStatus = err.status || 0;

    const is413 =
      errStatus === 413 ||
      errMsg.includes("413") ||
      errMsg.includes("Request too large") ||
      errMsg.toLowerCase().includes("tpm limit") ||
      errMsg.toLowerCase().includes("context_length_exceeded") ||
      (errMsg.toLowerCase().includes("rate limit") && errMsg.toLowerCase().includes("tpm"));

    if (is413) {
      logger.warn("Chat request exceeded LLM context or token limit (413)", { error: errMsg, userId });
      return res.status(413).json({
        error: "The request exceeded the model token limit or context window. Tool outputs or conversation history have been pruned, but the prompt remained too large for the provider. Please shorten your request or clear chat history.",
        code: "REQUEST_TOO_LARGE"
      });
    }

    if (errMsg.includes("400") || errMsg.includes("tool_use_failed")) {
         try {
           const jsonStrMatch = errMsg.match(/\{"error":.*\}/);
           if (jsonStrMatch) {
             const errJson = JSON.parse(jsonStrMatch[0]);
             if (errJson.error && errJson.error.failed_generation) {
               const failedGen = JSON.parse(errJson.error.failed_generation);
               const rawToolName = failedGen.name;
               const resolvedToolName = resolveToolName(rawToolName);
               
               const registered = registry.getTool(resolvedToolName);
               
               if (!registered) {
                 return res.json({
                   message: `I'm sorry, I tried to use a tool that doesn't exist or isn't supported (\`${rawToolName}\`). Please try rephrasing your request.`,
                   toolCalls: [{
                     tool: rawToolName,
                     status: "error",
                     durationMs: 0,
                     args: failedGen.arguments || {},
                     result: `Error: The model hallucinated an unregistered tool.`
                   }]
                 });
               }
               
               // It IS registered. Check if it's allowed.
               // We need isToolAllowed but we are in the catch block which is not async in a way we can just await easily if we didn't have userRole? 
               // Actually we are in async router handler.
               const isAllowed = await isToolAllowed(req.user.role || "member", resolvedToolName);
               
               if (!isAllowed) {
                 const denialMsg = generateDenialMessage(resolvedToolName);
                 
                 await logAudit({
                    userId,
                    serverId: registered.serverId ?? null,
                    namespacedTool: resolvedToolName,
                    toolName: registered.originalToolName,
                    requestParams: failedGen.arguments || {},
                    outcome: "denied",
                    durationMs: 0,
                    source: "chat-agent",
                    startedAt: new Date(),
                    completedAt: new Date()
                 });

                 return res.json({
                   message: denialMsg,
                   toolCalls: [{
                     tool: resolvedToolName,
                     status: "denied",
                     durationMs: 0,
                     args: failedGen.arguments || {},
                     result: `Error: Access denied to tool ${resolvedToolName}.`
                   }]
                 });
               }
               
               // If it IS registered and IS allowed, but still failed:
               return res.json({
                   message: `I attempted to use the \`${registered.originalToolName}\` tool but provided an invalid format or arguments. Please try rephrasing your request.`,
                   toolCalls: [{
                     tool: resolvedToolName,
                     status: "error",
                     durationMs: 0,
                     args: failedGen.arguments || {},
                     result: `Error: Provider rejected the tool call format.`
                   }]
               });
             }
           }
         } catch (e) {
         }
      }
    logger.error("Chat error", { error: err.message, userId });
    res.status(500).json({ error: "An unexpected error occurred during chat orchestration." });
  }
}));

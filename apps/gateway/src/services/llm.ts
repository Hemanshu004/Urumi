import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools: any[]): Promise<any>;
}

export class OpenAILikeProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.LLM_API_KEY || "";
    const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.model = process.env.LLM_MODEL || "gpt-4o";
  }

  async chat(messages: ChatMessage[], tools: any[]): Promise<any> {
    if (!this.apiKey) {
      throw new Error("LLM configuration error: LLM_API_KEY is not set.");
    }

    const payload: any = {
      model: this.model,
      messages: messages,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.namespacedName,
          description: t.description,
          parameters: t.inputSchema || { type: "object", properties: {} },
        },
      }));
      // Workaround for some providers wanting tool_choice auto
      payload.tool_choice = "auto";
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM Error: ${res.status} ${text}`);
    }

    const jsonResponse = await res.json();
    logger.info("LLM Response structure", { response: jsonResponse });
    return jsonResponse;
  }
}

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.LLM_API_KEY || "";
    if (!apiKey) {
      throw new Error("LLM configuration error: LLM_API_KEY is not set.");
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = process.env.LLM_MODEL || "gemini-3.8-flash";
  }

  async chat(messages: ChatMessage[], tools: any[]): Promise<any> {
    const systemInstruction = messages.find(m => m.role === "system")?.content;
    const conversation = messages.filter(m => m.role !== "system");

    const contents: any[] = [];
    let currentToolParts: any[] = [];

    for (let i = 0; i < conversation.length; i++) {
      const m = conversation[i];
      if (m.role === "user") {
        if (currentToolParts.length > 0) {
          contents.push({ role: "user", parts: currentToolParts });
          currentToolParts = [];
        }
        contents.push({ role: "user", parts: [{ text: m.content || "" }] });
      } else if (m.role === "assistant") {
        if (currentToolParts.length > 0) {
          contents.push({ role: "user", parts: currentToolParts });
          currentToolParts = [];
        }
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
              }
            });
          }
        }
        if (parts.length > 0) contents.push({ role: "model", parts });
      } else if (m.role === "tool") {
        let toolName = "unknown_tool";
        for (let j = i - 1; j >= 0; j--) {
          if (conversation[j].tool_calls) {
            const tc = conversation[j].tool_calls!.find((t: any) => t.id === m.tool_call_id);
            if (tc) { toolName = tc.function.name; break; }
          }
        }
        let parsedResult;
        try {
          parsedResult = JSON.parse(m.content || "{}");
        } catch {
          parsedResult = { result: m.content };
        }
        currentToolParts.push({
          functionResponse: {
            name: toolName,
            response: parsedResult
          }
        });
      }
    }
    
    if (currentToolParts.length > 0) {
      contents.push({ role: "user", parts: currentToolParts });
    }

    const reqOptions: any = {
      model: this.model,
      contents,
    };
    
    if (systemInstruction) {
      reqOptions.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    if (tools && tools.length > 0) {
      reqOptions.tools = [{
        functionDeclarations: tools.map(t => {
          // ensure parameters matches Gemini's strict Type format if necessary, 
          // but passing the JSON schema directly usually works in @google/genai.
          return {
            name: t.namespacedName,
            description: t.description,
            parameters: jsonSchemaToGeminiSchema(t.inputSchema || { type: "object", properties: {} })
          };
        })
      }];
    }

    try {
      let attempt = 0;
      const maxRetries = 3;
      let response: any;
      
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      while (true) {
        try {
          response = await this.ai.models.generateContent(reqOptions);
          break; // Success, exit retry loop
        } catch (e: any) {
          const msg = e.message || String(e);
          const status = e.status || 0;
          
          const is503 = msg.includes("503") || status === 503;
          const isQuotaExceeded = msg.toLowerCase().includes("quota exceeded") || msg.toLowerCase().includes("exhausted");
          const is429 = (msg.includes("429") || status === 429) && !isQuotaExceeded;
          
          if (!is503 && !is429) {
            throw e; // Throw original error if non-retryable
          }
          
          if (attempt >= maxRetries) {
            throw new Error(`API request failed after ${maxRetries} retries due to transient errors. Please try again later.`);
          }
          
          const baseDelay = 1000 * Math.pow(2, attempt);
          const jitter = Math.random() * 500;
          const waitTime = baseDelay + jitter;
          
          logger.warn(`[GeminiProvider] Transient error detected (${is503 ? '503' : '429'}). Retrying...`, { attempt: attempt + 1, maxRetries, waitTimeMs: Math.round(waitTime) });
          
          await delay(waitTime);
          attempt++;
        }
      }
      
      const responseMessage: any = {
        role: "assistant",
        content: response.text || null
      };

      if (response.functionCalls && response.functionCalls.length > 0) {
        responseMessage.tool_calls = response.functionCalls.map((fc: any, idx: number) => ({
          id: `call_${Date.now()}_${idx}`,
          type: "function",
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args || {})
          }
        }));
      }

      return {
        choices: [
          {
            message: responseMessage
          }
        ]
      };
    } catch (e: any) {
      const msg = e.message || "Unknown error";
      // Sanitize out API key if present
      const safeMsg = msg.replace(new RegExp(process.env.LLM_API_KEY || "impossible_key_value", "g"), "***");
      throw new Error(`Gemini Provider Error: ${safeMsg}`);
    }
  }
}

// Convert standard JSON schema types (lowercase) to Gemini schema types (uppercase)
function jsonSchemaToGeminiSchema(schema: any): any {
  if (!schema) return undefined;
  
  const result: any = { ...schema };
  
  if (result.type && typeof result.type === 'string') {
    result.type = result.type.toUpperCase();
  }
  
  if (result.properties) {
    const newProps: any = {};
    for (const [k, v] of Object.entries(result.properties)) {
      newProps[k] = jsonSchemaToGeminiSchema(v);
    }
    result.properties = newProps;
  }
  
  if (result.items) {
    result.items = jsonSchemaToGeminiSchema(result.items);
  }
  
  return result;
}

export function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER || "openai";
  if (provider.toLowerCase() === "gemini") {
    return new GeminiProvider();
  }
  return new OpenAILikeProvider();
}

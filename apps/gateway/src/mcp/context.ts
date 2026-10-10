import { AsyncLocalStorage } from "async_hooks";

export interface McpContext {
  userId?: number;
  keyId?: number;
  role?: string;
  source?: string;
  requestId?: string;
}

export const mcpContext = new AsyncLocalStorage<McpContext>();


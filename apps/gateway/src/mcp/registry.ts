export interface RegisteredTool {
  namespacedName: string;
  serverName: string;
  serverId: number;
  originalToolName: string;
  description?: string;
  inputSchema?: any;
  available: boolean;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  public clearServerTools(serverName: string) {
    for (const [key, tool] of this.tools.entries()) {
      if (tool.serverName === serverName) {
        this.tools.delete(key);
      }
    }
  }

  public registerTool(tool: RegisteredTool) {
    this.tools.set(tool.namespacedName, tool);
  }

  public getTool(namespacedName: string): RegisteredTool | undefined {
    return this.tools.get(namespacedName);
  }

  public getAllTools(): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(t => t.available);
  }
}

export const registry = new ToolRegistry();

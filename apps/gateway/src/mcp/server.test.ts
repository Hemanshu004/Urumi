import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupMcpServer, createMcpServerInstance } from './server.js';
import { isToolAllowed } from '../utils/rbac.js';
import { registry } from './registry.js';
import { clientManager } from './clientManager.js';
import express from 'express';
import { mcpContext } from './context.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { logAudit } from '../services/audit.js';

vi.mock('../utils/rbac.js', () => ({
  isToolAllowed: vi.fn()
}));

vi.mock('./registry.js', () => ({
  registry: {
    getTool: vi.fn(),
    getAllTools: vi.fn()
  }
}));

vi.mock('./clientManager.js', () => ({
  clientManager: {
    getClient: vi.fn(),
    callToolWithTimeout: vi.fn(),
    markServerFailed: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../services/audit.js', () => ({
  logAudit: vi.fn()
}));

describe('MCP Server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized tool calls directly and logs audit once', async () => {
    (isToolAllowed as any).mockResolvedValue(false);
    (registry.getTool as any).mockReturnValue({
      serverId: 1,
      serverName: 'test-server',
      originalToolName: 'test-tool',
      namespacedName: 'test-server__test-tool'
    });

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 1,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");
    
    await expect(
      callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: { query: 'test' } } })
    ).rejects.toThrow('Access denied: Tool test-server__test-tool is not allowed for role member');

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      serverId: 1,
      namespacedTool: 'test-server__test-tool',
      toolName: 'test-tool',
      outcome: 'denied',
      errorMessage: expect.stringContaining('Access denied'),
      source: 'external',
      durationMs: expect.any(Number),
      startedAt: expect.any(Date),
      completedAt: expect.any(Date)
    }));
  });

  it('audits and rejects unknown tool calls without crashing the gateway', async () => {
    (registry.getTool as any).mockReturnValue(undefined);
    (registry.getAllTools as any).mockReturnValue([]);

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 9,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");

    await expect(
      callToolHandler({ method: 'tools/call', params: { name: 'unknown_tool', arguments: { param: 123 } } })
    ).rejects.toThrow('Tool not found: unknown_tool');

    // Audited before throwing, with serverId: null since server is unknown
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9,
      serverId: null,
      namespacedTool: 'unknown_tool',
      toolName: 'unknown_tool',
      requestParams: { param: 123 },
      outcome: 'error',
      errorMessage: 'Tool not found: unknown_tool',
      source: 'external',
      durationMs: expect.any(Number),
      startedAt: expect.any(Date),
      completedAt: expect.any(Date)
    }));
    expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
  });

  it('audits unknown tool with known server prefix by attributing serverId', async () => {
    (registry.getTool as any).mockReturnValue(undefined);
    (registry.getAllTools as any).mockReturnValue([
      { serverName: 'github', serverId: 5, namespacedName: 'github__search_repositories' }
    ]);

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 2,
      role: 'admin',
      source: 'mcp-client'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");

    await expect(
      callToolHandler({ method: 'tools/call', params: { name: 'github__nonexistent_tool', arguments: {} } })
    ).rejects.toThrow('Tool not found: github__nonexistent_tool');

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 2,
      serverId: 5,
      namespacedTool: 'github__nonexistent_tool',
      toolName: 'nonexistent_tool',
      outcome: 'error',
      errorMessage: 'Tool not found: github__nonexistent_tool',
      source: 'mcp-client'
    }));
    expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
  });

  it('audits and rejects calls to unavailable or disconnected upstream servers before invocation', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
      serverId: 3,
      serverName: 'woocommerce',
      originalToolName: 'list_orders',
      namespacedName: 'woocommerce__list_orders'
    });
    // Server is disconnected
    (clientManager.getClient as any).mockReturnValue({ status: 'disconnected' });

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 4,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");

    await expect(
      callToolHandler({ method: 'tools/call', params: { name: 'woocommerce__list_orders', arguments: {} } })
    ).rejects.toThrow('Upstream server woocommerce is not available');

    // Audited with outcome: error before upstream invocation
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 4,
      serverId: 3,
      namespacedTool: 'woocommerce__list_orders',
      toolName: 'list_orders',
      outcome: 'error',
      errorMessage: 'Upstream server woocommerce is not available',
      source: 'external'
    }));
    expect(clientManager.callToolWithTimeout).not.toHaveBeenCalled();
  });

  it('allows authorized tool calls and records success audit log', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
      serverId: 1,
      serverName: 'test-server',
      originalToolName: 'test-tool',
      namespacedName: 'test-server__test-tool'
    });
    (clientManager.getClient as any).mockReturnValue({ status: 'connected' });
    (clientManager.callToolWithTimeout as any).mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 1,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");
    
    const result = await callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } });
    expect(result.content[0].text).toBe('success');

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      serverId: 1,
      namespacedTool: 'test-server__test-tool',
      toolName: 'test-tool',
      outcome: 'success',
      errorMessage: undefined,
      durationMs: expect.any(Number)
    }));
  });

  it('audits tool call timeout without marking server failed and without duplicate audits', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
      serverId: 2,
      serverName: 'test-server',
      originalToolName: 'test-tool',
      namespacedName: 'test-server__test-tool'
    });
    (clientManager.getClient as any).mockReturnValue({ status: 'connected' });
    (clientManager.callToolWithTimeout as any).mockRejectedValue(new Error('Timeout'));

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 3,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");

    const result = await callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Upstream server timed out');

    // Exactly one audit entry with timeout outcome
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 3,
      serverId: 2,
      namespacedTool: 'test-server__test-tool',
      toolName: 'test-tool',
      outcome: 'timeout',
      errorMessage: 'Upstream server timed out'
    }));

    // Server should NOT be marked permanently failed for a simple timeout
    expect(clientManager.markServerFailed).not.toHaveBeenCalled();

    // Recovery test
    (clientManager.callToolWithTimeout as any).mockResolvedValueOnce({ content: [{ type: 'text', text: 'recovered success' }] });
    const recoveryResult = await callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } });
    expect(recoveryResult.content[0].text).toBe('recovered success');
    expect(logAudit).toHaveBeenCalledTimes(2); // exactly 1 additional audit for recovery call
  });

  it('audits genuine upstream connection error and marks server failed', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
      serverId: 2,
      serverName: 'test-server',
      originalToolName: 'test-tool',
      namespacedName: 'test-server__test-tool'
    });
    (clientManager.getClient as any).mockReturnValue({ status: 'connected' });
    (clientManager.callToolWithTimeout as any).mockRejectedValue(new Error('ECONNREFUSED'));

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 1,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");

    const result = await callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ECONNREFUSED');

    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      serverId: 2,
      namespacedTool: 'test-server__test-tool',
      toolName: 'test-tool',
      outcome: 'error',
      errorMessage: 'ECONNREFUSED'
    }));

    // Genuine hard errors should disconnect server and mark it failed
    expect(clientManager.markServerFailed).toHaveBeenCalledWith('test-server', 'ECONNREFUSED');
  });
});

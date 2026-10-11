import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupMcpServer, createMcpServerInstance } from './server.js';
import { isToolAllowed } from '../utils/rbac.js';
import { registry } from './registry.js';
import { clientManager } from './clientManager.js';
import express from 'express';
import { mcpContext } from './context.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

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

  it('rejects unauthorized tool calls directly', async () => {
    (isToolAllowed as any).mockResolvedValue(false);
    (registry.getTool as any).mockReturnValue({
      serverName: 'test-server',
      originalToolName: 'test-tool',
      namespacedName: 'test-server__test-tool'
    });

    // Mock Context
    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 1,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();

    const callToolHandler = server._requestHandlers.get("tools/call");
    
    await expect(
      callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } })
    ).rejects.toThrow('Access denied: Tool test-server__test-tool is not allowed for role member');
  });

  it('allows authorized tool calls', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
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
  });

  it('does not mark server failed on a tool call timeout', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
      serverName: 'test-server',
      originalToolName: 'test-tool',
      namespacedName: 'test-server__test-tool'
    });
    (clientManager.getClient as any).mockReturnValue({ status: 'connected' });
    (clientManager.callToolWithTimeout as any).mockRejectedValue(new Error('Timeout'));

    vi.spyOn(mcpContext, 'getStore').mockReturnValue({
      userId: 1,
      role: 'member',
      source: 'external'
    });

    const server: any = createMcpServerInstance();
    const callToolHandler = server._requestHandlers.get("tools/call");

    const result = await callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Upstream server timed out');

    // Crucial check: we should not have permanently failed the server for a simple tool timeout
    expect(clientManager.markServerFailed).not.toHaveBeenCalled();

    // Recovery / transient timeout check: if called again and succeeds, it works
    (clientManager.callToolWithTimeout as any).mockResolvedValueOnce({ content: [{ type: 'text', text: 'recovered success' }] });
    const recoveryResult = await callToolHandler({ method: 'tools/call', params: { name: 'test-server__test-tool', arguments: {} } });
    expect(recoveryResult.content[0].text).toBe('recovered success');
  });

  it('does mark server failed on genuine upstream connection error', async () => {
    (isToolAllowed as any).mockResolvedValue(true);
    (registry.getTool as any).mockReturnValue({
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

    // Crucial check: genuine hard errors should disconnect the server and mark it failed
    expect(clientManager.markServerFailed).toHaveBeenCalledWith('test-server', 'ECONNREFUSED');
  });
});

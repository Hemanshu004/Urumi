import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clientManager } from './clientManager.js';
import { registry } from './registry.js';
import { db } from '../db/index.js';

vi.mock('../db/index.js', () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis()
  }
}));

vi.mock('./registry.js', () => ({
  registry: {
    clearServerTools: vi.fn(),
    registerTool: vi.fn(),
    getAllTools: vi.fn(),
    getTool: vi.fn()
  }
}));

describe('ClientManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clientManager.stopHealthCheckLoop();
    vi.useRealTimers();
  });

  it('disconnectServer should close client, clear registry tools, and update DB', async () => {
    const mockClient = { close: vi.fn().mockResolvedValue(undefined) };
    // @ts-ignore
    clientManager.clients.set('test-server', {
      id: 1, name: 'test-server', url: 'http://localhost', client: mockClient as any, status: 'connected'
    });
    
    // Mock select returning the server
    (db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: 'test-server' }])
        })
      })
    });

    await clientManager.disconnectServer('test-server');

    expect(mockClient.close).toHaveBeenCalled();
    expect(registry.clearServerTools).toHaveBeenCalledWith('test-server');
    // @ts-ignore
    expect(clientManager.clients.has('test-server')).toBe(false);
    expect(db.update).toHaveBeenCalled();
    const mockSet = (db.update as any)().set;
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'disconnected'
    }));
  });

  it('markServerFailed should disconnect and setup reconnect state', async () => {
    // @ts-ignore
    clientManager.clients.set('test-server', {
      id: 1, name: 'test-server', url: 'http://localhost', client: { close: vi.fn() } as any, status: 'connected'
    });

    await clientManager.markServerFailed('test-server', 'fetch failed');

    // @ts-ignore
    expect(clientManager.clients.has('test-server')).toBe(false);
    expect(db.update).toHaveBeenCalled();
    const mockSet = (db.update as any)().set;
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      status_message: 'fetch failed'
    }));
    
    // @ts-ignore
    expect(clientManager.reconnectState.has('test-server')).toBe(true);
  });
  
  describe('Health Check Loop', () => {
    it('should start only once', () => {
      clientManager.startHealthCheckLoop(30000);
      // @ts-ignore
      const intervalId1 = clientManager.healthCheckInterval;
      clientManager.startHealthCheckLoop(30000);
      // @ts-ignore
      const intervalId2 = clientManager.healthCheckInterval;
      
      expect(intervalId1).toBe(intervalId2);
      expect(intervalId1).not.toBeNull();
    });

    it('healthy upstream retains tools and updates db status', async () => {
      const mockClient = { listTools: vi.fn().mockResolvedValue({ tools: [] }) };
      // @ts-ignore
      clientManager.clients.set('test-server', {
        id: 1, name: 'test-server', url: 'http://localhost', client: mockClient as any, status: 'connected'
      });
      
      // Mock db select returning this server enabled
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ id: 1, name: 'test-server', enabled: true }])
        })
      });

      clientManager.startHealthCheckLoop(30000);
      await vi.advanceTimersByTimeAsync(30000);
      
      expect(mockClient.listTools).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      const mockSet = (db.update as any)().set;
      expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
        status: 'connected'
      }));
    });
    
    it('detects unresponsive upstream and triggers markServerFailed', async () => {
      // Mock listTools to never resolve
      const mockClient = { listTools: vi.fn().mockImplementation(() => new Promise(() => {})) };
      // @ts-ignore
      clientManager.clients.set('unresponsive-server', {
        id: 2, name: 'unresponsive-server', url: 'http://localhost', client: mockClient as any, status: 'connected'
      });
      
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ id: 2, name: 'unresponsive-server', enabled: true }])
        })
      });
      
      clientManager.startHealthCheckLoop(30000);
      // Advance by interval + 10s timeout
      await vi.advanceTimersByTimeAsync(40000);
      
      // The markServerFailed should disconnect it and update db
      // @ts-ignore
      expect(clientManager.clients.has('unresponsive-server')).toBe(false);
      expect(registry.clearServerTools).toHaveBeenCalledWith('unresponsive-server');
      // @ts-ignore
      expect(clientManager.reconnectState.has('unresponsive-server')).toBe(true);
    });
    
    it('retries reconnecting a failed upstream using bounds and jitter', async () => {
      // @ts-ignore
      clientManager.reconnectState.set('failed-server', { attempts: 0, nextAttempt: 0 });
      
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ id: 3, name: 'failed-server', enabled: true }])
        })
      });
      // Mock db select inside reconnectServer
      (db.select as any).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 3, name: 'failed-server', enabled: true }])
          })
        })
      });
      
      // Spy on connectServer
      const spyConnect = vi.spyOn(clientManager, 'connectServer').mockResolvedValueOnce(undefined);
      
      clientManager.startHealthCheckLoop(30000);
      await vi.advanceTimersByTimeAsync(30000);
      
      expect(spyConnect).toHaveBeenCalledWith(expect.objectContaining({ name: 'failed-server' }));
    });
  });

  describe('callToolWithTimeout', () => {
    it('returns result when tool call is successful', async () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({ content: 'success' })
      };
      // @ts-ignore
      clientManager.clients.set('test-server', {
        id: 1, name: 'test-server', url: 'http://localhost', client: mockClient as any, status: 'connected', timeout_ms: 5000
      });

      const result = await clientManager.callToolWithTimeout('test-server', 'tool1', {});
      expect(result.content).toBe('success');
    });

    it('times out when tool call takes too long', async () => {
      const mockClient = {
        callTool: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 2000)))
      };
      // @ts-ignore
      clientManager.clients.set('test-server', {
        id: 1, name: 'test-server', url: 'http://localhost', client: mockClient as any, status: 'connected', timeout_ms: 1000
      });

      const start = Date.now();
      const call = clientManager.callToolWithTimeout('test-server', 'tool1', {});
      const assertion = expect(call).rejects.toThrow('Timeout');
      await vi.advanceTimersByTimeAsync(1001);
      
      await assertion;
    });

    it('cleans up timer on success and does not cause unhandled rejections on late errors', async () => {
      let lateReject: any;
      const mockClient = {
        callTool: vi.fn().mockImplementation(() => new Promise((_, reject) => {
          lateReject = reject;
        }))
      };
      // @ts-ignore
      clientManager.clients.set('test-server', {
        id: 1, name: 'test-server', url: 'http://localhost', client: mockClient as any, status: 'connected', timeout_ms: 1000
      });

      const call = clientManager.callToolWithTimeout('test-server', 'tool1', {});
      const assertion = expect(call).rejects.toThrow('Timeout');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      
      expect(() => lateReject(new Error('late error'))).not.toThrow();
    });
  });

  describe('syncTools', () => {
    it('discovers and registers tools for github with server prefix namespacing', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'list_issues', description: 'List GitHub issues', inputSchema: { type: 'object' } },
            { name: 'search_repositories', description: 'Search GitHub repos', inputSchema: { type: 'object' } }
          ]
        })
      };
      // @ts-ignore
      clientManager.clients.set('github', {
        id: 2, name: 'github', url: 'http://github-mcp:3002/mcp', client: mockClient as any, status: 'connected', timeout_ms: 5000
      });

      await clientManager.syncTools('github');

      expect(registry.clearServerTools).toHaveBeenCalledWith('github');
      expect(registry.registerTool).toHaveBeenCalledWith({
        namespacedName: 'github__list_issues',
        serverName: 'github',
        serverId: 2,
        originalToolName: 'list_issues',
        description: 'List GitHub issues',
        inputSchema: { type: 'object' },
        available: true
      });
      expect(registry.registerTool).toHaveBeenCalledWith({
        namespacedName: 'github__search_repositories',
        serverName: 'github',
        serverId: 2,
        originalToolName: 'search_repositories',
        description: 'Search GitHub repos',
        inputSchema: { type: 'object' },
        available: true
      });
    });

    it('discovers and registers tools for weather with server prefix namespacing', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [
            { name: 'get_weather', description: 'Get weather forecast', inputSchema: { type: 'object' } },
            { name: 'get_forecast', description: 'Get daily forecast', inputSchema: { type: 'object' } }
          ]
        })
      };
      // @ts-ignore
      clientManager.clients.set('weather', {
        id: 3, name: 'weather', url: 'http://weather-mcp:3003/mcp', client: mockClient as any, status: 'connected', timeout_ms: 5000
      });

      await clientManager.syncTools('weather');

      expect(registry.clearServerTools).toHaveBeenCalledWith('weather');
      expect(registry.registerTool).toHaveBeenCalledWith({
        namespacedName: 'weather__get_weather',
        serverName: 'weather',
        serverId: 3,
        originalToolName: 'get_weather',
        description: 'Get weather forecast',
        inputSchema: { type: 'object' },
        available: true
      });
      expect(registry.registerTool).toHaveBeenCalledWith({
        namespacedName: 'weather__get_forecast',
        serverName: 'weather',
        serverId: 3,
        originalToolName: 'get_forecast',
        description: 'Get daily forecast',
        inputSchema: { type: 'object' },
        available: true
      });
    });
  });
});

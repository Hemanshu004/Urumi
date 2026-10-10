import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientManager } from './clientManager.js';
import { registry } from './registry.js';
import { db } from '../db/index.js';

vi.mock('../db/index.js', () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis()
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
  });

  it('disconnectServer should close client and clear registry tools', async () => {
    const mockClient = { close: vi.fn().mockResolvedValue(undefined) };
    // @ts-ignore - internal access for testing
    clientManager.clients.set('test-server', {
      id: 1,
      name: 'test-server',
      url: 'http://localhost',
      client: mockClient as any,
      status: 'connected'
    });

    await clientManager.disconnectServer('test-server');

    expect(mockClient.close).toHaveBeenCalled();
    expect(registry.clearServerTools).toHaveBeenCalledWith('test-server');
    // @ts-ignore
    expect(clientManager.clients.has('test-server')).toBe(false);
  });

  it('markServerFailed should update status to error and persist to db', async () => {
    // @ts-ignore
    clientManager.clients.set('test-server', {
      id: 1,
      name: 'test-server',
      url: 'http://localhost',
      client: {} as any,
      status: 'connected'
    });

    await clientManager.markServerFailed('test-server', 'fetch failed');

    // @ts-ignore
    expect(clientManager.clients.get('test-server').status).toBe('error');
    expect(db.update).toHaveBeenCalled();
    const mockSet = (db.update as any)().set;
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      status_message: 'fetch failed'
    }));
  });
});

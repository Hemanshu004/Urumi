import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAudit } from './audit.js';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

vi.mock('../db/index.js', () => {
  const valuesMock = vi.fn().mockResolvedValue([]);
  return {
    db: {
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
      _valuesMock: valuesMock
    }
  };
});

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ((db as any)._valuesMock).mockResolvedValue([]);
  });

  it('should redact sensitive information in request parameters', async () => {
    const record = {
      namespacedTool: 'test__tool',
      toolName: 'tool',
      outcome: 'success' as const,
      durationMs: 100,
      source: 'test',
      startedAt: new Date(),
      completedAt: new Date(),
      requestParams: {
        normal_arg: 'hello',
        password: 'supersecretpassword',
        api_key: 'myapikey',
        nested: {
          secret_token: 'nestedsecret',
          public_info: 'public'
        }
      }
    };

    const success = await logAudit(record);

    expect(success).toBe(true);
    expect(db.insert).toHaveBeenCalled();
    const insertMock = (db as any)._valuesMock;
    const insertedValues = insertMock.mock.calls[0][0];

    expect(insertedValues.request_params.normal_arg).toBe('hello');
    expect(insertedValues.request_params.password).toBe('[REDACTED]');
    expect(insertedValues.request_params.api_key).toBe('[REDACTED]');
    expect(insertedValues.request_params.nested.secret_token).toBe('[REDACTED]');
    expect(insertedValues.request_params.nested.public_info).toBe('public');
    
    // original record should not be mutated
    expect(record.requestParams.password).toBe('supersecretpassword');
  });

  it('should record actual server ID when provided for a registered tool', async () => {
    const startedAt = new Date('2026-01-01T00:00:00Z');
    const completedAt = new Date('2026-01-01T00:00:01Z');
    const record = {
      userId: 10,
      serverId: 42,
      namespacedTool: 'github__list_issues',
      toolName: 'list_issues',
      requestParams: { repo: 'urumi' },
      outcome: 'success' as const,
      durationMs: 1000,
      source: 'chat-agent',
      startedAt,
      completedAt
    };

    const success = await logAudit(record);

    expect(success).toBe(true);
    const insertMock = (db as any)._valuesMock;
    const insertedValues = insertMock.mock.calls[0][0];

    expect(insertedValues.server_id).toBe(42);
    expect(insertedValues.user_id).toBe(10);
    expect(insertedValues.namespaced_tool).toBe('github__list_issues');
    expect(insertedValues.tool_name).toBe('list_issues');
    expect(insertedValues.outcome).toBe('success');
    expect(insertedValues.duration_ms).toBe(1000);
    expect(insertedValues.source).toBe('chat-agent');
    expect(insertedValues.started_at).toBe(startedAt);
    expect(insertedValues.completed_at).toBe(completedAt);
  });

  it('should record server_id as null when tool has no resolved server (serverId is null)', async () => {
    const record = {
      userId: 5,
      serverId: null,
      namespacedTool: 'unregistered__tool',
      toolName: 'unregistered__tool',
      requestParams: { foo: 'bar' },
      outcome: 'denied' as const,
      durationMs: 0,
      source: 'chat-agent',
      startedAt: new Date(),
      completedAt: new Date()
    };

    const success = await logAudit(record);

    expect(success).toBe(true);
    const insertMock = (db as any)._valuesMock;
    const insertedValues = insertMock.mock.calls[0][0];

    expect(insertedValues.server_id).toBeNull();
    expect(insertedValues.outcome).toBe('denied');
  });

  it('should record server_id as null when serverId is omitted/undefined', async () => {
    const record = {
      namespacedTool: 'system__revoke_key',
      toolName: 'revoke_key',
      requestParams: {},
      outcome: 'success' as const,
      durationMs: 0,
      source: 'dashboard',
      startedAt: new Date(),
      completedAt: new Date()
    };

    const success = await logAudit(record);

    expect(success).toBe(true);
    const insertMock = (db as any)._valuesMock;
    const insertedValues = insertMock.mock.calls[0][0];

    expect(insertedValues.server_id).toBeNull();
    expect(insertedValues.user_id).toBeNull();
  });

  it('should handle database insertion failure by logging error and returning false without throwing', async () => {
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger as any);
    ((db as any)._valuesMock).mockRejectedValueOnce(new Error('violates foreign key constraint'));

    const record = {
      serverId: 9999,
      namespacedTool: 'invalid__tool',
      toolName: 'invalid',
      requestParams: {},
      outcome: 'error' as const,
      durationMs: 0,
      source: 'test',
      startedAt: new Date(),
      completedAt: new Date()
    };

    const success = await logAudit(record);

    expect(success).toBe(false);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Failed to write audit log',
      expect.objectContaining({ error: 'violates foreign key constraint' })
    );

    loggerSpy.mockRestore();
  });
});

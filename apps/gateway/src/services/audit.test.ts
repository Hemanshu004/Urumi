import { describe, it, expect, vi } from 'vitest';
import { logAudit } from './audit.js';
import { db } from '../db/index.js';

vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([])
  }
}));

describe('Audit Logging', () => {
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

    await logAudit(record);

    expect(db.insert).toHaveBeenCalled();
    const insertMock = (db.insert as any)().values;
    const insertedValues = insertMock.mock.calls[0][0];

    expect(insertedValues.request_params.normal_arg).toBe('hello');
    expect(insertedValues.request_params.password).toBe('[REDACTED]');
    expect(insertedValues.request_params.api_key).toBe('[REDACTED]');
    expect(insertedValues.request_params.nested.secret_token).toBe('[REDACTED]');
    expect(insertedValues.request_params.nested.public_info).toBe('public');
    
    // original record should not be mutated
    expect(record.requestParams.password).toBe('supersecretpassword');
  });
});

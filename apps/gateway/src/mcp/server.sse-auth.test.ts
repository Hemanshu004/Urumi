import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import { AddressInfo } from 'net';
import { setupMcpServer } from './server.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

// --- Database & Auth Mocks ------------------------------------------------

const USER_A_KEY = { id: 10, user_id: 1, key_hash: '$2b$10$hashA', key_prefix: 'uka_' };
const USER_B_KEY = { id: 20, user_id: 2, key_hash: '$2b$10$hashB', key_prefix: 'ukb_' };
const USER_A_KEY_2 = { id: 11, user_id: 1, key_hash: '$2b$10$hashA2', key_prefix: 'uka2' };

const TOKEN_A = 'uka_secret_token_user_a';
const TOKEN_B = 'ukb_secret_token_user_b';
const TOKEN_A2 = 'uka2_secret_token_user_a_key2';
const INVALID_TOKEN = 'xxx_invalid_token';
const REVOKED_TOKEN = 'ukr_revoked_token';

let activeDbKeys = [USER_A_KEY, USER_B_KEY, USER_A_KEY_2];

vi.mock('../db/schema.js', () => ({
  api_keys: { id: 'api_keys.id', user_id: 'api_keys.user_id', key_hash: 'api_keys.key_hash', key_prefix: 'api_keys.key_prefix', revoked_at: 'api_keys.revoked_at' },
  users: { id: 'users.id', role: 'users.role' },
}));

vi.mock('drizzle-orm', () => ({
  isNull: vi.fn().mockReturnValue('isNull_placeholder'),
  eq: vi.fn().mockReturnValue('eq_placeholder'),
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => ({
        where: vi.fn().mockImplementation(() => {
          if (table?.id === 'api_keys.id' || table?.key_prefix === 'api_keys.key_prefix') {
            return Promise.resolve(activeDbKeys);
          }
          if (table?.role === 'users.role' || table?.id === 'users.id') {
            return Promise.resolve([{ role: 'member' }]);
          }
          return Promise.resolve([]);
        }),
      })),
    })),
  },
}));

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn().mockImplementation((token: string, hash: string) => {
      if (token === TOKEN_A && hash === USER_A_KEY.key_hash) return Promise.resolve(true);
      if (token === TOKEN_B && hash === USER_B_KEY.key_hash) return Promise.resolve(true);
      if (token === TOKEN_A2 && hash === USER_A_KEY_2.key_hash) return Promise.resolve(true);
      return Promise.resolve(false);
    }),
  },
  compare: vi.fn().mockImplementation((token: string, hash: string) => {
    if (token === TOKEN_A && hash === USER_A_KEY.key_hash) return Promise.resolve(true);
    if (token === TOKEN_B && hash === USER_B_KEY.key_hash) return Promise.resolve(true);
    if (token === TOKEN_A2 && hash === USER_A_KEY_2.key_hash) return Promise.resolve(true);
    return Promise.resolve(false);
  }),
}));

vi.mock('../services/audit.js', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/rbac.js', () => ({
  isToolAllowed: vi.fn().mockResolvedValue(true),
}));

vi.mock('./registry.js', () => ({
  registry: { getTool: vi.fn(), getAllTools: vi.fn().mockReturnValue([]) },
}));

vi.mock('./clientManager.js', () => ({
  clientManager: {
    getClient: vi.fn(),
    callToolWithTimeout: vi.fn(),
    markServerFailed: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// --- Test Helpers ---------------------------------------------------------

/**
 * Race a promise against a deterministic bounded timeout.
 * Clears the timer upon resolution to avoid hanging test runners.
 */
function withTimeout<T>(promise: Promise<T>, ms = 3000, errorMsg = 'Operation timed out'): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

// --- Test Suite -----------------------------------------------------------

describe('MCP SSE Session Ownership and Lifecycle', () => {
  let app: express.Application;
  let server: http.Server;
  let baseUrl: string;
  const activeSseRequests: http.ClientRequest[] = [];

  interface SseConnection {
    req: http.ClientRequest;
    res: http.IncomingMessage;
    sessionId: string;
    close: () => Promise<void>;
  }

  /**
   * Helper that opens an SSE session over HTTP GET, asserts the HTTP 200 / event-stream
   * response, extracts the sessionId from the `endpoint` SSE event, and keeps the
   * stream open until explicitly closed.
   */
  function openSseSession(token: string): Promise<SseConnection> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `${baseUrl}/mcp/sse`,
        { headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          if (res.statusCode !== 200) {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => reject(new Error(`SSE GET failed with ${res.statusCode}: ${body}`)));
            return;
          }

          let buffer = '';
          const onData = (chunk: Buffer) => {
            buffer += chunk.toString();
            const match = buffer.match(/sessionId=([a-zA-Z0-9_-]+)/);
            if (match) {
              res.removeListener('data', onData);
              const conn: SseConnection = {
                req,
                res,
                sessionId: match[1],
                close: () => new Promise<void>((resClose) => {
                  res.on('close', () => resClose());
                  req.destroy();
                }),
              };
              activeSseRequests.push(req);
              resolve(conn);
            }
          };
          res.on('data', onData);
          res.on('error', reject);
        }
      );
      req.on('error', reject);
    });
  }

  beforeEach(async () => {
    activeDbKeys = [USER_A_KEY, USER_B_KEY, USER_A_KEY_2];

    app = express();
    setupMcpServer(app);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Restore all spies to prevent cross-test contamination
    vi.restoreAllMocks();

    for (const req of activeSseRequests) {
      if (!req.destroyed) req.destroy();
    }
    activeSseRequests.length = 0;

    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // 1 & 2. Valid API key establishes an SSE session & extracts sessionId from endpoint event
  it('1 & 2: establishes an SSE session and extracts session ID from endpoint event', async () => {
    const conn = await openSseSession(TOKEN_A);

    expect(conn.res.statusCode).toBe(200);
    expect(conn.res.headers['content-type']).toContain('text/event-stream');
    expect(conn.sessionId).toBeTruthy();
    expect(typeof conn.sessionId).toBe('string');
  });

  // 3. The same API key successfully POSTs to its session
  it('3: allows the same API key to POST to its session', async () => {
    const conn = await openSseSession(TOKEN_A);

    const res = await request(server)
      .post(`/mcp/message?sessionId=${conn.sessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(202);
  });

  // 4. A different user's API key receives HTTP 403
  it('4: rejects a different user POSTing to the session with HTTP 403', async () => {
    const connA = await openSseSession(TOKEN_A);

    const res = await request(server)
      .post(`/mcp/message?sessionId=${connA.sessionId}`)
      .set('Authorization', `Bearer ${TOKEN_B}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Session ownership mismatch' });
  });

  // 5. The original user cannot POST to another user's session
  it('5: rejects user A POSTing to user B session with HTTP 403', async () => {
    const connB = await openSseSession(TOKEN_B);

    const res = await request(server)
      .post(`/mcp/message?sessionId=${connB.sessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Session ownership mismatch' });
  });

  // 6. A different API key belonging to the same user receives HTTP 403
  it('6: rejects a different API key of the same user with HTTP 403', async () => {
    // Created with User A Key 1 (TOKEN_A)
    const connA = await openSseSession(TOKEN_A);

    // Attempted with User A Key 2 (TOKEN_A2)
    const res = await request(server)
      .post(`/mcp/message?sessionId=${connA.sessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A2}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Session ownership mismatch' });
  });

  // 7. Unknown session returns HTTP 404
  it('7: returns HTTP 404 for an unknown session ID', async () => {
    const res = await request(server)
      .post('/mcp/message?sessionId=00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  // 8. Invalid API key returns HTTP 401
  it('8: returns HTTP 401 for an invalid API key', async () => {
    const res = await request(server)
      .post('/mcp/message?sessionId=any')
      .set('Authorization', `Bearer ${INVALID_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or revoked API key' });
  });

  // 9. Revoked API key returns HTTP 401
  it('9: returns HTTP 401 for a revoked API key', async () => {
    activeDbKeys = [];

    const res = await request(server)
      .post('/mcp/message?sessionId=any')
      .set('Authorization', `Bearer ${REVOKED_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or revoked API key' });
  });

  // 10. Missing authorization header returns HTTP 401
  it('10: returns HTTP 401 when Authorization header is missing', async () => {
    const res = await request(server)
      .post('/mcp/message?sessionId=any')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  // Validation: Missing or malformed sessionId returns HTTP 400
  it('validates sessionId: returns HTTP 400 for missing or malformed sessionId', async () => {
    // Missing query param
    const resMissing = await request(server)
      .post('/mcp/message')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
    expect(resMissing.status).toBe(400);
    expect(resMissing.body).toEqual({ error: 'Missing or malformed sessionId' });

    // Empty query param
    const resEmpty = await request(server)
      .post('/mcp/message?sessionId=')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body).toEqual({ error: 'Missing or malformed sessionId' });

    // Array query param (?sessionId=a&sessionId=b)
    const resArray = await request(server)
      .post('/mcp/message?sessionId=a&sessionId=b')
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
    expect(resArray.status).toBe(400);
    expect(resArray.body).toEqual({ error: 'Missing or malformed sessionId' });
  });

  // 11. Client disconnects during SSE initialization and no session remains registered
  it('11: client disconnects during SSE initialization and no session remains registered', async () => {
    let closeCompleted = false;
    let resolveCloseCompletion: () => void;
    const closeCompletionPromise = new Promise<void>((resolve) => {
      resolveCloseCompletion = resolve;
    });

    const origClose = Server.prototype.close;
    const closeSpy = vi.spyOn(Server.prototype, 'close').mockImplementation(async function (this: any) {
      const res = await origClose.call(this);
      closeCompleted = true;
      resolveCloseCompletion();
      return res;
    });

    let interceptedSessionId: string | undefined;
    const origConnect = Server.prototype.connect;
    const connectSpy = vi.spyOn(Server.prototype, 'connect').mockImplementation(async function (this: any, transport: any) {
      interceptedSessionId = transport.sessionId;
      // Abort client request deterministically while connect is executing
      await new Promise<void>((r) => {
        clientReq.on('close', r);
        clientReq.destroy();
      });
      return origConnect.call(this, transport);
    });

    const clientReq = http.get(
      `${baseUrl}/mcp/sse`,
      { headers: { Authorization: `Bearer ${TOKEN_A}` } }
    );
    activeSseRequests.push(clientReq);
    clientReq.on('error', () => {/* expected abort error */});

    // Wait deterministically with bounded timeout for cleanup completion
    await withTimeout(closeCompletionPromise, 3000, 'Cleanup did not complete in time on early disconnect');

    expect(closeSpy).toHaveBeenCalled();
    expect(closeCompleted).toBe(true);
    expect(interceptedSessionId).toBeDefined();

    // Observable behavior: POSTing to this session must return 404 (not registered)
    const res = await request(server)
      .post(`/mcp/message?sessionId=${interceptedSessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  // 12. Failed server connection initialization closes the server instance
  // 12. Failed server connection initialization returns HTTP 500
  // and closes the server instance.
  it('12: failed server connection initialization returns HTTP 500 and closes the server instance', async () => {
    let closeCompleted = false;
    let resolveCloseCompletion!: () => void;

    const closeCompletionPromise = new Promise<void>((resolve) => {
      resolveCloseCompletion = resolve;
    });

    const origClose = Server.prototype.close;

    const closeSpy = vi.spyOn(Server.prototype, 'close')
      .mockImplementation(async function (this: any) {
        const result = await origClose.call(this);
        closeCompleted = true;
        resolveCloseCompletion();
        return result;
      });

    let attemptedSessionId: string | undefined;

    const connectSpy = vi.spyOn(Server.prototype, 'connect')
      .mockImplementation(async function (this: any, transport: any) {
        attemptedSessionId = transport.sessionId;
        throw new Error('Connection initialization failed');
      });

    const clientReq = http.get(
      `${baseUrl}/mcp/sse`,
      {
        headers: { Authorization: `Bearer ${TOKEN_A}` },
      }
    );

    activeSseRequests.push(clientReq);

    const initialResponsePromise = new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        clientReq.once('response', resolve);
        clientReq.once('error', reject);
      }
    );

    const initialResponse = await withTimeout(
      initialResponsePromise,
      3000,
      'Initial SSE response was not received'
    );

    expect(initialResponse.statusCode).toBe(500);

    // Consume the response body and allow the connection to close.
    initialResponse.resume();

    // Wait for server cleanup to complete.
    await withTimeout(
      closeCompletionPromise,
      3000,
      'Cleanup did not complete in time on init failure'
    );

    expect(connectSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
    expect(closeCompleted).toBe(true);
    expect(attemptedSessionId).toBeDefined();

    // Failed sessions must not remain registered.
    const res = await request(server)
      .post(`/mcp/message?sessionId=${attemptedSessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'ping',
        id: 1,
      }));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  // 13. Normal disconnect cleans up the session and closes the server instance
  it('13: normal disconnect cleans up the session and closes the server instance', async () => {
    let closeCompleted = false;
    let resolveCloseCompletion: () => void;
    const closeCompletionPromise = new Promise<void>((resolve) => {
      resolveCloseCompletion = resolve;
    });

    const origClose = Server.prototype.close;
    const closeSpy = vi.spyOn(Server.prototype, 'close').mockImplementation(async function (this: any) {
      const res = await origClose.call(this);
      closeCompleted = true;
      resolveCloseCompletion();
      return res;
    });

    const conn = await openSseSession(TOKEN_A);
    const sessionId = conn.sessionId;

    // Verify session is active and functional
    const postRes1 = await request(server)
      .post(`/mcp/message?sessionId=${sessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));
    expect(postRes1.status).toBe(202);

    // Disconnect the client normally
    await conn.close();

    // Wait deterministically with bounded timeout for cleanup completion
    await withTimeout(closeCompletionPromise, 3000, 'Cleanup did not complete in time on normal disconnect');

    expect(closeSpy).toHaveBeenCalled();
    expect(closeCompleted).toBe(true);

    // Observable behavior: subsequent POST to the disconnected session returns 404
    const postRes2 = await request(server)
      .post(`/mcp/message?sessionId=${sessionId}`)
      .set('Authorization', `Bearer ${TOKEN_A}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

    expect(postRes2.status).toBe(404);
    expect(postRes2.body).toEqual({ error: 'Session not found' });
  });

  // 14. Delayed connection initialization: SSEServerTransport.prototype.start()
  // in the SDK executes synchronously with no internal suspension points. This test
  // intercepts start() to simulate delayed initialization where the connection startup
  // takes longer than the gateway's 5000ms cleanup timeout, verifying that the late-settling
  // connection is cleaned up without duplicate server closes, session leaks, or unhandled rejections.
  it('14: handles delayed initialization pending beyond 5000ms cleanup timeout without registering or leaking', async () => {
    let closeCallCount = 0;
    const origClose = Server.prototype.close;
    vi.spyOn(Server.prototype, 'close').mockImplementation(async function (this: any) {
      closeCallCount++;
      return origClose.call(this);
    });

    let transportCloseCount = 0;
    let resolveLateCleanup!: () => void;
    const lateCleanupCompleted = new Promise<void>((resolve) => {
      resolveLateCleanup = resolve;
    });

    const origTransportClose = SSEServerTransport.prototype.close;
    vi.spyOn(SSEServerTransport.prototype, 'close').mockImplementation(async function (this: any) {
      transportCloseCount++;
      const result = await origTransportClose.call(this);
      if (transportCloseCount === 3) {
        setImmediate(() => resolveLateCleanup());
      }
      return result;
    });

    let resolveStart!: () => void;
    const deferredStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });

    let resolveStartInvoked!: () => void;
    const startInvokedPromise = new Promise<void>((resolve) => {
      resolveStartInvoked = resolve;
    });

    let capturedTransport: any;
    const origStart = SSEServerTransport.prototype.start;
    // Intercept SSEServerTransport.start() to hold connection pending beyond cleanup timeout
    vi.spyOn(SSEServerTransport.prototype, 'start').mockImplementation(async function (this: any) {
      capturedTransport = this;
      resolveStartInvoked();
      // Delay connection initialization until explicitly resumed
      await deferredStart;
      return origStart.call(this);
    });

    // Use fake timers specifically for setTimeout / clearTimeout to advance the 5000ms race deterministically
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      const clientReq = http.get(
        `${baseUrl}/mcp/sse`,
        { headers: { Authorization: `Bearer ${TOKEN_A}` } }
      );
      activeSseRequests.push(clientReq);
      clientReq.on('error', () => {/* expected abort error */});

      // Deterministically wait for transport.start() to be entered
      await withTimeout(startInvokedPromise, 3000, 'SSEServerTransport.start() was not invoked');
      expect(capturedTransport).toBeDefined();
      expect(capturedTransport._sseResponse).toBeUndefined();

      // Client disconnects while initialization is paused
      // Deterministically wait for the server's response stream to close
      await new Promise<void>((r) => {
        capturedTransport.res.on('close', r);
        clientReq.destroy();
      });

      // Advance timers by 5000ms so Promise.race in cleanup() times out deterministically
      await vi.advanceTimersByTimeAsync(5000);

      // Verify initial cleanup occurred during the timeout:
      // serverInstance.close() called once (which internally calls transport.close() call #1),
      // and cleanup() finally block calls transport.close() (call #2).
      expect(closeCallCount).toBe(1);
      expect(transportCloseCount).toBe(2);

      // Resume the real transport initialization
      resolveStart();

      // Explicit Promise barrier confirming that late connection and transport cleanup completed
      await lateCleanupCompleted;

      // Verify transport.close() was called exactly 3 times across the lifecycle:
      // 1: from serverInstance.close()
      // 2: from cleanup() finally block
      // 3: from late post-connect cleanup check
      expect(transportCloseCount).toBe(3);

      // Verify the late-settling transport is closed again and _sseResponse remains undefined
      expect(capturedTransport._sseResponse).toBeUndefined();

      // Verify the SSE response is not left open
      expect(capturedTransport.res.writableEnded).toBe(true);

      // Verify cleanup does not run twice for the server instance
      expect(closeCallCount).toBe(1);

      // Verify no session is registered (observable behavior: POST returns 404)
      const postRes = await request(server)
        .post(`/mcp/message?sessionId=${capturedTransport.sessionId}`)
        .set('Authorization', `Bearer ${TOKEN_A}`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }));

      expect(postRes.status).toBe(404);
      expect(postRes.body).toEqual({ error: 'Session not found' });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

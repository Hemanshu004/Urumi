import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { db } from "../db/index.js";
import { upstream_servers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { registry } from "./registry.js";
import { decryptCredential } from "../utils/crypto.js";
import { validateUrlForSSRF } from "../utils/ssrf.js";
import { logger } from "../utils/logger.js";

interface ManagedClient {
  id: number;
  name: string;
  url: string;
  client: Client;
  status: "connected" | "disconnected" | "error";
  timeout_ms: number;
}

class ClientManager {
  private clients = new Map<string, ManagedClient>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isChecking = false;
  private pendingChecks = new Set<string>();
  private reconnectState = new Map<string, { attempts: number, nextAttempt: number }>();

  public async initializeAll() {
    const servers = await db.select().from(upstream_servers).where(eq(upstream_servers.enabled, true));
    for (const s of servers) {
      this.connectServer(s).catch(err => logger.error("Failed initial connect", { error: err.message, server: s.name }));
    }
  }

  public startHealthCheckLoop(intervalMs = 30000) {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(() => this.runHealthChecks(), intervalMs);
  }

  public stopHealthCheckLoop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async runHealthChecks() {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const servers = await db.select().from(upstream_servers).where(eq(upstream_servers.enabled, true));
      const now = Date.now();

      for (const server of servers) {
        if (this.pendingChecks.has(server.name)) continue;
        
        const managed = this.clients.get(server.name);
        
        if (managed && managed.status === "connected") {
          this.pendingChecks.add(server.name);
          this.checkServerHealth(server.name).finally(() => {
            this.pendingChecks.delete(server.name);
          });
        } else {
          const state = this.reconnectState.get(server.name);
          if (state && now >= state.nextAttempt) {
             this.pendingChecks.add(server.name);
             this.reconnectServer(server.name).finally(() => {
               this.pendingChecks.delete(server.name);
             });
          }
        }
      }
    } finally {
      this.isChecking = false;
    }
  }

  private async checkServerHealth(serverName: string) {
    const managed = this.clients.get(serverName);
    if (!managed || managed.status !== "connected") return;

    try {
      await this.listToolsWithTimeout(managed.client, 10000);
      
      await db.update(upstream_servers)
        .set({ status: "connected", status_message: "OK", last_health_check: new Date() })
        .where(eq(upstream_servers.id, managed.id));
    } catch (err: any) {
      logger.error("Health check failed", { server: serverName, error: err.message });
      await this.markServerFailed(serverName, err.message);
    }
  }

  private async reconnectServer(serverName: string) {
    const [server] = await db.select().from(upstream_servers).where(eq(upstream_servers.name, serverName)).limit(1);
    if (!server || !server.enabled) {
      this.reconnectState.delete(serverName);
      return;
    }
    logger.info("Attempting to reconnect", { server: serverName });
    await this.connectServer(server);
  }

  private async listToolsWithTimeout(client: Client, timeoutMs: number): Promise<any> {
    const callPromise = client.listTools();
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;
      callPromise.then(
        (res) => { clearTimeout(timer); resolve(res); },
        (err) => { clearTimeout(timer); reject(err); }
      );
      timer = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    });
  }

  public async connectServer(server: any) {
    logger.info("Connecting to upstream server", { server: server.name, url: server.url });
    
    try {
      await validateUrlForSSRF(server.url);
    } catch (err: any) {
      logger.error("SSRF validation failed", { server: server.name, error: err.message });
      this.handleConnectionFailure(server, err.message);
      return;
    }
    
    let options: any = {};
    if (server.credential_encrypted) {
      try {
        const decrypted = decryptCredential(server.credential_encrypted);
        const headers = { "Authorization": `Bearer ${decrypted}` };
        
        options = {
          _fetch: (input: any, init?: any) => {
            return fetch(input, {
              ...init,
              headers: { ...init?.headers, ...headers }
            });
          }
        };
      } catch (err: any) {
        logger.error("Failed to decrypt credentials", { server: server.name, error: err.message });
      }
    }

    const transport = new StreamableHTTPClientTransport(new URL(server.url), options);
    const client = new Client({ name: "urumi-gateway", version: "1.0.0" }, { capabilities: {} });

    try {
      await client.connect(transport);
      
      const managed: ManagedClient = {
        id: server.id,
        name: server.name,
        url: server.url,
        client,
        status: "connected",
        timeout_ms: server.timeout_ms || 30000
      };
      
      this.clients.set(server.name, managed);
      await this.syncTools(server.name);
      
      await db.update(upstream_servers)
        .set({ status: "connected", status_message: "OK", last_health_check: new Date() })
        .where(eq(upstream_servers.id, server.id));
        
      logger.info("Successfully connected", { server: server.name });
      this.reconnectState.delete(server.name);
    } catch (err: any) {
      logger.error("Failed to connect", { server: server.name, error: err.message });
      this.disconnectClient(server.name);
      this.handleConnectionFailure(server, err.message);
    }
  }

  private handleConnectionFailure(server: any, errorMessage: string) {
    db.update(upstream_servers)
      .set({ status: "error", status_message: errorMessage, last_health_check: new Date() })
      .where(eq(upstream_servers.id, server.id))
      .catch(e => logger.error("Failed to update status", { server: server.name, error: e.message }));
      
    const state = this.reconnectState.get(server.name) || { attempts: 0, nextAttempt: 0 };
    const attempts = state.attempts + 1;
    const delay = Math.min(60000, 5000 * Math.pow(2, attempts - 1));
    const jitter = delay * 0.2 * Math.random();
    this.reconnectState.set(server.name, { attempts, nextAttempt: Date.now() + delay + jitter });
  }

  public async syncTools(serverName: string) {
    const managed = this.clients.get(serverName);
    if (!managed || managed.status !== "connected") return;

    const response = await this.listToolsWithTimeout(managed.client, 10000);
    registry.clearServerTools(serverName);
    
    for (const tool of response.tools) {
      registry.registerTool({
        namespacedName: `${serverName}__${tool.name}`,
        serverName: serverName,
        serverId: managed.id,
        originalToolName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        available: true
      });
    }
    logger.info("Synced tools", { server: serverName, count: response.tools.length });
  }

  private disconnectClient(serverName: string) {
    const managed = this.clients.get(serverName);
    if (!managed) return;
    try {
      managed.client.close();
    } catch (e) {}
    this.clients.delete(serverName);
    registry.clearServerTools(serverName);
  }

  public async markServerFailed(serverName: string, errorMessage: string) {
    const managed = this.clients.get(serverName);
    if (!managed) return;
    
    this.disconnectClient(serverName);
    this.handleConnectionFailure({ id: managed.id, name: serverName }, errorMessage);
  }

  public async disconnectServer(serverName: string) {
    this.disconnectClient(serverName);
    this.reconnectState.delete(serverName);
    
    const [server] = await db.select().from(upstream_servers).where(eq(upstream_servers.name, serverName)).limit(1);
    if (server) {
      await db.update(upstream_servers)
        .set({ status: "disconnected", status_message: "Disabled by user", last_health_check: new Date() })
        .where(eq(upstream_servers.id, server.id));
    }
    logger.info("Disconnected upstream server", { server: serverName });
  }

  public getClient(serverName: string): ManagedClient | undefined {
    return this.clients.get(serverName);
  }

  public async callToolWithTimeout(serverName: string, toolName: string, args: any): Promise<any> {
    const managed = this.clients.get(serverName);
    if (!managed || managed.status !== "connected") {
      throw new Error(`Upstream server ${serverName} is disconnected`);
    }

    const timeoutMs = Math.min(Math.max(managed.timeout_ms || 30000, 1000), 300000);

    const callPromise = managed.client.callTool({
      name: toolName,
      arguments: args
    });

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout;
      
      callPromise.then(
        (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
      
      timer = setTimeout(() => {
        reject(new Error("Timeout"));
      }, timeoutMs);
    });
  }
}

export const clientManager = new ClientManager();

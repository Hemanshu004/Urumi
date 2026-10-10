import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { db } from "../db/index.js";
import { upstream_servers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { registry } from "./registry.js";
import { decryptCredential } from "../utils/crypto.js";
import { validateUrlForSSRF } from "../utils/ssrf.js";

interface ManagedClient {
  id: number;
  name: string;
  url: string;
  client: Client;
  status: "connected" | "disconnected" | "error";
}

class ClientManager {
  private clients = new Map<string, ManagedClient>();

  public async initializeAll() {
    const servers = await db.select().from(upstream_servers).where(eq(upstream_servers.enabled, true));
    for (const s of servers) {
      this.connectServer(s);
    }
  }

  public async connectServer(server: any) {
    console.log(`Connecting to upstream server: ${server.name} at ${server.url}`);
    
    try {
      await validateUrlForSSRF(server.url);
    } catch (err: any) {
      console.error(`SSRF validation failed for ${server.name}:`, err.message);
      await db.update(upstream_servers)
        .set({ status: "error", status_message: err.message, last_health_check: new Date() })
        .where(eq(upstream_servers.id, server.id));
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
        console.error(`Failed to decrypt credentials for ${server.name}:`, err.message);
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
        status: "connected"
      };
      
      this.clients.set(server.name, managed);
      await this.syncTools(server.name);
      
      await db.update(upstream_servers)
        .set({ status: "connected", status_message: "OK", last_health_check: new Date() })
        .where(eq(upstream_servers.id, server.id));
        
      console.log(`Successfully connected to ${server.name}`);
    } catch (err: any) {
      console.error(`Failed to connect to ${server.name}:`, err.message);
      await db.update(upstream_servers)
        .set({ status: "error", status_message: err.message, last_health_check: new Date() })
        .where(eq(upstream_servers.id, server.id));
    }
  }

  public async syncTools(serverName: string) {
    const managed = this.clients.get(serverName);
    if (!managed || managed.status !== "connected") return;

    try {
      const response = await managed.client.listTools();
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
      console.log(`Synced ${response.tools.length} tools from ${serverName}`);
    } catch (err: any) {
      console.error(`Failed to sync tools from ${serverName}:`, err.message);
    }
  }

  public async markServerFailed(serverName: string, errorMessage: string) {
    const managed = this.clients.get(serverName);
    if (!managed) return;
    managed.status = "error";
    try {
      await db.update(upstream_servers)
        .set({ status: "error", status_message: errorMessage, last_health_check: new Date() })
        .where(eq(upstream_servers.id, managed.id));
    } catch (e) {
      console.error(`Failed to update status for ${serverName}:`, e);
    }
  }

  public async disconnectServer(serverName: string) {
    const managed = this.clients.get(serverName);
    if (!managed) return;
    try {
      await managed.client.close();
    } catch (err) {
      // ignore
    }
    this.clients.delete(serverName);
    registry.clearServerTools(serverName);
    console.log(`Disconnected upstream server: ${serverName}`);
  }

  public getClient(serverName: string): ManagedClient | undefined {
    return this.clients.get(serverName);
  }
}

export const clientManager = new ClientManager();

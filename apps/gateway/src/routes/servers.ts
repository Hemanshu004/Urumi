import { Router } from "express";
import { db } from "../db/index.js";
import { upstream_servers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { clientManager } from "../mcp/clientManager.js";
import { registry } from "../mcp/registry.js";
import { validateUrlForSSRF } from "../utils/ssrf.js";
import { encryptCredential } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";
import { z } from "zod";

export const serversRouter = Router();

serversRouter.use(requireAuth);
serversRouter.use(requireAdmin);

const createServerSchema = z.object({
  name: z.string().min(1).max(50),
  url: z.string().url(),
  timeout_ms: z.number().optional(),
  credential: z.string().optional()
});

serversRouter.get("/", async (req, res) => {
  const servers = await db.select({
    id: upstream_servers.id,
    name: upstream_servers.name,
    url: upstream_servers.url,
    builtin: upstream_servers.builtin,
    enabled: upstream_servers.enabled,
    status: upstream_servers.status,
    status_message: upstream_servers.status_message,
    last_health_check: upstream_servers.last_health_check,
    timeout_ms: upstream_servers.timeout_ms,
  }).from(upstream_servers);
  
  const allTools = registry.getAllTools();
  const enriched = servers.map(s => {
    return { ...s, tools: allTools.filter(t => t.serverName === s.name) };
  });

  res.json({ servers: enriched });
});

serversRouter.post("/", async (req, res) => {
  try {
    const { name, url, timeout_ms, credential } = createServerSchema.parse(req.body);
    
    await validateUrlForSSRF(url);
    
    let encryptedCred: string | null = null;
    if (credential) {
      encryptedCred = encryptCredential(credential);
    }

    const [server] = await db.insert(upstream_servers).values({
      name,
      url,
      credential_encrypted: encryptedCred,
      timeout_ms: timeout_ms || 30000,
      enabled: true,
      builtin: false
    }).returning();
    
    clientManager.connectServer(server).catch(err => logger.error("Failed to connect new server", { error: err.message, server: server.name }));

    res.json({ server });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    if (err.message && err.message.startsWith("SSRF Prevention")) {
      return res.status(400).json({ error: err.message });
    }
    logger.error("Error creating server", { error: err.message });
    res.status(500).json({ error: err.message || "Failed to add server" });
  }
});

serversRouter.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  
  const [server] = await db.select().from(upstream_servers).where(eq(upstream_servers.id, id)).limit(1);
  if (!server) return res.status(404).json({ error: "Server not found" });
  
  res.json({ server });
});

const patchSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  url: z.string().url().optional(),
  enabled: z.boolean().optional(),
  timeout_ms: z.number().optional(),
  credential: z.string().optional()
});

serversRouter.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  
  try {
    const updates = patchSchema.parse(req.body);
    if (Object.keys(updates).length > 0) {
      if (updates.url) await validateUrlForSSRF(updates.url);
      
      const [oldServer] = await db.select().from(upstream_servers).where(eq(upstream_servers.id, id));
      if (!oldServer) return res.status(404).json({ error: "Server not found" });

      const dbUpdates: any = { ...updates };
      delete dbUpdates.credential;
      if (updates.credential !== undefined) {
         if (updates.credential === "") {
             dbUpdates.credential_encrypted = null;
         } else {
             dbUpdates.credential_encrypted = encryptCredential(updates.credential);
         }
      }
      
      const [updated] = await db.update(upstream_servers)
        .set(dbUpdates)
        .where(eq(upstream_servers.id, id))
        .returning();
        
      if (updated) {
        if (updates.enabled === false) {
          await clientManager.disconnectServer(oldServer.name);
          registry.clearServerTools(oldServer.name);
        } else if (updates.enabled === true || updates.url || updates.credential !== undefined || updates.timeout_ms || updates.name) {
          await clientManager.disconnectServer(oldServer.name);
          registry.clearServerTools(oldServer.name);
          if (updated.enabled) {
             clientManager.connectServer(updated).catch(err => logger.error("Failed to connect updated server", { error: err.message, server: updated.name }));
          }
        }
      }
    }
    res.json({ message: "Updated successfully" });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    if (err.message && err.message.startsWith("SSRF Prevention")) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

serversRouter.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  
  const [server] = await db.select().from(upstream_servers).where(eq(upstream_servers.id, id));
  if (server) {
    await clientManager.disconnectServer(server.name);
    await db.delete(upstream_servers).where(eq(upstream_servers.id, id));
  }
  res.json({ message: "Deleted successfully" });
});

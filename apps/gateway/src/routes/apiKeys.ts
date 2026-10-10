import { Router } from "express";
import { db } from "../db/index.js";
import { api_keys, users } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { requireAuth } from "../middlewares/auth.js";

export const apiKeysRouter = Router();

apiKeysRouter.use(requireAuth);

apiKeysRouter.get("/", async (req, res) => {
  const user = (req as any).user;
  
  let condition = isNull(api_keys.revoked_at);
  if (user.role !== "admin") {
    condition = and(condition, eq(api_keys.user_id, user.id))!;
  }
  
  const keys = await db.select({
    id: api_keys.id,
    label: api_keys.label,
    key_prefix: api_keys.key_prefix,
    created_at: api_keys.created_at,
    last_used_at: api_keys.last_used_at,
    user_id: api_keys.user_id,
    user_email: users.email,
  })
  .from(api_keys)
  .leftJoin(users, eq(api_keys.user_id, users.id))
  .where(condition);
  
  res.json({ keys });
});

apiKeysRouter.post("/", async (req, res) => {
  const user = (req as any).user;
  const { label } = req.body;
  
  const rawKey = "urumi_" + crypto.randomBytes(32).toString("hex");
  const prefix = rawKey.substring(0, 10);
  const hash = await bcrypt.hash(rawKey, 10);
  
  const [newKey] = await db.insert(api_keys).values({
    user_id: user.id,
    key_hash: hash,
    key_prefix: prefix,
    label: label || "New API Key"
  }).returning({ id: api_keys.id });
  
  res.json({
    id: newKey.id,
    key: rawKey,
    message: "Store this key safely, it will not be shown again."
  });
});

import { logAudit } from "../services/audit.js";

apiKeysRouter.delete("/:id", async (req, res) => {
  const user = (req as any).user;
  const keyId = parseInt(req.params.id, 10);
  
  if (isNaN(keyId)) return res.status(400).json({ error: "Invalid ID" });
  
  let condition = eq(api_keys.id, keyId);
  if (user.role !== "admin") {
    condition = and(condition, eq(api_keys.user_id, user.id))!;
  }
  
  const [result] = await db.update(api_keys)
    .set({ revoked_at: new Date() })
    .where(condition)
    .returning();
    
  if (!result) return res.status(404).json({ error: "Key not found or unauthorized" });
  
  await logAudit({
    userId: user.id,
    namespacedTool: "system__revoke_key",
    toolName: "revoke_key",
    requestParams: { targetKeyId: keyId, targetUserId: result.user_id },
    outcome: "success",
    durationMs: 0,
    source: "dashboard",
    startedAt: new Date(),
    completedAt: new Date()
  });
    
  res.json({ message: "Key revoked" });
});

import { Router } from "express";
import { db } from "../db/index.js";
import { api_keys } from "../db/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { requireAuth } from "../middlewares/auth.js";

export const apiKeysRouter = Router();

apiKeysRouter.use(requireAuth);

apiKeysRouter.get("/", async (req, res) => {
  const userId = (req as any).user.id;
  const keys = await db.select({
    id: api_keys.id,
    label: api_keys.label,
    key_prefix: api_keys.key_prefix,
    created_at: api_keys.created_at,
    last_used_at: api_keys.last_used_at,
  }).from(api_keys).where(and(eq(api_keys.user_id, userId), isNull(api_keys.revoked_at)));
  
  res.json({ keys });
});

apiKeysRouter.post("/", async (req, res) => {
  const userId = (req as any).user.id;
  const { label } = req.body;
  
  const rawKey = "urumi_" + crypto.randomBytes(32).toString("hex");
  const prefix = rawKey.substring(0, 10);
  const hash = await bcrypt.hash(rawKey, 10);
  
  const [newKey] = await db.insert(api_keys).values({
    user_id: userId,
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

apiKeysRouter.delete("/:id", async (req, res) => {
  const userId = (req as any).user.id;
  const keyId = parseInt(req.params.id, 10);
  
  if (isNaN(keyId)) return res.status(400).json({ error: "Invalid ID" });
  
  const result = await db.update(api_keys)
    .set({ revoked_at: new Date() })
    .where(and(eq(api_keys.id, keyId), eq(api_keys.user_id, userId)));
    
  res.json({ message: "Key revoked" });
});

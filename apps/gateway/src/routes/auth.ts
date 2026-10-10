import { Router } from "express";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import * as jose from "jose";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  const token = await new jose.SignJWT({ id: user.id, role: user.role, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);

  res.cookie("token", token, { httpOnly: true, sameSite: "strict" });
  res.json({ message: "Logged in" });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = (req as any).user;
  res.json({ user });
});

authRouter.get("/users", requireAuth, requireAdmin, async (req, res) => {
  const allUsers = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, created_at: users.created_at }).from(users);
  res.json({ users: allUsers });
});

import { z } from "zod";
import { logAudit } from "../services/audit.js";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
  role: z.enum(["admin", "member"])
});

authRouter.post("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name, password, role } = createUserSchema.parse(req.body);
    
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return res.status(400).json({ error: "User with this email already exists" });
    }
    
    const hash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({
      email,
      name: name || null,
      password_hash: hash,
      role
    }).returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    
    await logAudit({
      userId: (req as any).user.id,
      namespacedTool: "system__create_user",
      toolName: "create_user",
      requestParams: { targetEmail: email, role },
      outcome: "success",
      durationMs: 0,
      source: "dashboard",
      startedAt: new Date(),
      completedAt: new Date()
    });

    res.json({ user });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
    res.status(500).json({ error: "Failed to create user" });
  }
});

const updateUserSchema = z.object({
  role: z.enum(["admin", "member"]).optional()
});

authRouter.patch("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  
  try {
    const { role } = updateUserSchema.parse(req.body);
    if (role) {
      const [updated] = await db.update(users)
        .set({ role })
        .where(eq(users.id, id))
        .returning({ id: users.id, role: users.role });
        
      if (!updated) return res.status(404).json({ error: "User not found" });
      
      await logAudit({
        userId: (req as any).user.id,
        namespacedTool: "system__update_user_role",
        toolName: "update_user_role",
        requestParams: { targetUserId: id, role },
        outcome: "success",
        durationMs: 0,
        source: "dashboard",
        startedAt: new Date(),
        completedAt: new Date()
      });
    }
    res.json({ message: "Updated successfully" });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Validation failed", details: err.errors });
    res.status(500).json({ error: "Failed to update user" });
  }
});

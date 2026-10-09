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

  const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default_secret");
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

import { Request, Response, NextFunction } from "express";
import * as jose from "jose";

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jose.jwtVerify(token, secret);
    
    // Always revalidate role from DB to ensure immediate revocation/role changes
    const { db } = await import("../db/index.js");
    const { users } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [dbUser] = await db.select({ role: users.role }).from(users).where(eq(users.id, payload.id as number));
    
    if (!dbUser) {
      return res.status(401).json({ error: "User no longer exists" });
    }
    
    payload.role = dbUser.role;
    (req as any).user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admins only" });
  }
  next();
};

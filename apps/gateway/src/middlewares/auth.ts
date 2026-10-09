import { Request, Response, NextFunction } from "express";
import * as jose from "jose";

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || "default_secret");
    const { payload } = await jose.jwtVerify(token, secret);
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

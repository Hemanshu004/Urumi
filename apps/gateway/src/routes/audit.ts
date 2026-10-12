import { Router } from "express";
import { db } from "../db/index.js";
import { audit_logs } from "../db/schema.js";
import { requireAuth } from "../middlewares/auth.js";
import { desc, eq } from "drizzle-orm";
import { asyncHandler } from "../utils/asyncHandler.js";

export const auditRouter = Router();

auditRouter.use(requireAuth);

auditRouter.get("/", asyncHandler(async (req, res) => {
  const user = (req as any).user;
  let logs;
  
  if (user.role === "admin") {
    logs = await db.select().from(audit_logs).orderBy(desc(audit_logs.started_at)).limit(100);
  } else {
    logs = await db.select().from(audit_logs)
      .where(eq(audit_logs.user_id, user.id))
      .orderBy(desc(audit_logs.started_at))
      .limit(100);
  }
  
  res.json({ logs });
}));

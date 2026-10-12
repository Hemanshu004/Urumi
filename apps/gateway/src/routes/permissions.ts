import { Router } from "express";
import { requireAdmin, requireAuth } from "../middlewares/auth.js";
import { db } from "../db/index.js";
import { role_permissions } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

import { registry } from "../mcp/registry.js";
import { logAudit } from "../services/audit.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const permissionsRouter = Router();

permissionsRouter.use(requireAuth);
permissionsRouter.use(requireAdmin);

// Get permissions for a specific role (e.g. member)
permissionsRouter.get("/:role", asyncHandler(async (req, res, next) => {
  try {
    const { role } = req.params;
    const perms = await db.select().from(role_permissions).where(eq(role_permissions.role, role));
    
    res.json({
      role,
      permissions: perms.map(p => ({
        id: p.id,
        namespacedTool: p.namespaced_tool,
        createdAt: p.created_at
      }))
    });
  } catch (error: any) {
    logger.error("Error fetching permissions", { error: error.message, role: req.params.role });
    next(error);
  }
}));

// Grant permission
permissionsRouter.post("/:role/grant", asyncHandler(async (req: any, res, next) => {
  try {
    const { role } = req.params;
    const { namespacedTool } = req.body;

    if (!namespacedTool) {
      return res.status(400).json({ error: "namespacedTool is required" });
    }

    // Validate that the tool actually exists in the registry
    const tool = registry.getTool(namespacedTool);
    if (!tool) {
      return res.status(404).json({ error: `Tool ${namespacedTool} is unknown or unavailable. If the upstream server is disconnected, you must connect it first before granting permissions.` });
    }

    // Check if it already exists
    const existing = await db
      .select()
      .from(role_permissions)
      .where(
        and(
          eq(role_permissions.role, role),
          eq(role_permissions.namespaced_tool, namespacedTool)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(role_permissions).values({
        role,
        namespaced_tool: namespacedTool
      });
      
      await logAudit({
        userId: req.user?.id,
        serverId: tool.serverId,
        namespacedTool: namespacedTool,
        toolName: tool.originalToolName,
        requestParams: { action: "grant", targetRole: role },
        outcome: "success",
        durationMs: 0,
        source: "admin-api",
        startedAt: new Date(),
        completedAt: new Date()
      });
    }

    res.json({ success: true, message: `Granted ${namespacedTool} to ${role}` });
  } catch (error: any) {
    logger.error("Error granting permission", { error: error.message, role: req.params.role, namespacedTool: req.body.namespacedTool });
    next(error);
  }
}));

// Revoke permission
permissionsRouter.post("/:role/revoke", asyncHandler(async (req: any, res, next) => {
  try {
    const { role } = req.params;
    const { namespacedTool } = req.body;

    if (!namespacedTool) {
      return res.status(400).json({ error: "namespacedTool is required" });
    }

    const result = await db
      .delete(role_permissions)
      .where(
        and(
          eq(role_permissions.role, role),
          eq(role_permissions.namespaced_tool, namespacedTool)
        )
      )
      .returning();

    if (result.length > 0) {
      
      const tool = registry.getTool(namespacedTool);
      
      await logAudit({
        userId: req.user?.id,
        serverId: tool?.serverId ?? null,
        namespacedTool: namespacedTool,
        toolName: tool?.originalToolName || namespacedTool,
        requestParams: { action: "revoke", targetRole: role },
        outcome: "success",
        durationMs: 0,
        source: "admin-api",
        startedAt: new Date(),
        completedAt: new Date()
      });
    }

    res.json({ success: true, message: `Revoked ${namespacedTool} from ${role}` });
  } catch (error: any) {
    logger.error("Error revoking permission", { error: error.message, role: req.params.role, namespacedTool: req.body.namespacedTool });
    next(error);
  }
}));

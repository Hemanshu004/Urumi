import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { permissionsRouter } from "./permissions.js";
import { isToolAllowed } from "../utils/rbac.js";
import { registry } from "../mcp/registry.js";
import { db } from "../db/index.js";
import * as auditService from "../services/audit.js";

// Mock auth middlewares
vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 1, role: "admin" };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    next();
  },
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
  }
}));

vi.mock("../mcp/registry.js", () => ({
  registry: {
    getTool: vi.fn()
  }
}));

vi.mock("../services/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

const app = express();
app.use(express.json());
app.use("/permissions", permissionsRouter);

describe("Permissions Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should grant permission for an existing tool", async () => {
    (registry.getTool as any).mockReturnValue({
      serverId: 1,
      namespacedName: "test__tool",
      originalToolName: "tool"
    });

    const res = await request(app)
      .post("/permissions/member/grant")
      .send({ namespacedTool: "test__tool" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should deny grant if tool is unknown", async () => {
    (registry.getTool as any).mockReturnValue(undefined);

    const res = await request(app)
      .post("/permissions/member/grant")
      .send({ namespacedTool: "unknown__tool" });

    expect(res.status).toBe(404);
  });

  it("should revoke permission and update cache with registered serverId", async () => {
    (registry.getTool as any).mockReturnValue({
      serverId: 1,
      namespacedName: "test__tool_to_revoke",
      originalToolName: "tool_to_revoke"
    });
    
    const res = await request(app)
      .post("/permissions/member/revoke")
      .send({ namespacedTool: "test__tool_to_revoke" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auditService.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 1,
        namespacedTool: "test__tool_to_revoke",
        toolName: "tool_to_revoke",
        outcome: "success"
      })
    );
  });

  it("should revoke permission for an unregistered/unresolved tool with serverId: null instead of 0", async () => {
    (registry.getTool as any).mockReturnValue(undefined);

    const res = await request(app)
      .post("/permissions/member/revoke")
      .send({ namespacedTool: "orphan__deleted_tool" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(auditService.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: null,
        namespacedTool: "orphan__deleted_tool",
        toolName: "orphan__deleted_tool",
        outcome: "success"
      })
    );
    expect(auditService.logAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 0 })
    );
  });
});

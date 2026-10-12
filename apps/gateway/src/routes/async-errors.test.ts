import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { authRouter } from "./auth.js";
import { apiKeysRouter } from "./apiKeys.js";
import { serversRouter } from "./servers.js";
import { auditRouter } from "./audit.js";
import { permissionsRouter } from "./permissions.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";

// Mock DB
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
  }
}));

vi.mock("../mcp/clientManager.js", () => ({
  clientManager: {
    connectServer: vi.fn().mockResolvedValue(undefined),
    disconnectServer: vi.fn().mockResolvedValue(undefined),
  }
}));

vi.mock("../mcp/registry.js", () => ({
  registry: {
    clearServerTools: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([])
  }
}));

vi.mock("../services/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(true)
}));

let mockUser: { id: number; role: string; email: string } | null = {
  id: 1,
  role: "admin",
  email: "admin@test.com"
};

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!mockUser) return res.status(401).json({ error: "Unauthorized" });
    req.user = mockUser;
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!mockUser || mockUser.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: Admins only" });
    }
    req.user = mockUser;
    next();
  }
}));

describe("Async Error Handling in Express Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 1, role: "admin", email: "admin@test.com" };

    app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    app.use("/keys", apiKeysRouter);
    app.use("/servers", serversRouter);
    app.use("/audit", auditRouter);
    app.use("/permissions", permissionsRouter);

    // Mount centralized error handler
    app.use(errorHandler);
  });

  describe("asyncHandler utility", () => {
    it("catches rejected promise and forwards error to next(error) exactly once", async () => {
      const testError = new Error("Async failure");
      const nextMock = vi.fn();
      const handler = asyncHandler(async () => {
        throw testError;
      });

      await handler({} as any, {} as any, nextMock);
      // Wait for promise microtask queue
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(nextMock).toHaveBeenCalledTimes(1);
      expect(nextMock).toHaveBeenCalledWith(testError);
    });

    it("does not invoke next on successful handler execution", async () => {
      const nextMock = vi.fn();
      const handler = asyncHandler(async (_req: any, res: any) => {
        res.status(200);
      });

      await handler({} as any, { status: vi.fn() } as any, nextMock);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(nextMock).not.toHaveBeenCalled();
    });
  });

  describe("Audit route async error handling", () => {
    it("returns 500 when database query rejects on GET /audit without hanging", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).limit.mockRejectedValueOnce(new Error("FATAL: connection terminated unexpectedly"));

      const res = await request(app).get("/audit");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      // Ensure raw database error or credentials are NOT leaked in response
      expect(res.body.error).not.toContain("connection terminated");
      expect(loggerSpy).toHaveBeenCalledWith(
        "Unhandled error",
        expect.objectContaining({ error: "FATAL: connection terminated unexpectedly" })
      );
      loggerSpy.mockRestore();
    });

    it("succeeds normally when database query resolves on GET /audit", async () => {
      (db as any).limit.mockResolvedValueOnce([{ id: 1, namespaced_tool: "test" }]);

      const res = await request(app).get("/audit");

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
    });

    it("preserves 401 Unauthorized for unauthenticated requests", async () => {
      mockUser = null;
      const res = await request(app).get("/audit");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("API Keys route async error handling", () => {
    it("returns 500 when database query rejects on GET /keys", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).where.mockRejectedValueOnce(new Error("Database timeout"));

      const res = await request(app).get("/keys");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      expect(loggerSpy).toHaveBeenCalledWith(
        "Unhandled error",
        expect.objectContaining({ error: "Database timeout" })
      );
      loggerSpy.mockRestore();
    });

    it("returns 500 when database insert rejects on POST /keys", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).returning.mockRejectedValueOnce(new Error("Unique constraint violation"));

      const res = await request(app).post("/keys").send({ label: "Test Key" });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });

    it("returns 500 when database update rejects on DELETE /keys/:id", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).returning.mockRejectedValueOnce(new Error("Deadlock detected"));

      const res = await request(app).delete("/keys/5");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });
  });

  describe("Servers route async error handling", () => {
    it("returns 500 when database query rejects on GET /servers", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).from.mockRejectedValueOnce(new Error("Connection refused"));

      const res = await request(app).get("/servers");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });

    it("returns 500 when database query rejects on GET /servers/:id", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).limit.mockRejectedValueOnce(new Error("Query failed"));

      const res = await request(app).get("/servers/1");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });

    it("returns 500 when database query rejects on DELETE /servers/:id", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).where.mockRejectedValueOnce(new Error("Disk full"));

      const res = await request(app).delete("/servers/1");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });

    it("preserves 403 Forbidden for non-admin on DELETE /servers/:id", async () => {
      mockUser = { id: 2, role: "member", email: "member@test.com" };

      const res = await request(app).delete("/servers/1");

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Admins only");
    });
  });

  describe("Auth route async error handling", () => {
    it("returns 500 when database query rejects on POST /auth/login", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).limit.mockRejectedValueOnce(new Error("DB offline"));

      const res = await request(app).post("/auth/login").send({
        email: "admin@test.com",
        password: "password123"
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });

    it("returns 500 when database query rejects on GET /auth/users", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).from.mockRejectedValueOnce(new Error("DB offline"));

      const res = await request(app).get("/auth/users");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      loggerSpy.mockRestore();
    });
  });

  describe("Permissions route async error handling", () => {
    it("returns 500 and forwards error to centralized handler when DB rejects on GET /permissions/:role", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      (db as any).where.mockRejectedValueOnce(new Error("Role lookup failure"));

      const res = await request(app).get("/permissions/member");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal Server Error" });
      // Both the contextual logger and the centralized error logger should be called
      expect(loggerSpy).toHaveBeenCalledWith(
        "Error fetching permissions",
        expect.objectContaining({ error: "Role lookup failure" })
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        "Unhandled error",
        expect.objectContaining({ error: "Role lookup failure" })
      );
      loggerSpy.mockRestore();
    });
  });

  describe("errorHandler middleware unit behavior", () => {
    it("returns 500 JSON without exposing internal error or stack traces", () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      const req = { path: "/test" } as any;
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;
      const next = vi.fn();

      const secretErr = new Error("postgresql://user:super_secret_password@db:5432/db failed");
      errorHandler(secretErr, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
      expect(next).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith("Unhandled error", {
        error: secretErr.message,
        path: "/test"
      });
      loggerSpy.mockRestore();
    });

    it("delegates to next(err) if headers were already sent", () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as any);
      const req = { path: "/stream" } as any;
      const res = {
        headersSent: true,
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;
      const next = vi.fn();

      const streamErr = new Error("Stream aborted");
      errorHandler(streamErr, req, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(streamErr);
      loggerSpy.mockRestore();
    });
  });
});

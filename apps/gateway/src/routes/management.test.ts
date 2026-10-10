import { describe, it, expect, vi, beforeEach } from "vitest";
import { authRouter } from "./auth.js";
import { apiKeysRouter } from "./apiKeys.js";
import { serversRouter } from "./servers.js";
import { db } from "../db/index.js";
import { users, api_keys, upstream_servers, audit_logs } from "../db/schema.js";
import { clientManager } from "../mcp/clientManager.js";
import { registry } from "../mcp/registry.js";
import express from "express";
import request from "supertest";

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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

vi.mock("../utils/ssrf.js", () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(true)
}));

vi.mock("../services/audit.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../utils/crypto.js", () => ({
  encryptCredential: vi.fn().mockReturnValue("encrypted"),
  decryptCredential: vi.fn().mockReturnValue("decrypted")
}));

let mockUser = { id: 1, role: "admin", email: "admin@test.com" };

vi.mock("../middlewares/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = mockUser;
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (mockUser.role !== "admin") return res.status(403).json({ error: "Forbidden: Admins only" });
    req.user = mockUser;
    next();
  }
}));

describe("Management APIs", () => {
  let app: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    app.use("/auth", authRouter);
    app.use("/keys", apiKeysRouter);
    app.use("/servers", serversRouter);
  });

  const runAs = (user: any) => {
    mockUser = user;
  };

  describe("User Management", () => {
    it("Admin can create a user and assign role", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).limit.mockResolvedValueOnce([]); // No existing user
      (db as any).returning.mockResolvedValueOnce([{ id: 3, email: "new@test.com", role: "member" }]);

      const res = await request(app).post("/auth/users").send({
        email: "new@test.com",
        password: "password123",
        role: "member"
      });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("new@test.com");
    });

    it("Member cannot create a user", async () => {
      runAs({ id: 2, role: "member", email: "member@test.com" });
      const res = await request(app).post("/auth/users").send({
        email: "new@test.com",
        password: "password123",
        role: "member"
      });
      expect(res.status).toBe(403);
    });

    it("Prevents duplicate email", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).limit.mockResolvedValueOnce([{ id: 2, email: "new@test.com" }]);
      const res = await request(app).post("/auth/users").send({
        email: "new@test.com",
        password: "password123",
        role: "member"
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already exists");
    });
  });

  describe("API Keys", () => {
    it("Admin can revoke any key", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).returning.mockResolvedValueOnce([{ id: 10, user_id: 2 }]);
      const res = await request(app).delete("/keys/10");
      expect(res.status).toBe(200);
    });

    it("Member can revoke own key", async () => {
      runAs({ id: 2, role: "member", email: "member@test.com" });
      (db as any).returning.mockResolvedValueOnce([{ id: 20, user_id: 2 }]);
      const res = await request(app).delete("/keys/20");
      expect(res.status).toBe(200);
    });

    it("Member gets 404/unauthorized when revoking other's key", async () => {
      runAs({ id: 2, role: "member", email: "member@test.com" });
      (db as any).returning.mockResolvedValueOnce([]);
      const res = await request(app).delete("/keys/10");
      expect(res.status).toBe(404);
    });
  });

  describe("Servers", () => {
    it("Admin can update server credential and URL", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).where
        .mockResolvedValueOnce([{ id: 1, name: "old-server" }]);
        
      (db as any).returning.mockResolvedValueOnce([{ id: 1, name: "new-server", enabled: true, url: "http://new" }]);
        
      const res = await request(app).patch("/servers/1").send({
        name: "new-server",
        url: "http://new",
        credential: "new-secret"
      });
      
      expect(res.status).toBe(200);
      expect(clientManager.disconnectServer).toHaveBeenCalledWith("old-server");
      expect(registry.clearServerTools).toHaveBeenCalledWith("old-server");
      expect(clientManager.connectServer).toHaveBeenCalled();
    });

    it("Server credential preservation (omit)", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).where.mockResolvedValueOnce([{ id: 1, name: "old-server" }]);
      (db as any).returning.mockResolvedValueOnce([{ id: 1, name: "old-server", enabled: true }]);
      
      const res = await request(app).patch("/servers/1").send({
        timeout_ms: 10000
      });
      expect(res.status).toBe(200);
    });
    
    it("Server credential clearing (empty string)", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).where.mockResolvedValueOnce([{ id: 1, name: "old-server" }]);
      (db as any).returning.mockResolvedValueOnce([{ id: 1, name: "old-server", enabled: true }]);
      
      await request(app).patch("/servers/1").send({
        credential: ""
      });
    });

    it("Disabling server disconnects and clears tools", async () => {
      runAs({ id: 1, role: "admin", email: "admin@test.com" });
      (db as any).where.mockResolvedValueOnce([{ id: 1, name: "test-server" }]);
      (db as any).returning.mockResolvedValueOnce([{ id: 1, name: "test-server", enabled: false }]);
      
      await request(app).patch("/servers/1").send({
        enabled: false
      });
      
      expect(clientManager.disconnectServer).toHaveBeenCalledWith("test-server");
      expect(registry.clearServerTools).toHaveBeenCalledWith("test-server");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "./index.js";
import { upstream_servers, users, role_permissions } from "./schema.js";

vi.mock("./index.js", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
    }
  };
});

vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed_password")
  }
}));

describe("seedDatabase", () => {
  let selectMock: any;
  let insertMock: any;
  let insertedValues: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    insertedValues = [];

    // Helper for fluent insert().values()
    insertMock = vi.fn().mockImplementation((table: any) => ({
      values: vi.fn().mockImplementation((val: any) => {
        insertedValues.push({ table, val });
        return Promise.resolve([val]);
      })
    }));
    (db.insert as any) = insertMock;
  });

  it("seeds all three builtin MCP upstream servers when database is empty", async () => {
    // Mock select().from().where().limit() returning empty array
    (db.select as any) = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([])
        })
      })
    });

    process.env.ADMIN_PASSWORD = "admin_secret_123";
    process.env.MEMBER_PASSWORD = "member_secret_123";

    const { seedDatabase } = await import("./seed.js");
    await seedDatabase();

    // Verify upstream servers were inserted
    const serverInserts = insertedValues.filter(i => i.table === upstream_servers);
    expect(serverInserts).toHaveLength(3);

    const serverNames = serverInserts.map(i => i.val.name);
    expect(serverNames).toContain("woocommerce");
    expect(serverNames).toContain("github");
    expect(serverNames).toContain("weather");

    const woo = serverInserts.find(i => i.val.name === "woocommerce")?.val;
    expect(woo).toEqual({
      name: "woocommerce",
      url: "http://woo-mcp:3001/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    });

    const gh = serverInserts.find(i => i.val.name === "github")?.val;
    expect(gh).toEqual({
      name: "github",
      url: "http://github-mcp:3002/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    });

    const weather = serverInserts.find(i => i.val.name === "weather")?.val;
    expect(weather).toEqual({
      name: "weather",
      url: "http://weather-mcp:3003/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    });

    // Verify member permissions were seeded with namespaced tool names
    const permInserts = insertedValues.filter(i => i.table === role_permissions);
    const namespacedTools = permInserts.map(i => i.val.namespaced_tool);
    expect(namespacedTools).toContain("woocommerce__list_products");
    expect(namespacedTools).toContain("woocommerce__list_orders");
    expect(namespacedTools).toContain("woocommerce__get_order");
    expect(namespacedTools).toContain("github__list_issues");
    expect(namespacedTools).toContain("weather__get_weather");
  });

  it("is idempotent and does not re-insert or overwrite existing upstream servers", async () => {
    // Simulate all 3 servers already existing in DB
    (db.select as any) = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            if (table === upstream_servers) {
              return Promise.resolve([
                { id: 1, name: "woocommerce", url: "http://custom-woo:3001/mcp", enabled: false, builtin: true }
              ]);
            }
            if (table === users) {
              return Promise.resolve([{ id: 1, email: "admin@urumi.local" }]);
            }
            return Promise.resolve([]);
          })
        }))
      }))
    }));

    const { seedDatabase } = await import("./seed.js");
    await seedDatabase();

    const serverInserts = insertedValues.filter(i => i.table === upstream_servers);
    expect(serverInserts).toHaveLength(0);
  });

  it("does not overwrite member permissions if member already exists", async () => {
    // Member user already exists
    (db.select as any) = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: any) => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            if (table === users) {
              return Promise.resolve([{ id: 2, email: "member@urumi.local", role: "member" }]);
            }
            if (table === upstream_servers) {
              return Promise.resolve([{ id: 1, name: "weather" }]);
            }
            return Promise.resolve([]);
          })
        }))
      }))
    }));

    const { seedDatabase } = await import("./seed.js");
    await seedDatabase();

    // Permissions should not be re-inserted for existing member
    const permInserts = insertedValues.filter(i => i.table === role_permissions);
    expect(permInserts).toHaveLength(0);
  });
});

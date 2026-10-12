import { db } from "./index.js";
import { users, upstream_servers, role_permissions } from "./schema.js";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

export async function seedDatabase() {
  const adminEmail = "admin@urumi.local";
  const memberEmail = "member@urumi.local";
  const adminPass = process.env.ADMIN_PASSWORD;
  const memberPass = process.env.MEMBER_PASSWORD;
  
  // Seed admin
  if (adminPass) {
    const existingAdmin = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existingAdmin.length === 0) {
      await db.insert(users).values({
        email: adminEmail,
        name: "Admin User",
        password_hash: await bcrypt.hash(adminPass, 10),
        role: "admin"
      });
      console.log("Seeded admin user.");
    }
  } else {
    console.log("Skipping admin user seed: ADMIN_PASSWORD not provided.");
  }
  
  let isNewMember = false;
  // Seed member
  if (memberPass) {
    const existingMember = await db.select().from(users).where(eq(users.email, memberEmail)).limit(1);
    if (existingMember.length === 0) {
      isNewMember = true;
      await db.insert(users).values({
        email: memberEmail,
        name: "Member User",
        password_hash: await bcrypt.hash(memberPass, 10),
        role: "member"
      });
      console.log("Seeded member user.");
    }
  } else {
    console.log("Skipping member user seed: MEMBER_PASSWORD not provided.");
  }
  
  // Seed builtin upstream MCP servers
  const defaultServers = [
    {
      name: "woocommerce",
      url: "http://woo-mcp:3001/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    },
    {
      name: "github",
      url: "http://github-mcp:3002/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    },
    {
      name: "weather",
      url: "http://weather-mcp:3003/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    }
  ];

  for (const server of defaultServers) {
    const existingServer = await db.select().from(upstream_servers).where(eq(upstream_servers.name, server.name)).limit(1);
    if (existingServer.length === 0) {
      await db.insert(upstream_servers).values(server);
      console.log(`Seeded builtin ${server.name} server.`);
    }
  }

  // Seed default member permissions only if member was newly created
  if (isNewMember) {
    const defaultTools = [
      "woocommerce__list_products",
      "woocommerce__list_orders",
      "woocommerce__get_order",
      "github__list_issues",
      "weather__get_weather"
    ];
    for (const tool of defaultTools) {
      const existingPerm = await db
        .select()
        .from(role_permissions)
        .where(and(eq(role_permissions.role, "member"), eq(role_permissions.namespaced_tool, tool)))
        .limit(1);
      if (existingPerm.length === 0) {
        await db.insert(role_permissions).values({
          role: "member",
          namespaced_tool: tool
        });
      }
    }
    console.log("Seeded default member permissions.");
  }
}

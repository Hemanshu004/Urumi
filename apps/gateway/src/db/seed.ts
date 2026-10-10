import { db } from "./index.js";
import { users, upstream_servers } from "./schema.js";
import { eq } from "drizzle-orm";
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
  
  // Seed builtin WooCommerce server
  const serverName = "woocommerce";
  const existingServer = await db.select().from(upstream_servers).where(eq(upstream_servers.name, serverName)).limit(1);
  if (existingServer.length === 0) {
    await db.insert(upstream_servers).values({
      name: serverName,
      url: "http://woo-mcp:3001/mcp",
      builtin: true,
      enabled: true,
      status: "unknown"
    });
    console.log("Seeded builtin WooCommerce server.");
  }

  // Seed default member permissions only if member was newly created
  if (isNewMember) {
    const { role_permissions } = await import("./schema.js");
    const defaultTools = [
      "woocommerce__list_products",
      "woocommerce__list_orders",
      "woocommerce__get_order",
      "github__list_issues",
      "weather__get_weather"
    ];
    for (const tool of defaultTools) {
      await db.insert(role_permissions).values({
        role: "member",
        namespaced_tool: tool
      });
    }
    console.log("Seeded default member permissions.");
  }
}

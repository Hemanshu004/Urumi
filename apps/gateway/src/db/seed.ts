import { db } from "./index.js";
import { users, upstream_servers } from "./schema.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

export async function seedDatabase() {
  const adminEmail = "admin@urumi.local";
  const memberEmail = "member@urumi.local";
  const adminPass = process.env.ADMIN_PASSWORD || "admin123";
  const memberPass = process.env.MEMBER_PASSWORD || "member123";
  
  // Seed admin
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
  
  // Seed member
  const existingMember = await db.select().from(users).where(eq(users.email, memberEmail)).limit(1);
  if (existingMember.length === 0) {
    await db.insert(users).values({
      email: memberEmail,
      name: "Member User",
      password_hash: await bcrypt.hash(memberPass, 10),
      role: "member"
    });
    console.log("Seeded member user.");
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
}

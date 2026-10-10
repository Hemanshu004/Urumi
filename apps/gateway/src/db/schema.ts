import { pgTable, serial, varchar, timestamp, text, boolean, integer, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  password_hash: varchar("password_hash", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("member"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const api_keys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").references(() => users.id).notNull(),
  key_hash: varchar("key_hash", { length: 255 }).notNull(),
  key_prefix: varchar("key_prefix", { length: 50 }).notNull(),
  label: varchar("label", { length: 255 }),
  created_at: timestamp("created_at").defaultNow().notNull(),
  last_used_at: timestamp("last_used_at"),
  revoked_at: timestamp("revoked_at"),
});

export const upstream_servers = pgTable("upstream_servers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  url: varchar("url", { length: 1024 }).notNull(),
  builtin: boolean("builtin").default(false).notNull(),
  credential_encrypted: text("credential_encrypted"),
  enabled: boolean("enabled").default(true).notNull(),
  status: varchar("status", { length: 50 }).default("unknown").notNull(),
  status_message: text("status_message"),
  last_health_check: timestamp("last_health_check"),
  timeout_ms: integer("timeout_ms").default(30000).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const audit_logs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").references(() => users.id),
  server_id: integer("server_id").references(() => upstream_servers.id),
  namespaced_tool: varchar("namespaced_tool", { length: 512 }).notNull(),
  tool_name: varchar("tool_name", { length: 255 }).notNull(),
  request_params: jsonb("request_params"),
  outcome: varchar("outcome", { length: 50 }).notNull(),
  error_message: text("error_message"),
  duration_ms: integer("duration_ms"),
  source: varchar("source", { length: 255 }),
  started_at: timestamp("started_at").notNull(),
  completed_at: timestamp("completed_at").notNull(),
});

export const role_permissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: varchar("role", { length: 50 }).notNull(),
  namespaced_tool: varchar("namespaced_tool", { length: 512 }).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" varchar(50) NOT NULL,
	"namespaced_tool" varchar(512) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(50) NOT NULL,
	"label" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"server_id" integer,
	"namespaced_tool" varchar(512) NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"request_params" jsonb,
	"outcome" varchar(50) NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"source" varchar(255),
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upstream_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"credential_encrypted" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" varchar(50) DEFAULT 'unknown' NOT NULL,
	"status_message" text,
	"last_health_check" timestamp,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_servers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_server_id_upstream_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."upstream_servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

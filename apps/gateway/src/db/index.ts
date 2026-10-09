import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/gateway",
});

export const db = drizzle(pool, { schema });

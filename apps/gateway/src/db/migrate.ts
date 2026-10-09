import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const runMigrate = async () => {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/gateway",
  });
  
  const db = drizzle(pool);
  
  console.log("⏳ Running migrations...");
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("✅ Migrations completed!");
  
  await pool.end();
};

runMigrate().catch((err) => {
  console.error("❌ Migration failed!");
  console.error(err);
  process.exit(1);
});

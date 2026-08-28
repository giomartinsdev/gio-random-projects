import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index.js";
import { logger } from "../logger.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const { db, pool } = createDb(databaseUrl);
await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
logger.info("migrations applied");

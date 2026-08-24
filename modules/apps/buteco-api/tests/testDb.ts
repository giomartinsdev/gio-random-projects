import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db/index.js";

// Real Postgres via testcontainers for every test that touches
// persistence -- no mocked ORM, no in-memory stand-in. One container
// per test file (see beforeAll/afterAll in each suite), migrations
// applied for real via drizzle's generated SQL.
export async function startTestDb() {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("buteco_test")
    .withUsername("buteco")
    .withPassword("buteco")
    .start();

  const connectionString = container.getConnectionUri();
  const { db, pool } = createDb(connectionString);

  await migrate(db, { migrationsFolder: "./drizzle" });

  return {
    db,
    connectionString,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

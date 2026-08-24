import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db/index.js";

// Real Postgres via testcontainers, migrating only this service's own
// table -- bookclub_document, the PDF blob (rooms/messages moved to
// domain-api's own Postgres, see tests/fakeDomainApi.ts for how the
// REST layer's tests fake that instead) -- NOT Better Auth's tables,
// which live in a migration this package doesn't own (post-api's).
// That's why these tests exercise room CRUD through a fake Auth stub
// (tests/fakeAuth.ts) rather than a real Better Auth instance: there's
// no "user" table here to satisfy it. Session validation itself is a
// post-api concern, already covered by post-api's own test suite.
export async function startTestDb() {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("bookclub_test")
    .withUsername("buteco")
    .withPassword("buteco")
    .start();

  const { db, pool } = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: "./drizzle" });

  return {
    db,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

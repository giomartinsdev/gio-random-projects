import { defineConfig } from "drizzle-kit";

// Only bookclub's own tables (room/document/message) -- Better Auth's
// tables live in src/db/authSchema.ts instead, deliberately excluded
// here. bookclub-api shares the SAME Postgres database as post-api
// (see this repo's Terraform: both build DATABASE_URL from
// module.compute_data's single postgres instance), and post-api's own
// migration already created user/session/account/verification there.
// Including them in this schema too would make drizzle-kit try to
// CREATE TABLE things that already exist.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://buteco:buteco@localhost:5432/buteco",
  },
});

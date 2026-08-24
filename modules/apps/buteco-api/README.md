# buteco-api

Headless content API for Buteco dos Devs — devs write articles/courses
natively (markdown) or (phase 2) import a link and it gets pulled in
and normalized to markdown. No frontend lives here on purpose: a web
UI, and later a Discord bot, are both just consumers of this same API.

- **Framework**: [Hono](https://hono.dev) — small, fast, framework-agnostic (not tied to any specific Node runtime).
- **Auth**: [Better Auth](https://www.better-auth.com), email+password today. The `bearer` plugin is enabled so any client (a web frontend, a future Discord bot, a script) authenticates with `Authorization: Bearer <token>` instead of needing to manage cookies — headless-friendly by design. Discord OAuth slots in later as another provider in `src/lib/auth.ts` with no schema change needed.
- **DB**: Postgres via [Drizzle ORM](https://orm.drizzle.team). Schema in `src/db/schema.ts` — Better Auth's own tables (`user`/`session`/`account`/`verification`) plus the app's (`posts`/`tags`/`posts_to_tags`).
- **Tests**: Vitest + real Postgres via testcontainers (`@testcontainers/postgresql`) — no mocked DB. `tests/features/posts.test.ts` covers positive/negative/edge for every endpoint.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/posts` | none | Published posts only |
| POST | `/posts` | required | Creates a draft (or published, if `status` given) |
| GET | `/posts/:slug` | none | Published only; 404 for drafts/missing |
| PATCH | `/posts/:id` | owner only | 403 for non-owners, 404 if missing |
| DELETE | `/posts/:id` | owner only | 403 for non-owners, 404 if missing |
| * | `/api/auth/*` | — | Better Auth's own routes (sign-up, sign-in, etc.) |

## Running locally

```
cp .env.example .env
npm install
npm run db:generate   # only after changing src/db/schema.ts
npm run db:migrate    # against the DATABASE_URL in .env
npm run dev
```

## Testing

```
npm test
```

Spins up a real Postgres container per test file — no setup needed beyond having Docker available locally (same as CI).

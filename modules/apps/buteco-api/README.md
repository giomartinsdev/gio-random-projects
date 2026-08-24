# buteco-api

Headless content API for Buteco dos Devs — devs write articles/courses
natively (markdown) or (phase 2) import a link and it gets pulled in
and normalized to markdown. No frontend lives here on purpose: a web
UI, and later a Discord bot, are both just consumers of this same API.

## Architecture: logic + auth only, no post storage of its own

This service owns **no Postgres table for posts**. All post
persistence goes through `domain-api`/`domain-worker` (the existing
CQRS pipeline in this repo) over the internal docker network — this
service is a man-in-the-middle: it authenticates the caller, enforces
authorization (owner-only edit/delete), and forwards to domain-api.
See `src/lib/domainApiClient.ts`.

Practical consequence: **writes are asynchronous**. `POST`/`PATCH`/
`DELETE /posts*` return `202 Accepted` with a `command_id`, not an
immediate 200/201/204 — domain-worker applies the change afterward. A
`GET` immediately after a write may not reflect it yet.

This service's own Postgres connection (`DATABASE_URL`) is used
**only** for Better Auth's tables (`user`/`session`/`account`/
`verification`) — nothing content-related lives there.

- **Framework**: [Hono](https://hono.dev).
- **Auth**: [Better Auth](https://www.better-auth.com), email+password today, `bearer` plugin enabled (`Authorization: Bearer <token>` — headless-friendly, no cookie jar needed). Discord OAuth slots in later as another provider in `src/lib/auth.ts`.
- **domain-api client**: plain `fetch`-based, authenticated with `X-API-Key` (one of the keys in domain-api's `DOMAIN_API_KEYS`).
- **Tests**: Vitest. Better Auth is tested against real Postgres via testcontainers (`tests/testDb.ts`); domain-api is stood in for by a real HTTP server (`tests/fakeDomainApi.ts`) implementing its actual contract — not the real Go binary (that would need its own Postgres/Redis/domain-worker to exercise), but a genuine network hop, not an in-process mock.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/posts` | none | Published posts only, proxied from domain-api |
| POST | `/posts` | required | Forwards to domain-api, returns 202 |
| GET | `/posts/:slug` | none | Published only; 404 for drafts/missing |
| PATCH | `/posts/:id` | owner only | Looks up current author via domain-api first; 403 for non-owners, 404 if missing; 202 on forward |
| DELETE | `/posts/:id` | owner only | Same ownership check; 202 on forward |
| * | `/api/auth/*` | — | Better Auth's own routes (sign-up, sign-in, etc.) |

## Running locally

```
cp .env.example .env   # set DATABASE_URL, BETTER_AUTH_SECRET, DOMAIN_API_URL, DOMAIN_API_KEY
npm install
npm run db:generate    # only after changing src/db/schema.ts (Better Auth tables only)
npm run db:migrate     # against the DATABASE_URL in .env
npm run dev
```

## Testing

```
npm test
```

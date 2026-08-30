# post-api

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

This service's own Postgres connection (`DATABASE_URL`) is used for
Better Auth's tables (`user`/`session`/`account`/`verification`) plus
**engagement** (`post_likes`, `profile_views`) — the one place content
*interaction* (not content) lives here.

**Why engagement is here and not in domain-api**: domain-api's write
path is the CQRS pipeline (202 Accepted, applied later by
domain-worker), but a like must respond synchronously with the new
count or the button feels dead. So likes/profile-views are plain
synchronous tables here, one Postgres round-trip, no queue. Two tables:

- `post_likes` — `post_id` is an **opaque text id with no FK** (posts
  belong to domain-api; a like referencing a since-deleted post is
  harmless, reads join against the published list anyway); `user_id`
  does FK the Better Auth `user` (cascade). The composite PK
  `(post_id, user_id)` makes re-liking idempotent for free.
- `profile_views` — one row per `(profile_user_id, viewer_user_id)`
  pair; the PK *is* the distinctness constraint, and the view count is
  just `COUNT(*)`. Self-views are never recorded (see
  `src/lib/engagement.ts`); only logged-in viewers are ever counted —
  the UI labels the number accordingly.

- **Framework**: [Hono](https://hono.dev).
- **Auth**: [Better Auth](https://www.better-auth.com), email+password for the normal site, plus a Discord social provider (`src/lib/auth.ts`) used by **both** the web login button and the Discord Activity flow below. `bearer` plugin enabled (`Authorization: Bearer <token>`) — the Activity's session travels that way, not as a cookie, since cookies don't survive the discordsays.com proxy Activities load through.
- **domain-api client**: plain `fetch`-based, authenticated with `X-API-Key` (one of the keys in domain-api's `DOMAIN_API_KEYS`).
- **Tests**: Vitest. Better Auth is tested against real Postgres via testcontainers (`tests/testDb.ts`); domain-api is stood in for by a real HTTP server (`tests/fakeDomainApi.ts`) implementing its actual contract — not the real Go binary (that would need its own Postgres/Redis/domain-worker to exercise), but a genuine network hop, not an in-process mock.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/posts` | none | Published posts only, proxied from domain-api; enriched with `likeCount`/`likedByMe` for the caller |
| POST | `/posts` | required | Forwards to domain-api, returns 202 |
| POST | `/posts/import` | required | Fetches a public dev.to / TabNews / Medium link and returns it as a markdown draft (not a persisted post) with the "Retirado daqui do…" attribution footer already appended — see `src/lib/importAdapter.ts`. Does NOT support arbitrary hosts (SSRF by allowlist, not by blocklist) |
| GET | `/posts/:slug` | none | Published only; 404 for drafts/missing; like fields like the list |
| GET | `/posts/liked/by-me` | required | Current user's liked published posts, newest like first |
| POST | `/posts/:id/like` | required | Like (idempotent) → `{ likeCount, likedByMe }`; 404 if domain-api doesn't know the post |
| DELETE | `/posts/:id/like` | required | Unlike; 200 even if never liked or post is gone |
| PATCH | `/posts/:id` | owner only | Looks up current author via domain-api first; 403 for non-owners, 404 if missing; 202 on forward |
| DELETE | `/posts/:id` | owner only | Same ownership check; 202 on forward |
| GET | `/users/:id` | none | Public profile identity (never the email) + distinct-visitor `viewCount` |
| POST | `/users/:id/view` | required | Record one profile visit; one row per viewer, self-views ignored |
| GET | `/feed.xml` | none | RSS 2.0, last 50 published posts |
| POST | `/images/upload` | required | Multipart image upload (the editor's cover/inline buttons) → stored in MinIO, returns the public URL to reference. jpeg/png/webp/gif, 8 MB max. Only mounted when the `MINIO_*` + `MEDIA_BASE_URL` envs are set — see "Post images (MinIO)" below |
| GET | `/image-proxy?url=` | none | Re-fetches an external image URL, streaming it back — rejects private/loopback hosts and non-image responses |
| POST | `/discord/token` | none | Discord Activity OAuth code → access_token exchange. Only mounted when `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` are set — see "Discord Activity" below |
| * | `/api/auth/*` | — | Better Auth's own routes (sign-up, sign-in, etc.), including `/api/auth/sign-in/social` which the Activity flow below uses |

## Discord login (web)

Besides the Activity flow below, the same Discord OAuth app powers a
plain "Entrar com o Discord" button on the normal web `front` login
page — standard browser redirect through Better Auth:
`POST /api/auth/sign-in/social` with `{ provider: "discord",
callbackURL: "<front origin>/" }`, which 302s to Discord's consent
screen and comes back to this service's
`/api/auth/callback/discord`.

Two non-defaults in `src/lib/auth.ts` matter for it:

- `prompt: "consent"` on the provider — Better Auth's Discord provider
  defaults to `prompt: "none"` (silent), which Discord answers with
  `consent_required` for anyone who hasn't authorized the app yet,
  i.e. every first-time login. Standard "Sign in with X" behavior is
  to show the consent screen.
- **The `callbackURL` from the front must be absolute**
  (`${window.location.origin}/`). Better Auth re-redirects to it from
  *this* server's host after the Discord callback, so a relative path
  would land on post-api.giomartins.dev and 404.

**Redirect URI registration**: the Discord application's OAuth2
settings must include `https://post-api.giomartins.dev/api/auth/callback/discord`
alongside the Activity's URL mappings below — Discord rejects
unregistered redirect URIs outright.

## Discord Activity

`front` can run embedded inside Discord as an [Activity](https://discord.com/developers/docs/activities/overview) — the whole site, unmodified, launched from a voice channel, and the user is signed into the site automatically as their Discord identity (no separate login form). This service's half is `/discord/token` + the `discord` social provider in `src/lib/auth.ts`; the other half is `front/src/lib/discordActivity.ts`. All of it stays inert (no route mounted, SDK never initialized) until configured.

**Why auto-login works without a browser OAuth redirect**: the Activity SDK's `authorize()` already gets a real Discord-issued `code`, exchanged here for an `access_token` through Discord's actual token endpoint using `DISCORD_CLIENT_SECRET`. That round-trip *is* the proof of identity. The frontend then calls Better Auth's `/api/auth/sign-in/social` directly with that access_token (as an `idToken.accessToken`, Discord's provider doesn't do JWT/OIDC so `auth.ts` overrides `verifyIdToken` to trust it — see that file's comment for why this is still safe), which creates an account on first use and returns a bearer session token. Cookies can't carry that session (Discord proxies everything through a `discordsays.com` origin, incompatible with post-api's cross-subdomain cookie), so it's stored client-side instead and attached as `Authorization: Bearer` on every request — see `front/src/lib/discordAuthToken.ts`.

**Images**: a post's `coverImageUrl`/inline markdown images are whatever external host the author pasted — Discord's Activity sandbox can't reach arbitrary hosts, only ones with a URL Mapping. `front/src/lib/discordActivity.ts`'s `resolveImageUrl()` routes them through `/image-proxy` (which *is* mapped) instead, everywhere a post image renders. No-op outside a Discord Activity.

To turn it on:

1. Register an application at [discord.com/developers/applications](https://discord.com/developers/applications), enable **Activities** for it.
2. Under **Activities → URL Mappings**, set:
   - Root mapping (`/`) → `buteco-class.giomartins.dev`
   - `/postapi` → `post-api.giomartins.dev`
   - `/bookclubapi` → `bookclub-api.giomartins.dev`
   - `/classroomapi` → `classroom-api.giomartins.dev`

   These prefixes are hardcoded in `front/src/lib/discordUrlPatch.ts`'s `patchUrlMappings` call — if you change them there, change them here too.
3. Under **OAuth2**, note the Client ID and Client Secret.
4. Set `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` here (this service) and `VITE_DISCORD_CLIENT_ID` on `front` (build-time, same value as the client ID — Discord client IDs are public by design). In this repo's deploy, both come from the `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` GitHub Actions secrets via Terraform (`modules/infra/terraform/variables.tf`).
5. Launch the Activity from Discord (Activities panel in a voice channel, or via the app's own invite/install flow) — `frame_id` in the URL is how the front app detects it's running inside Discord at all.

## Post images (MinIO)

Covers and inline pictures no longer need an external host: the
editor/cover "Enviar imagem" buttons upload the file to
`POST /images/upload` (routes/images.ts), which stores it in MinIO and
returns a public URL — `media.giomartins.dev/<userId>/<uuid>.<ext>` —
that the post references directly. The bucket is **public-read on
purpose** (a visitor's `<img>` tag must load anonymously, including
inside the Activity iframe) and pre-created by `static_sites.tf`
alongside the frontend buckets; readers never touch this API when
rendering an image. The allowlist (jpeg/png/webp/gif) + 8 MB cap at
upload time is the only gate an object ever passes, so it's the
security boundary — see routes/images.ts's header comment.

The `/images` route mounts only when **all five** of
`MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`/`MINIO_BUCKET`/
`MEDIA_BASE_URL` are set (index.ts) — same opt-in shape as Discord's.
In this repo's deploy terraform wires them from module.storage_minio;
Discord Activity users should add a `/media` → `media.giomartins.dev`
URL Mapping in the Discord portal so uploaded images render inside the
Activity.

## Running locally

```
cp .env.example .env   # set DATABASE_URL, BETTER_AUTH_SECRET, DOMAIN_API_URL, DOMAIN_API_KEY
npm install
npm run db:generate    # only after changing src/db/schema.ts (Better Auth + engagement tables)
npm run db:migrate     # against the DATABASE_URL in .env
npm run dev
```

## Testing

```
npm test
```

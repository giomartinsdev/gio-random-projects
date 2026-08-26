# modules/apps

Each subfolder is an independently deployed app — touch only
`domain-api/**` and only `domain-api` rebuilds, gets pushed to
`registry.giomartins.dev`, and redeploys via Terraform (see each
workflow's own header for why not watchtower). Three pipelines, one
per language+layer:

- **`.github/workflows/go-ci-cd.yml`** — Go apps, auto-discovered by
  `go.mod` (`domain-api`, `domain-worker`, `tela-api`).
- **`.github/workflows/ts-frontend-ci-cd.yml`** — TypeScript frontend
  apps (`buteco-class-frontend`, `tela-frontend`), which need `VITE_*`
  env vars baked into the bundle at build time. Neither runs as a
  container: the build is mirrored straight into its own MinIO bucket
  instead (see `modules/infra/terraform/static_sites.tf`).
- **`.github/workflows/ts-backend-ci-cd.yml`** — TypeScript backend
  apps (`post-api`, `bookclub-api`, `classroom-api`), which take their
  config as real runtime env vars from Terraform instead.

Unlike Go, a `package.json` alone doesn't put a TypeScript app in
either pipeline — see `docs/novo-app-ci-cd.md` for the `ALLOWED_APPS`
list each of those two workflows actually reads.

Folders are named `<bounded-context>-api` / `<bounded-context>-worker`
— `domain-api`/`domain-worker` today, more pairs alongside them as new
bounded contexts show up, rather than bare `api`/`worker` that would
only ever fit one.

- **`domain-api/`** — REST reads straight from Postgres; writes
  publish a command and return 202, applied asynchronously by
  `domain-worker`.
- **`domain-worker/`** — the only writer, consumes commands off the
  event bus, applies them, records an audit trail.
- **`post-api/`** — headless content API for Buteco dos Devs (articles/courses, Better Auth). Independent Node/TypeScript stack, not Go like the rest of this folder — see its own README for why. A future `buteco-bot` (Discord integration) would be just another consumer of this same API, not a new bounded context.
- **`buteco-class-frontend/`** — the blog's React frontend, talking to `post-api` and `bookclub-api` directly from the browser. Same Node/TypeScript stack as `post-api`.
- **`bookclub-api/`** — realtime PDF room service ("Clube do Livro"): upload a PDF, open a room, others join over a WebSocket for live page-turning, host annotations, and chat. Unlike `post-api`, it owns its rooms/documents/messages tables directly (no domain-api CQRS hop) and reuses post-api's own Better Auth session instead of its own login — see its README for why both.
- **`tela-api/`** / **`tela-frontend/`** — screen sharing at `tela.giomartins.dev`: a Go SFU/signalling backend (its own container) and its own separate React frontend (a static build in MinIO, no container), talking to each other over CORS, own origins. Shares nothing with the rest of this folder — no Postgres, no Better Auth, no domain-api. See `tela-api/README.md` for how the SFU itself works.

`domain-api` and `domain-worker` are deliberately independent Go
modules (each with its own `go.mod`) even though they agree on the
same event-bus wire format — no shared package between them, so a
change to one never forces a rebuild of the other. See either's own
`internal/` package docs for the DDD layering (`domain` →
`application` → `infrastructure`).

## Running locally

```
cp .env.example .env   # set POSTGRES_PASSWORD and DOMAIN_API_KEYS
docker compose up --build
```

## Deploying

`compose.yaml` here is local-dev only. Production containers
(postgres, redis, domain-api, domain-worker) are defined in
`modules/infra/terraform/modules/compute/{data,app}` as real
`docker_container` resources, not docker-compose — CI builds and
pushes an image on every push touching an app's own folder;
`modules/infra/terraform/modules/compute/registry`'s watchtower polls
the registry and redeploys the container Terraform already created.
See `modules/infra/terraform/README.md`.

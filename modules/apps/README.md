# modules/apps

Each subfolder is an independently deployed app — touch only
`domain-api/**` and only `domain-api` rebuilds, gets pushed to
`registry.giomartins.dev`, and redeploys via Terraform (see each
workflow's own header for why not watchtower). Three pipelines, one
per language+layer:

- **`.github/workflows/go-ci-cd.yml`** — Go apps, auto-discovered by
  `go.mod` (`domain-api`, `domain-worker`, `tela-api`, `clubs-api`).
- **`.github/workflows/ts-frontend-ci-cd.yml`** — TypeScript SPAs
  (`tela-frontend`, `clubs-frontend`, `hub-frontend`), which need
  `VITE_*` env vars baked into the bundle at build time. None of them
  runs as a container: the build is mirrored straight into its own
  MinIO bucket instead (see `modules/infra/terraform/static_sites.tf`).
- **`.github/workflows/python-ci-cd.yml`** — Python workers
  (`clubs-ingest`), auto-discovered by `pyproject.toml`.

Unlike Go, a `package.json` alone doesn't put a TypeScript app in the
frontend pipeline — see `docs/novo-app-ci-cd.md` for the `ALLOWED_APPS`
list that workflow actually reads.

Folders are named `<bounded-context>-api` / `<bounded-context>-worker`
— `domain-api`/`domain-worker` today, more pairs alongside them as new
bounded contexts show up, rather than bare `api`/`worker` that would
only ever fit one.

- **`domain-api/`** — REST reads straight from Postgres; writes
  publish a command and return 202, applied asynchronously by
  `domain-worker`.
- **`domain-worker/`** — the only writer, consumes commands off the
  event bus, applies them, records an audit trail.
- **`tela-api/`** / **`tela-frontend/`** — screen sharing at
  `tela.giomartins.dev`: a Go SFU/signalling backend (its own
  container) and its own separate React frontend (a static build in
  MinIO, no container), talking to each other over CORS, own origins.
  Shares nothing with the rest of this folder — no Postgres, no Better
  Auth, no domain-api. See `tela-api/README.md` for how the SFU itself
  works.
- **`clubs-api/`** / **`clubs-ingest/`** / **`clubs-frontend/`** — o FC
  Clubs Hub em `clubs.giomartins.dev`: rankings, perfis de
  clube/partida/jogador e o histórico que a EA não guarda. `clubs-ingest`
  é um worker Python (sem porta, sem host) que puxa da API pública de
  Pro Clubs e grava via `domain-api`; `clubs-api` é um BFF Go (um host,
  sem banco) com duas camadas — leituras públicas sem identidade e uma
  camada pessoal atrás do login próprio no `/api`; `clubs-frontend` é uma
  SPA React estática em bucket, sem container, que entra no hub como
  microfrontend. O design system vive em `clubs-frontend/ui.pen`.
- **`hub-frontend/`** — o hub: chrome em volta das SPAs acima (sidebar +
  um renderer que as iframeia) mais atalhos de nova aba para os painéis
  protegidos por Access. Também é uma SPA estática em bucket.

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
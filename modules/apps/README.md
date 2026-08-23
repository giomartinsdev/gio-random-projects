# modules/apps

Each subfolder with a `Dockerfile` is an independently deployed app,
auto-discovered by `.github/workflows/apps-deploy.yml` — touch only
`api/**` and only `api` rebuilds, gets pushed to
`registry.giomartins.dev`, and redeploys (via
`modules/infra/watchtower`).

- **`api/`** — domain-api: REST reads straight from Postgres; writes
  publish a command and return 202, applied asynchronously by `worker`.
- **`worker/`** — domain-worker: the only writer, consumes commands off
  the event bus, applies them, records an audit trail.
- **`front/`** — reserved, nothing here yet.

`api` and `worker` are deliberately independent Go modules (each with
its own `go.mod`) even though they agree on the same event-bus wire
format — no shared package between them, so a change to one never
forces a rebuild of the other. See either's own `internal/` package
docs for the DDD layering (`domain` → `application` → `infrastructure`).

## Running locally

```
cp .env.example .env   # set POSTGRES_PASSWORD and DOMAIN_API_KEYS
docker compose up --build
```

## Deploying

`compose.yaml` here is local-dev only. Production containers (postgres,
redis, api, worker) are defined in `modules/infra/terraform/compute.tf`
as real `docker_container` resources, not docker-compose — CI builds
and pushes an image on every push touching an app's own folder;
`modules/infra/watchtower` polls the registry and redeploys the
container Terraform already created. See `modules/infra/terraform/README.md`.

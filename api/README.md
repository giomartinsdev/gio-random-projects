# api/

Every subfolder here with a `Dockerfile` is its own independently
deployable API. `.github/workflows/api-build-push.yml` discovers them
dynamically on every push — add a new one and it starts building/pushing
to `registry.giomartins.dev` with zero workflow changes.

## Adding a new API

```
api/<name>/
  Dockerfile      # required — this is what marks it as a deployable service
  ...whatever the service needs
```

The folder name becomes both the Docker build context and the image name:
`api/<name>/` → `registry.giomartins.dev/<name>:latest` +
`registry.giomartins.dev/<name>:<git-sha>`.

## Current services

- **`domain-api/`** — the DDD/event-driven domain API (Python 3.14,
  FastAPI, SQLModel). See `domain-api/README.md` for how *its* internal
  convention works (define an entity + events, everything else is
  automatic) — that's a separate, inner convention from this folder's
  "one Dockerfile = one deployable service" one.

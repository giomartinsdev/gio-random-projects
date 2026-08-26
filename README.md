# gio-random-projects

Infra-as-code and app code for the VPS, all under `modules/`.

```
modules/
  apps/      independently deployed apps — api, worker, front, tela, ...
  infra/     terraform (Cloudflare DNS/Access + VPS containers), registry, watchtower
```

## Pipelines

Three, split by language and by layer:

- **`.github/workflows/go-ci-cd.yml`** — CI/CD for Go apps under
  `modules/apps/*/` (has a `go.mod`). Touching only one app's folder
  rebuilds, tests, pushes, and redeploys only that app.
- **`.github/workflows/ts-ci-cd.yml`** — same, for TypeScript/Node
  apps under `modules/apps/*/` (has a `package.json`).
- **`.github/workflows/tf-ci-cd.yml`** — plans on PRs touching
  `modules/infra/terraform/`, applies on push to `main`.

See `modules/apps/README.md` and `modules/infra/README.md` for what's
in each.

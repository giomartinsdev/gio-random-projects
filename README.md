# gio-random-projects

Infra-as-code and app code for gio-server, all under `modules/`.

```
modules/
  apps/      independently deployed apps — api, worker, front (reserved)
  infra/     terraform, cloudflared tunnel, registry, watchtower
```

## Pipelines

Two, matching the two things in `modules/`:

- **`.github/workflows/apps-deploy.yml`** — generic CI/CD for anything
  under `modules/apps/*/` with a Dockerfile. Touching only one app's
  folder rebuilds, tests, pushes, and redeploys only that app.
- **`.github/workflows/tf-deploy.yml`** — plans on PRs touching
  `modules/infra/terraform/`, applies on push to `main`.

See `modules/apps/README.md` and `modules/infra/README.md` for what's
in each.

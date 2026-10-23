# gio-random-projects

Infra-as-code and app code for the VPS, all under `modules/`.

```
modules/
  apps/      independently deployed apps — tela (api, frontend), domain (api, worker), finance (api, workers, frontend), hub-frontend
  infra/     terraform (Cloudflare DNS/Access + VPS containers), registry, watchtower
stacks/      Docker Compose stacks managed by Dockhand (the current, live plane)
gitops/      Kubernetes manifests reconciled by ArgoCD (the new plane, side by side)
```

## Two planes, one host

`stacks/` (Docker Compose via Dockhand) is what serves traffic today.
`gitops/` (k3s + ArgoCD) is being brought up **alongside** it, with nothing
cut over yet — no DNS, no ingress route, no existing container touched.
Services migrate one at a time, each with a one-line rollback. See
[`gitops/README.md`](gitops/README.md) for why the cluster deliberately has
no ingress controller and how a service moves over.

## Pipelines

Five, split by language and by layer — one pipeline per concern rather
than one generic pipeline branching on every difference between them:

- **`.github/workflows/go-ci-cd.yml`** — CI/CD for Go apps under
  `modules/apps/*/`, auto-discovered by `go.mod`. Touching only one
  app's folder rebuilds, tests, pushes, and redeploys only that app.
- **`.github/workflows/python-ci-cd.yml`** — Python workers, likewise
  auto-discovered by `pyproject.toml`.
- **`.github/workflows/ts-frontend-ci-cd.yml`** — TypeScript SPAs
  (Vite, `VITE_*` build-args baked into the bundle).
- **`.github/workflows/tf-ci-cd.yml`** — plans on PRs touching
  `modules/infra/terraform/`, applies on push to `main`.
- **`.github/workflows/gitops-validate.yml`** — renders every app under
  `gitops/apps/` with kustomize, validates against the Kubernetes schema
  with `kubeconform -strict`, and fails on a movable (`latest`) image tag.
  A broken manifest merged to `main` doesn't fail loudly — ArgoCD just sits
  in `SyncFailed` while the cluster keeps running the old version.

Unlike Go's and Python's, the TypeScript pipeline doesn't auto-discover
by file presence alone — see `docs/novo-app-ci-cd.md` for its
`ALLOWED_APPS` list.

## Observability

Every app ships OpenTelemetry traces + metrics to a self-hosted Grafana
stack on the same VPS, and every container's stdout lands in Loki —
dashboards at `grafana.giomartins.dev` (Cloudflare Access + Grafana
login, password in Vaultwarden). Architecture, data flow, retention,
and the recipe for wiring a new app live in
[`modules/infra/terraform/modules/compute/services/observability/README.md`](modules/infra/terraform/modules/compute/services/observability/README.md).

See `modules/apps/README.md` and `modules/infra/README.md` for what's
in each.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — a arquitetura de hoje em
  diagramas Mermaid: host/stacks, fluxo do WhatsApp (financeiro), CQRS,
  deploy e observabilidade.
- [`docs/servidor-zomboid.md`](docs/servidor-zomboid.md) — the Project
  Zomboid dedicated server: why it runs natively (arm64/x86), systemd +
  box64 architecture, ports/firewall, data layout, ops runbook.
- [`docs/servidor-minecraft.md`](docs/servidor-minecraft.md) — the
  Minecraft server: All the Mods 11 (NeoForge modpack, 293 mods, MC 26.1.2),
  why it replaced the Paper vanilla setup, the name-based whitelist mod and
  its fail-closed boot, the offline-UUID trap for OP, the two firewall
  layers, backups, runbook.
- [`docs/cloudflare-edge-fase-2.md`](docs/cloudflare-edge-fase-2.md) —
  the proxy flip (registry carve-out, SSL flexible pin) and the
  incidents it settled.
- [`docs/novo-app-ci-cd.md`](docs/novo-app-ci-cd.md) — recipe for a new
  app with build → push → terraform apply CI/CD.

---
*Updated by OpenMausBot (Novato) — Teste de escrita e integração GitHub realizado com sucesso! (Commit adicional confirmado)*

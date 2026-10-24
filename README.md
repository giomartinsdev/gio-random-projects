# gio-random-projects

Infra-as-code, app code e manifests de cluster de um VPS só.

```
apps/       código das aplicações (Go, Python, TypeScript) — 1 pasta = 1 imagem
infra/      Terraform: Cloudflare, firewall, registry, buckets
k8s/        manifests Kubernetes reconciliados pelo ArgoCD (1 pasta = 1 Application)
  bootstrap/  aplicado à mão, 1x por cluster (ApplicationSet, namespaces, ArgoCD)
  apps/       <namespace>/<serviço>/ — a árvore que o ArgoCD varre
images/     Dockerfiles de imagens de terceiros (ai, excalidraw, maus)
packages/   bibliotecas compartilhadas entre apps
docs/       arquitetura, specs e runbooks
```

## O que roda hoje

Só Kubernetes (k3s). A era Docker Compose + Dockhand acabou: **0 containers
Docker** no host. Os antigos `stacks/*.yml` foram removidos — o histórico
guarda, mas o plano vivo é o cluster.

Serviços vivos: `apps/*` (o que é construído) e `k8s/apps/*` (o que é
reconciliado). Todo o tráfego público entra por Ingress nativo
(`nginx.org/*`) do ingress-nginx, e o Cloudflare faz o edge.

## Como o deploy funciona

1. Push em `main` que toque `apps/<app>/**` → o workflow da linguagem descobre
   o app pela presença de `go.mod` / `pyproject.toml` / `package.json` e
   constrói **só ele**.
2. A imagem vai para `registry.giomartins.dev` e o workflow commita o
   **digest** no manifesto em `k8s/apps/<ns>/<app>/`.
3. O ArgoCD vê o commit e reconcilia. Ninguém faz `kubectl apply` de workload.

O ApplicationSet em `k8s/bootstrap/appset.yaml` varre `k8s/apps/<ns>/*` e cria
uma Application por diretório. **O basename do diretório é o nome da
Application** — renomear uma pasta apaga a Application e pruna os recursos,
inclusive PVC. Não renomeie pasta de serviço sem ler `k8s/README.md`.

## Onde ler

| Documento | Assunto |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | visão geral, fluxo de tráfego, camadas |
| [`k8s/README.md`](k8s/README.md) | operação do cluster, armadilhas, ingress, ArgoCD |
| [`apps/README.md`](apps/README.md) | catálogo de aplicações e convenções |
| [`infra/README.md`](infra/README.md) | Terraform: o que gerencia e o que não |
| [`docs/novo-app-ci-cd.md`](docs/novo-app-ci-cd.md) | checklist para criar uma app nova |
| [`docs/`](docs/README.md) | índice completo |

## CI

| Workflow | Dispara em | Faz |
|---|---|---|
| `go-ci-cd.yml` | `apps/**` com `go.mod` | build → push → commit do digest |
| `python-ci-cd.yml` | `apps/**` com `pyproject.toml` | idem |
| `ts-frontend-ci-cd.yml` | `apps/**` com `package.json` | idem (S3 + CDN) |
| `gitops-validate.yml` | `k8s/**`, `images/**` | kustomize build + kubeconform |
| `tf-ci-cd.yml` | `infra/**` | plan no PR, apply manual em `main` |
| `*-image.yml` | `images/**` | build de imagem de terceiro (sem deploy) |

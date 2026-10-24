# docs/

Índice. Cada documento aqui descreve **um assunto**, não uma era do repo.

## Arquitetura e operação

| Documento | O que responde |
|---|---|
| [`architecture.md`](architecture.md) | como as peças se encaixam: CI, registry, ArgoCD, Cloudflare |
| [`novo-app-ci-cd.md`](novo-app-ci-cd.md) | passo a passo para criar uma app nova do zero |
| [`cloudflare-edge-fase-2.md`](cloudflare-edge-fase-2.md) | TLS, Access, service tokens, mTLS do registry |

Operação do cluster mora em [`../k8s/README.md`](../k8s/README.md) — é onde
estão as armadilhas medidas (ingress nativo, `websocket-services`, upstream
name, ApplicationSet).

## Specs de produto

| Documento | O que responde |
|---|---|
| [`finance-system-spec.md`](finance-system-spec.md) | arquitetura do sistema financeiro (CQRS, outbox, workers) |
| [`openfinance-spec.md`](openfinance-spec.md) | integração Open Finance |

> As specs mantêm referências à era Docker Compose (`stacks/*.yml`) porque
> descrevem o desenho **como foi decidido**. Onde o código divergiu, o código
> manda. O que existe hoje é `apps/` + `k8s/apps/`.

## Servidores de jogo (histórico)

| Documento | Estado |
|---|---|
| [`servidor-minecraft.md`](servidor-minecraft.md) | descomissionado; documenta como era |
| [`servidor-zomboid.md`](servidor-zomboid.md) | descomissionado; documenta como era |

## Convenção

- Um assunto por arquivo. Se passar de ~300 linhas, divida.
- Caminho escrito = caminho que existe. `grep` antes de commitar doc novo.
- Medição vale mais que opinião: se o doc afirma comportamento, diga como foi
  medido.

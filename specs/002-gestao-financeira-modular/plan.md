# Implementation Plan: Gestão Financeira Modular

**Branch**: `002-gestao-financeira-modular` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-gestao-financeira-modular/spec.md`

## Summary

Um produto de gestão financeira pessoal com login, composto por 4 módulos
independentes (Contas, Transacional, Asset Manager, Dashboard) e um único
frontend SPA. Segue à risca o padrão de microsserviços já estabelecido no
repositório: cada módulo é seu próprio serviço Go **sem banco de dados
próprio**, persistindo tudo através de comandos/queries na `domain-api`
compartilhada (o mesmo modelo que `cch-api` usa para salas e decks) — que por
sua vez publica na fila e delega a escrita real ao `domain-worker`
(CQRS + Postgres compartilhado). O frontend segue o padrão `tela-frontend`
(SPA estática, build espelhado num bucket MinIO, servida pelo ingress) e
entra no hub como um microfrontend autenticado (mesmo modelo do `bet`:
Cloudflare Access por hostname, sessão única com o resto do ecossistema). O
módulo Asset Manager integra a API gratuita da brapi.dev para cotações de
mercado; a chave/token é um segredo de infraestrutura, nunca commitado.

## Technical Context

**Language/Version**: Go 1.25 (os 4 backends dos módulos, seguindo
`domain-api`/`cch-api`/`harness-api`) + TypeScript/React 18 + Vite (o
frontend único, seguindo `tela-frontend`/`bet-frontend`/`hub-frontend`)

**Primary Dependencies**: stdlib `net/http` + mux por patterns (sem
framework, padrão de todo `-api` Go do repo); `keyfunc` para validação JWKS
do Cloudflare Access (mesma lib do `harness-api`/`bet-api`); cliente HTTP
próprio para a `domain-api` (`X-API-Key`), sem driver de banco nos 4 novos
serviços. Frontend: React + Vite + Tailwind (padrão `hub-frontend`), sem
framework de gráficos herdado — biblioteca de visualização a escolher na
fase de implementação, isolada atrás de um adapter para não travar a
identidade visual autoral do dashboard.

**Storage**: Nenhuma própria. Tudo passa pela `domain-api` → Postgres
compartilhado (schemas/tabelas novas: `contas`, `transacoes`, `ativos`,
`ativo_movimentos`, `cotacoes_cache`, `dashboard_layouts` — ver
[data-model.md](./data-model.md)), com `domain-worker` ganhando 4 novos
agregados (mesmo padrão de `cchroom`/`cchdeck`).

**Testing**: Go: `go test ./...` com `httptest` + Postgres via
testcontainers para os testes de integração dos novos agregados no
`domain-worker`/`domain-api` (mesmo padrão de `deal_test.go`/
`post_test.go`); testes de contrato HTTP por handler nos 4 módulos.
Frontend: sem suíte de testes automatizados hoje no repo para SPAs — este
projeto não introduz uma nova a menos que peça explicitamente na fase de
tasks; validação funcional via `quickstart.md`.

**Target Platform**: Linux (containers Docker na mesma VPS/rede
`network_docker_apps`), atrás do túnel Cloudflare + Cloudflare Access,
como todo app do repo.

**Project Type**: Web application — 1 frontend estático + 4 backends
containerizados, todos consumindo o serviço de domínio compartilhado.

**Performance Goals**: Compatível com SC-001/SC-002 (interações abaixo de
alguns segundos); sem meta de alta concorrência — uso pessoal, poucas
dezenas de requisições por minuto por usuário.

**Constraints**: Plano gratuito da brapi.dev tem limite de requisições —
cotações são cacheadas com TTL curto (minutos, não segundos) no
Asset Manager, nunca consultadas uma vez por ativo por request; atraso
tolerado de até 15 min (SC-004). Upload de imagem de comprovante fica
limitado em tamanho (poucos MB) e é armazenado como anexo da transação via
`domain-api`, sem infraestrutura de storage de objetos nova nesta fase.

**Scale/Scope**: Uso pessoal/poucos usuários (não multi-tenant B2B);
4 microsserviços novos + extensão de 1 serviço existente (domain-worker
e domain-api) + 1 frontend novo.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` ainda é o template não preenchido (sem
princípios ratificados neste repositório) — não há gates formais de
constituição a avaliar. Os únicos "gates" aplicáveis vêm das convenções já
estabelecidas no repo (ver `docs/novo-app-ci-cd.md` e os READMEs de
`domain-api`/`cch-api`/`bet-api`/`tela-frontend`), todas seguidas neste
plano:

- ✅ Nenhum serviço novo ganha driver de banco próprio — persistência via
  `domain-api` (pedido explícito do usuário).
- ✅ Autenticação via Cloudflare Access, mesmo modelo de `bet-api`/
  `harness-api` (JWT validado no próprio serviço, não só confiança cega no
  edge).
- ✅ Frontend estático espelhado em bucket, sem container (padrão
  `tela-frontend`).
- ✅ Segredos (token brapi.dev, chaves de API da domain-api, Access
  `aud`) só em Terraform/env — nunca hardcoded no código ou nos docs desta
  feature.

## Project Structure

### Documentation (this feature)

```text
specs/002-gestao-financeira-modular/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── domain-api-extensions.md
│   ├── contas-api.md
│   ├── transacional-api.md
│   ├── asset-manager-api.md
│   └── dashboard-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
modules/apps/
├── domain-api/                     # existente — ganha handlers/dto para os 4 novos agregados
│   └── internal/infrastructure/http/
│       ├── contahandlers.go        # novo
│       ├── transacaohandlers.go    # novo
│       ├── ativohandlers.go        # novo
│       └── dashboardlayouthandlers.go  # novo
├── domain-worker/                  # existente — ganha os 4 novos agregados (domain + application)
│   └── internal/
│       ├── domain/{conta,transacao,ativo,dashboardlayout}/
│       └── application/{conta,transacao,ativo,dashboardlayout}/
├── contas-api/                     # novo microsserviço (Go) — módulo Contas
│   ├── internal/httpapi/           # rotas REST + auth Cloudflare Access
│   ├── internal/domainapi/         # cliente da domain-api (sem driver de DB)
│   ├── Dockerfile
│   └── go.mod
├── transacional-api/               # novo microsserviço (Go) — módulo Transacional
│   ├── internal/httpapi/
│   ├── internal/domainapi/
│   ├── Dockerfile
│   └── go.mod
├── asset-manager-api/              # novo microsserviço (Go) — módulo Asset Manager
│   ├── internal/httpapi/
│   ├── internal/domainapi/
│   ├── internal/quotes/            # cliente brapi.dev + cache TTL
│   ├── Dockerfile
│   └── go.mod
├── dashboard-api/                  # novo microsserviço (Go) — módulo Dashboard
│   ├── internal/httpapi/
│   ├── internal/domainapi/
│   ├── Dockerfile
│   └── go.mod
└── financas-frontend/              # novo — SPA única (React + Vite + Tailwind)
    ├── src/
    │   ├── modules/contas/
    │   ├── modules/transacional/
    │   ├── modules/asset-manager/
    │   ├── modules/dashboard/
    │   └── lib/                    # clientes HTTP dos 4 backends, tema, auth
    ├── package.json
    └── vite.config.ts

modules/infra/terraform/
├── modules/compute/apps/{contas_api,transacional_api,asset_manager_api,dashboard_api}/
├── static_sites.tf                 # + entrada financas-frontend (bucket MinIO)
├── locals.tf                       # + 4 regras de ingress (portas novas)
├── secrets.tf                      # + chaves domain-api dos 4 módulos + token brapi.dev
└── main.tf                         # + registro dos 4 módulos compute
```

**Structure Decision**: Web application multi-serviço dentro do monorepo
existente (`modules/apps/*`), reaproveitando 100% da infraestrutura e
convenções já em produção (Cloudflare tunnel + Access, MinIO estático,
Postgres/Redis compartilhados via domain-api/domain-worker, CI/CD por
`go-ci-cd.yml`/`ts-frontend-ci-cd.yml`). Nenhuma opção alternativa
(monólito único, banco próprio por serviço) foi escolhida porque o pedido
do usuário fixa explicitamente "1 microsserviço por módulo" persistindo via
domain-api — a decisão de arquitetura já veio dada pelo escopo da feature,
não é uma escolha em aberto desta fase de planejamento.

## Complexity Tracking

> Nenhuma violação de constituição a justificar (constituição ainda não
> ratificada). A única complexidade real do plano — tocar dois serviços
> compartilhados (`domain-api` e `domain-worker`) para adicionar 4 famílias
> de agregados — é justificada pela própria exigência do usuário
> ("todos persistem dados usando o domain-api") e replica um padrão já
> comprovado em produção (`cchroom`/`cchdeck` para o `cch-api`), então não
> é uma complexidade nova a ser evitada, é o caminho pavimentado do repo.

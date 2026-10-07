# Implementation Plan: Prospecta

**Branch**: `feat/prospecta` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-prospecta/spec.md`

## Summary

Uma plataforma de **prospecção agêntica** para PMEs: a empresa cadastra o
negócio, descreve o ICP em linguagem natural, cria uma campanha e agentes de IA
buscam, qualificam, enriquecem e abordam prospects por e-mail e WhatsApp. O
output é pipeline (reunião agendada), não lista de leads.

Composição, seguindo à risca os padrões deste repositório:

- **`prospecta-agent-worker`** (Python 3.12, **sem porta, sem banco**) — o
  núcleo agêntico. Consome `ProspectRequested` e `evolution.messages.upsert`;
  orquestra os agentes (busca → qualificação → enriquecimento → redação); chama
  o **9router** para IA; envia pela **Evolution API**. Espelha
  `finance-customersupport-worker` (broker + HTTP tipado, zero driver de banco).
- **`prospecta-api`** (Go 1.25, 1 container, 1 host) — BFF/ACL: leitura síncrona
  (via par de domínio) e escrita como comando `202`. Sem banco, sem driver.
- **`domain-api` / `domain-worker`** (existentes, estendidos) — ganham os
  agregados `prospecta_*` e continuam sendo os **únicos escritores**. Nenhum
  driver de banco nos serviços novos.
- **`prospecta-frontend`** (React + Vite + TS + Tailwind, SPA estática em
  bucket, sem container) — implementa o design system do `poc.pen` (landing,
  design system, 5 telas, diagrama). Entra no hub como microfrontend.
- **`packages/prospecta-contracts`** — envelope + eventos `prospecta.*`
  (importado por `prospecta-api` e pelo worker, nunca copiado), no molde de
  `packages/finance-contracts`.

O design (`poc.pen`) é a fonte visual canônica — esta feature o **implementa**,
não o redesenha.

## Technical Context

**Language/Version**: Go 1.25 (`prospecta-api`, padrão `domain-api`/`clubs-api`)
+ Python 3.12 (`prospecta-agent-worker`, padrão
`finance-customersupport-worker`) + TypeScript/React 18 + Vite
(`prospecta-frontend`, padrão `hub-frontend`/`finance-frontend`).

**Primary Dependencies**:

- Go: stdlib `net/http` com mux por patterns (sem framework — padrão dos `-api`
  do repo); cliente HTTP próprio para o par de domínio com `X-API-Key`; sem
  driver de banco.
- Python: `pika`/`aio-pika` para AMQP (padrão do worker financeiro); `httpx`
  para 9router e Evolution; `pydantic` para contratos; `numpy`/`pgvector` só para
  embeddings via API. **Sem driver de banco.**
- Frontend: React + Vite + Tailwind; gráficos/ícones em SVG próprio (o
  design system do `poc.pen` já define o vocabulário — orb-lattice, dots, dark
  surfaces). Sem biblioteca de UI pronta.

**Storage**: Nenhuma própria. Tudo via par de domínio → Postgres compartilhado
(DB `domain`), schemas `prospecta_*` (§8 do spec), com **pgvector** para os
embeddings do ICP e **RLS** por `tenant_id`. O `domain-worker` ganha os
agregados correspondentes e o outbox durável.

**Testing**: `pytest-bdd` + testcontainers (Postgres, RabbitMQ, upstream HTTP
falso de Evolution/9router), conforme `.claude/skills/feature-first-tdd`. Go:
testes de integração `httptest` + testcontainers no molde de
`domain-worker/main_test.go`. `--cov-fail-under=90` por serviço Python.

**Target Platform**: Linux arm64 (VPS) — containers via Docker Compose,
gerenciados por **Dockhand** (stacks git-backed). SPA é build estático em bucket
MinIO, servido pelo ingress; não é container.

**Project Type**: múltiplos serviços — 1 SPA estática + 1 API Go + 1 worker
Python + extensões no par de domínio + 1 pacote de contratos.

**Performance Goals**: comando `202` em < 200 ms; primeira leitura do Cockpit
< 500 ms; um "run" de prospecção (buscar → qualificar → redigir N leads) em
minutos, assíncrono; SSE de atividade com latência < 1 s.

**Constraints**: nenhum serviço novo com `DATABASE_URL`; toda IA pelo 9router;
todo WhatsApp pela Evolution; toda escrita via comando `202`; nada de broker
próprio; rede externa `apps`; sem segredo em env de build do frontend.

**Scale/Scope**: multi-tenant por `tenant_id`; MVP mira dezenas de PMEs e
milhares de leads/dia; densidade **airy** na UI (design system "2027").

## Constitution Check

_Gate: aprovado antes da Phase 0 e re-checado após Phase 1._

- **Isolamento de domínio (§1.1):** ✅ nenhum serviço novo toca banco; só o par
  de domínio escreve.
- **Reuso do CQRS da casa:** ✅ comando `202` + worker escritor + outbox.
- **Reuso de infra existente:** ✅ 9router (IA) e Evolution (WhatsApp) por
  adapter; RabbitMQ/Postgres/MinIO/ingress reusados. Nada inventado.
- **Feature-first TDD:** ✅ §10 do spec; `.feature` primeiro, testcontainers.
- **Deploy-replace (`docs/novo-app-ci-cd.md` §6):** ✅ cada app novo entra no
  `case` do `-replace` e é conferido por `curl`, não pelo check verde.
- **Telemetria:** ✅ OTLP para `alloy:4318`, `OTEL_SERVICE_NAME` por serviço.

## Project Structure

### Documentation (this feature)

```
specs/004-prospecta/
├── spec.md            # especificação (produto + arquitetura + contratos)
├── plan.md            # este arquivo
├── research.md        # pesquisas (agentes, tools, dedup, LGPD)
├── data-model.md      # schema prospecta_* + eventos
├── quickstart.md      # como rodar e validar de ponta a ponta
├── contracts/         # contratos por serviço
│   ├── prospecta-api.md
│   ├── prospecta-agent-worker.md
│   └── domain-api-extensions.md
├── checklists/
│   └── requirements.md
└── tasks.md           # lista de tarefas multi-agente
```

### Source Code (repository root)

```
modules/apps/
├── prospecta-api/                 # Go 1.25 — BFF/ACL, 1 host (porta 8022)
│   ├── go.mod
│   ├── Dockerfile
│   ├── main.go
│   ├── internal/
│   │   ├── domain/                # entidades/regras do contexto
│   │   ├── application/           # casos de uso (leitura + comando)
│   │   └── infrastructure/        # cliente do par de domínio, publisher AMQP
│   └── tests/features/            # .feature + steps
├── prospecta-agent-worker/        # Python 3.12 — sem porta, sem banco
│   ├── pyproject.toml             # hatchling, packages = ["src/prospecta_agent_worker"]
│   ├── Dockerfile
│   └── src/prospecta_agent_worker/
│       ├── main.py                # bootstrap (env obrigatórias, conexões)
│       ├── consumers/             # evolution.py · domain_events.py
│       ├── gateway/               # evolution.py (sendText) · ninerouter.py (chat)
│       ├── agents/                # orchestrator · tools · memory · guardrails
│       └── tests/features/
├── prospecta-frontend/            # React+Vite+TS — SPA estática (bucket)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
└── domain-api/ · domain-worker/   # (existentes) ganham agregados prospecta_*

packages/
└── prospecta-contracts/           # envelope + eventos prospecta.* (Python)

modules/infra/terraform/
├── modules/compute/apps/prospecta_api/
├── modules/static_sites.tf         # bucket prospecta-frontend
├── main.tf                         # module "compute_apps_prospecta_api"
├── locals.tf                       # ingress prospecta*.giomartins.dev
└── variables.tf                    # excluded_hostnames (SPA)

.github/workflows/
├── go-ci-cd.yml                    # prospecta-api (auto-descoberto por go.mod)
├── python-ci-cd.yml                # prospecta-agent-worker (por pyproject.toml)
└── ts-frontend-ci-cd.yml           # prospecta-frontend (ALLOWED_APPS + paths)
```

**Structure Decision**: segue `docs/architecture.md` + `docs/novo-app-ci-cd.md`.
`prospecta-api` e `prospecta-agent-worker` são **independentes** (nenhum pacote
compartilhado entre eles exceto `prospecta-contracts`), espelhando a relação
`finance-api` ↔ `finance-customersupport-worker`.

## Portas e hostnames reservados

| Recurso | Valor | Situação |
| --- | --- | --- |
| `prospecta-api.giomartins.dev` | porta **8022** | próxima livre (8000 domain, 8007 tela, 8017 clubs) |
| `prospecta-agent-worker` | **sem porta, sem hostname** | padrão dos workers |
| `prospecta.giomartins.dev` | bucket `prospecta-frontend` | SPA estática, sem porta |
| RabbitMQ | exchange `domain.events` + fila `evolution.messages.upsert` | reusa `persistence` |
| 9router | `https://ai.giomartins.dev/v1` | reusa stack `compute` |
| Evolution | `POST /message/sendText/{instance}` | reusa stack `compute` |

## Fases de entrega

0. **Pesquisa** (`research.md`) — orquestração de agentes, tools de busca/enrich,
   dedup de leads, política LGPD, contrato do 9router.
1. **Setup & infra** — 3 apps scaffolados, Terraform, pipelines,
   `-replace`, contratos. Deploy "existe" ao fim.
2. **Prospecta US1 — Empresa + ICP** — cadastro e definição de ICP (leitura +
   comando `202`).
3. **Prospecta US2 — Campanha + Agente busca** — criar campanha, disparar,
   agente encontra e qualifica leads.
4. **Prospecta US3 — Abordagem (e-mail/WhatsApp)** — redigir, aprovar, enviar
   pela Evolution; inbox de conversas.
5. **Prospecta US4 — Cockpit & atividade** — pipeline, métricas, feed ao vivo
   (SSE), config/agentes.
6. **Hardening** — guardrails LGPD, observabilidade, carga, docs.

Cada user story é entregável e testável de forma independente via
`quickstart.md`.

## Complexity Tracking

| Violação potencial | Por que é necessário | Alternativa simples rejeitada |
| --- | --- | --- |
| Worker Python **sem porta** | é o desenho do worker financeiro; agente é reativo a eventos | expor HTTP — quebraria o padrão e o isolamento |
| Estender `domain-*` em vez de banco próprio | regra de isolamento §1.1; reuso do CQRS | DB próprio = segundo CQRS, rejeitado |
| Sem lib de gráficos/UI no front | o design system é autoral (orbs/dots) | lib de UI brigaria com o design |

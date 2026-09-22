# Implementation Plan: FC Clubs Hub

**Branch**: `003-fc-clubs-hub` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-fc-clubs-hub/spec.md`

## Summary

Um hub público de Pro Clubs (EA Sports FC 27): rankings globais de clubes e
jogadores, perfis de clube/jogador/partida, e — a parte que justifica o produto
— o histórico que a EA não guarda (evolução de nível, mudanças de divisão,
recordes, retrospecto direto). Tudo visível sem login.

Login é opt-in e serve para o hub descobrir e sincronizar os clubes da pessoa,
os rivais deles e os rivais dos rivais, em segundo plano, sem bloquear a
navegação. Uma área de administração concentra o conteúdo técnico (estado da
integração, cache, histórico, experimentos, ADRs) que nunca aparece para o
usuário comum.

Composição, seguindo à risca os padrões do repositório:

- **`clubs-ingest`** (worker Python, sem banco, sem host) — traz da origem e
  normaliza; grava via `domain-api`. Python porque o CDN da origem bloqueia
  requisições não-navegador e o client que resolve isso já existe.
- **`domain-api`/`domain-worker`** (existentes, estendidos) — ganham 5 agregados
  (`clube`, `clube_totais`, `partida`, `linha_partida`, `snapshot`/`mudanca_divisao`)
  mais `anuncio` e as preferências por usuário. **Nenhum driver de banco nos
  serviços novos** — é o padrão de `cch-api` e dos módulos de finanças.
- **`clubs-api`** (Go, container, 1 host) — BFF de leitura: rotas públicas sem
  identidade e rotas pessoais atrás de um escopo de caminho, no desenho de
  `bet-api` (público no hostname, SSO só em `/api`).
- **`clubs-frontend`** (React+Vite+TS+Tailwind, SPA estática em bucket, sem
  container) — implementa o design system já produzido (`ui.pen`: 56
  componentes, 26 telas, tema claro e escuro). Entra no hub como microfrontend.

O design system é a fonte visual canônica — esta feature o **implementa**, não o
redesenha.

## Technical Context

**Language/Version**: Go 1.25 (`clubs-api`, seguindo `cch-api`/`domain-api`) +
Python 3.12 (`clubs-ingest`, seguindo `pld-scraper`) + TypeScript/React 18 + Vite
(SPA, seguindo `tela-frontend`/`hub-frontend`)

**Primary Dependencies**: stdlib `net/http` com mux por patterns (sem framework,
padrão de todo `-api` Go do repo); `keyfunc` para validação do token do provedor
de identidade (mesma lib de `bet-api`/`harness-api`); cliente HTTP próprio para a
`domain-api` com `X-API-Key`, sem driver de banco no `clubs-api`. Python: `pandas`
(única dependência do client vendorizado) + o pacote de telemetria dos workers.
Frontend: React + Vite + Tailwind (padrão `hub-frontend`); gráficos em SVG
próprio — o protótipo já tem os seis tipos que precisamos (linha, barra, radar,
rosca, dispersão, sparkline) implementados à mão, e trazer uma biblioteca de
gráficos significaria lutar contra ela para reproduzir o design autoral.

**Storage**: Nenhuma própria. Tudo via `domain-api` → Postgres compartilhado
(tabelas novas: `clubs`, `clubs_totais`, `clubs_matches`, `clubs_match_players`,
`clubs_snapshots`, `clubs_division_changes`, `clubs_announcements`,
`clubs_preferences`, `clubs_claimed_pros` — ver [data-model.md](./data-model.md)),
com o `domain-worker` ganhando os agregados correspondentes (mesmo padrão de
`cchroom`/`conta`).

**Testing**: Go — `go test ./...` com `httptest` por handler + Postgres via
testcontainers para os agregados novos no `domain-worker`/`domain-api` (mesmo
padrão de `deal_test.go`/`post_test.go`). Python — `pytest` sobre o **mapeamento**
com as fixtures da origem, exatamente `pld-scraper` (`tests/test_pld_mapping.py`);
as fixtures do client original já existem e são incorporadas junto. Frontend —
sem suíte nova: o repositório não tem testes de SPA hoje e esta feature não
introduz essa convenção; validação funcional por `quickstart.md`.

**Target Platform**: Linux (containers Docker na mesma VPS/rede
`network_docker_apps`) atrás do túnel e do Access, como todo app do repo. A SPA
não roda como container — build estático espelhado no MinIO.

**Project Type**: Web application — 1 SPA estática + 1 backend containerizado +
1 worker containerizado (sem host), todos consumindo o serviço de domínio
compartilhado.

**Performance Goals**: SC-002 (home abaixo de 2s, troca de ranking abaixo de 1s).
Sem meta de alta concorrência — comunidade pequena, dezenas de clubes, poucas
requisições por minuto por visita.

**Constraints**:

- A origem entrega **apenas o estado atual + ~10 partidas por tipo**. Todo
  histórico é construído por leituras acumuladas — o produto começa sem
  histórico e as telas precisam degradar bem (ADR #1).
- A origem não tem contrato; o CDN bloqueia requisições não-navegador. Daí o
  worker ser Python com o client que já resolve isso (ADR #4).
- Rate-limit obrigatório por tipo de consulta — a origem é pública e consultar
  tudo a cada ciclo é a via mais rápida para o bloqueio.
- Sem login, "meus clubes" não existe. É consequência do desenho (público com
  login opt-in), não um defeito — precisa estar explícito no quickstart.

**Scale/Scope**: Comunidade pequena (dezenas de clubes acompanhados, centenas de
jogadores no índice). 1 serviço Go novo + 1 worker Python novo + 1 SPA nova +
extensão de 2 serviços existentes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` é o template não preenchido (sem princípios
ratificados neste repositório) — não há gates formais a avaliar. Os "gates"
aplicáveis vêm das convenções estabelecidas em `docs/novo-app-ci-cd.md` e nos
READMEs de `cch-api`/`bet-api`/`pld-scraper`/`tela-frontend`. Todos seguidos:

- ✅ Nenhum serviço novo ganha driver de banco — persistência via `domain-api`
  (decisão confirmada do dono do produto).
- ✅ Worker Python entra pelo `python-ci-cd.yml`, auto-descoberto por
  `pyproject.toml`, build context na raiz do repo — padrão `pld-scraper`.
- ✅ Worker sem host/ingress, como todo worker do repo.
- ✅ Escrita de alto volume (snapshot) usa o caminho assíncrono `202`; o resto
  usa `/sync` — a mesma regra de escolha documentada em `cch-api`/`financas`.
- ✅ Frontend estático espelhado em bucket, sem container — padrão
  `tela-frontend`.
- ✅ Entra no hub como microfrontend: hostname público em `excluded_hostnames`,
  login opt-in por escopo de caminho (`path_protected_hostnames`), exatamente o
  desenho de `bet`/`hub`.
- ✅ Telemetria desde o primeiro deploy (`OTEL_*` wired no módulo Terraform).
- ✅ **A linha do `-replace` está nas tasks de setup** — é o passo que, faltando,
  dá deploy verde sem trocar nada (já mordeu o `tela-api` duas vezes).
- ✅ Segredos (chave do worker para a `domain-api`, canal de notificação) só em
  Terraform/Vaultwarden — nada em texto claro, nada no repositório público.
- ✅ Client de terceiro vendorizado com `LICENSE` e atribuição preservados.

**Pós-desenho (re-check)**: o desenho final mantém todos os gates. Um ponto de
atenção surgiu e foi resolvido: o `clubs-ingest` **precisa de chave própria**
para a `domain-api` (não pode compartilhar a da `clubs-api`), porque o log de
auditoria precisa distinguir escrita de worker e de BFF — está como T-setup.

## Project Structure

### Documentation (this feature)

```text
specs/003-fc-clubs-hub/
├── plan.md              # This file
├── spec.md              # user stories, FRs, edge cases, success criteria
├── research.md          # Phase 0 — as 5 decisões estruturais + ADRs herdados
├── data-model.md        # Phase 1 — agregados e relacionamentos
├── quickstart.md        # Phase 1 — validação ponta a ponta
├── contracts/
│   ├── domain-api-extensions.md
│   ├── clubs-api.md
│   └── clubs-ingest.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
modules/apps/
├── domain-api/                     # existente — ganha handlers/dto dos agregados novos
│   └── internal/
│       ├── application/{clube,partida,snapshot,preferencia,anuncio}/
│       └── infrastructure/postgres/{clube,partida,snapshot,preferencia,anuncio}_repository.go
├── domain-worker/                  # existente — ganha os agregados e as migrations
│   └── internal/
│       ├── domain/{clube,partida,snapshot,preferencia,anuncio}/
│       └── infrastructure/postgres/schema.sql   # arquivo único idempotente
│
├── clubs-api/                      # NOVO — Go, container, 1 host
│   ├── go.mod
│   ├── Dockerfile
│   ├── main.go
│   └── internal/
│       ├── httpapi/{public.go,personal.go,auth.go,server.go}
│       ├── domainclient/           # cliente HTTP da domain-api
│       └── telemetry/
│
├── clubs-ingest/                   # NOVO — Python, container, SEM host
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── src/
│   │   ├── clubs_ingest/{main.py,cycle.py,normalize.py,client.py,anuncios.py}
│   │   └── fc27_api.py             # vendorizado (MIT, com atribuição)
│   │   └── LICENSE.fc27            # licença original do client
│   └── tests/
│       ├── fixtures/               # respostas reais anonimizadas
│       └── test_normalize.py
│
└── clubs-frontend/                 # NOVO — React+Vite+TS+Tailwind, sem container
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── src/
    │   ├── main.tsx / App.tsx / index.css    # tokens dos dois temas
    │   ├── lib/{api.ts,auth.ts,useSync.ts,format.ts}
    │   ├── components/ui/          # os 56 componentes do design system
    │   ├── components/charts/      # os 6 gráficos em SVG
    │   └── pages/{Home,Clubes,Clube,Partida,Jogador,MinhaArea,Notificacoes,Admin}.tsx
    └── design/                     # ui.pen versionado; PNGs no .gitignore

modules/infra/terraform/
├── modules/compute/apps/clubs_api/     # NOVO
├── modules/compute/apps/clubs_ingest/  # NOVO (sem ports/ingress)
├── main.tf                             # registra os 2 módulos
├── locals.tf                           # ingress de clubs-api; static_site do frontend
├── secrets.tf                          # 2 chaves novas da domain-api
└── variables.tf                        # clubs/clubs-api em excluded_hostnames

.github/workflows/
├── go-ci-cd.yml                # + linha do -replace de clubs-api
├── python-ci-cd.yml            # + linha do -replace de clubs-ingest
└── ts-frontend-ci-cd.yml       # + clubs-frontend no ALLOWED_APPS

.specify/feature.json           # aponta para specs/003-fc-clubs-hub
```

## Ordem de execução

As fases do `tasks.md` seguem a dependência real: **nada de UI antes de haver
dado**, e **nada de dado antes do schema**. Setup → Fundamentos (domain-api) →
Ingest → API pública + Home → telas de detalhe → login/sync → notificações/admin
→ polish.

O caminho crítico para "sair do papel" é: **Fase 1 + Fase 2 + Fase 3 + Fase 4**.
É o que faz o site existir com dado real.

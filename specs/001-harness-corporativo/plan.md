# Implementation Plan: Harness Corporativo — Sessões de Handoff de Implementação

**Branch**: `001-harness-corporativo` | **Date**: 2026-09-11 | **Spec**: [specs/001-harness-corporativo/spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-harness-corporativo/spec.md`

## Summary

Web app interno para o time iniciar **sessões de implementação** (objetivo + contexto em markdown), **retomar** sessões de outras pessoas (a "baton" — dono atual — muda de mão com registro na timeline) e **estender** (ramificar herdando contexto). Par de apps no padrão do repo: `harness-api` (Go, stdlib mux, SQLite pure-Go, JWT do Cloudflare Access validado na API) + `harness-frontend` (SPA estática React/Vite em bucket MinIO), deploy no VPS atrás do Access via Terraform + pipelines existentes.

## Technical Context

**Language/Version**: Go 1.25 (API, módulo `github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api`) + TypeScript/React 19 + Vite 6 (SPA)

**Primary Dependencies**: stdlib `net/http` (mux com patterns); `modernc.org/sqlite` (pure Go — build `CGO_ENABLED=0` distroless); `golang-jwt/jwt/v5` + `MicahParks/keyfunc/v3` (JWKS do Access); frontend: `react-markdown` (renderização segura), Vite dev proxy

**Storage**: SQLite (arquivo em volume docker `/data`); tabelas `sessoes`, `eventos` (append-only), `usuarios` (cache de identidade)

**Testing**: `go test ./...` (handlers via `httptest` + store); `npm run build` (typecheck) no frontend

**Target Platform**: Linux VPS (docker via Terraform, porta 8010) + browsers desktop/mobile (SPA estática no MinIO atrás do nginx ingress)

**Project Type**: web app (API + SPA estática), app pair em `modules/apps/`

**Performance Goals**: trivial para o caso de uso (time interno, dezenas de usuários): p95 < 200ms por request de API

**Constraints**: toda rota atrás do Cloudflare Access (JWT `Cf-Access-Jwt-Assertion` validado com issuer/aud do app); `CGO_ENABLED=0` obrigatório no build docker; frontend nunca faz redirect automático no hostname (iframe-friendly p/ hub)

**Scale/Scope**: MVP — ~8 endpoints, 3 tabelas, 4 rotas de SPA; sessões e timeline completas; sem notificações, busca textual ou permissões por sessão (fase seguinte)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` está como template **não ratificado** (placeholders, sem princípios definidos) — não há gates bloqueantes nesta fase. Princípios adotados no lugar (alinhados à prática do repo):

1. **Simplicidade/YAGNI** — stdlib sobre frameworks (D1), SQLite sobre Postgres (D2), sem permissões/notificações no MVP ✅
2. **Convenção do repo sobre preferência** — espelhar cch-api (estrutura Go), bet-api (auth Access), bet/cch-frontend (SPA estática) ✅
3. **Um app por pasta, deployment independente** — `modules/apps/harness-{api,frontend}` nos pipelines existentes ✅

**Re-check pós-design (Phase 1)**: design mantém os três — data-model tem 3 tabelas sem over-modeling; contracts usam exatamente os padrões dos apps existentes; nenhuma violação a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/001-harness-corporativo/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Phase 0 — decisões D1–D8
├── data-model.md        # Phase 1 — sessoes, eventos, usuarios
├── contracts/
│   └── api.md           # Phase 1 — contrato HTTP + rotas da SPA
├── quickstart.md        # Phase 1 — cenários de validação E2E
└── tasks.md             # Phase 2 (/speckit-tasks — não gerado aqui)
```

### Source Code (repository root)

```text
modules/apps/harness-api/          # NOVO — Go API (auto-descoberta go-ci-cd)
├── main.go                        # env vars, build do Server, http.Server + shutdown
├── go.mod
├── Dockerfile                     # golang:1.25-alpine, CGO_ENABLED=0, distroless (cópia cch-api)
├── .dockerignore
└── internal/
    ├── httpapi/                   # server.go (rotas), auth.go (JWT Access + bypass dev),
    │                              # sessoes.go (handlers), helpers (writeJSON/decodeJSON/erros)
    └── store/                     # sqlite.go (modernc.org/sqlite + migrations), sessoes.go, eventos.go

modules/apps/harness-frontend/     # NOVO — SPA estática (pipeline ts-frontend)
├── package.json / vite.config.ts  # alias @, dev proxy /api → :8010, VITE_HARNESS_API_URL
├── index.html
└── src/
    ├── App.tsx                    # roteamento simples (sem lib de router): lista, nova, detalhe
    ├── lib/api.ts                 # fetch com credentials:"include" + probe /api/me
    ├── lib/auth.ts                # probe + hop /api/sso (top-level navigation)
    ├── components/                # MarkdownView (react-markdown), Timeline, SessionCard, StatusBadge
    └── pages/                     # ListaSessoes, NovaSessao (incl. extensão), PaginaSessao

modules/infra/terraform/           # ALTERAR
├── locals.tf                      # services (harness-api → 8010), static_sites (harness-frontend),
│                                  # path_protected_hostnames (+/api)
├── variables.tf                   # excluded_hostnames (+ harness-api bare, harness-frontend)
├── main.tf                        # module "compute_apps_harness_api"
└── compute/apps/harness-api/      # main/variables/versions/outputs.tf — bet_api shape + volume /data

.github/workflows/                 # ALTERAR
├── go-ci-cd.yml                   # case do -replace (+ docker_container.harness_api)
└── ts-frontend-ci-cd.yml          # ALLOWED_APPS, push.paths, VITE_HARNESS_API_URL
```

**Structure Decision**: par API+SPA no padrão bet (auth Access validada na API + hop `/api/sso`), API Go no padrão cch (stdlib + internal/), SPA estática sem container no padrão dos 5 frontends existentes. Base em `research.md` D1–D8.

## Complexity Tracking

> Vazio — nenhuma violação de constituição a justificar (ver Constitution Check).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
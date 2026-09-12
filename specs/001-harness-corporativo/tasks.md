---

description: "Task list para o Harness Corporativo (specs/001-harness-corporativo)"
---

# Tasks: Harness Corporativo — Sessões de Handoff de Implementação

**Input**: Design documents from `/specs/001-harness-corporativo/`

**Prerequisites**: plan.md, spec.md, research.md (decisões D1–D8), data-model.md, contracts/api.md, quickstart.md

**Tests**: inclusos por história porque o pipeline `go-ci-cd` roda `go test` em CI (build sem testes não mergeia) — handler tests via `httptest`. Frontend: sem vitest no MVP; validação por `npm run build` (typecheck) + cenários do quickstart.md.

**Organization**: tarefas por user story para permitir implementação e teste independentes. Caminhos relativos à raiz do repo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência incompleta)
- **[Story]**: user story da spec.md (US1–US5)

## Path Conventions

App pair no padrão do repo: `modules/apps/harness-api/` (Go) e `modules/apps/harness-frontend/` (SPA Vite); mudanças de infra em `modules/infra/terraform/` e `.github/workflows/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: esqueleto dos dois apps compilando e servindo algo

- [X] T001 Criar esqueleto do `modules/apps/harness-api/`: `go.mod` (módulo `github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api`, go 1.25, deps `modernc.org/sqlite`, `github.com/golang-jwt/jwt/v5`, `github.com/MicahParks/keyfunc/v3`), `main.go` no formato cch-api (helper `env(key, fallback)` lendo: `BIND_HOST`, `PORT` default `8010`, `HARNESS_DB_PATH` default `/data/harness.db`, timeouts e shutdown graceful SIGINT/SIGTERM), `Dockerfile` idêntico ao `modules/apps/cch-api/Dockerfile` (`golang:1.25-alpine`, `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`, `gcr.io/distroless/static-debian12:nonroot`) e `.dockerignore`
- [X] T002 [P] Criar esqueleto do `modules/apps/harness-frontend/` copiando a forma de `modules/apps/cch-frontend/`: `package.json` (react 19, vite 6, typescript 5, `react-markdown`), `vite.config.ts` (alias `@`→`src`, dev proxy `/api` → `http://localhost:8010`, `import.meta.env.VITE_HARNESS_API_URL`), `tsconfig.json`, `index.html`, `src/main.tsx` — `npm install` passando
- [X] T003 [P] Shell da SPA em `modules/apps/harness-frontend/src/App.tsx`: roteamento por `window.location.pathname` sem lib (`/` lista, `/sessoes/nova` form, `/sessoes/{id}` detalhe), estados loading/erro, CSS base limpo e responsivo (mobile-first, FR-014)

**Checkpoint**: `go build ./...` passa na API; `npm run build` passa no frontend.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: store, auth e núcleo HTTP que TODA user story consome

**⚠️ CRITICAL**: nenhuma user story começa antes disto

- [X] T004 Store SQLite em `modules/apps/harness-api/internal/store/sqlite.go`: abrir `modernc.org/sqlite` no `HARNESS_DB_PATH` (mkdir do diretório), migrations embutidas criando exatamente as 3 tabelas e índices do `data-model.md` — `sessoes` (`id` INTEGER PK AUTOINCREMENT; `titulo` TEXT NOT NULL **1–200 chars, trim**; `objetivo` TEXT NOT NULL **1–5.000 chars**; `repo` TEXT NULL **≤200**; `contexto_md` TEXT NULL **≤65.536 bytes**; `proximos_passos_md` TEXT NULL **≤16.384 bytes**; `status` TEXT NOT NULL CHECK `em_andamento|entregue|arquivada` default `em_andamento`; `criador_email`/`dono_atual_email` TEXT NOT NULL; `pr_link` TEXT NULL **≤500**; `origem_id` INTEGER NULL FK; `criado_em`/`atualizado_em` INTEGER unix-seconds), `eventos` (append-only, `tipo` CHECK `criacao|retomada|atualizacao_contexto|extensao_criada|status_mudou`, `payload` JSON text, FK ON DELETE CASCADE, índice `sessao_id,criado_em`), `usuarios` (`email` PK, `nome`, `ultima_visita`) — índices de `sessoes`: `status`, `dono_atual_email`, `origem_id`, `atualizado_em DESC`; FKs e `PRAGMA foreign_keys=ON`
- [X] T005 [P] Auth em `modules/apps/harness-api/internal/httpapi/auth.go` (research D3): middleware que lê `Cf-Access-Jwt-Assertion`, valida via `keyfunc` (JWKS `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), issuer `HARNESS_ACCESS_ISSUER` (`https://<team>.cloudflareaccess.com`), audience `HARNESS_ACCESS_AUD`, allowlist `HARNESS_ALLOWED_EMAILS` (csv, defesa extra) → `401 nao_autenticado`; claims `email`+`name` viram `Identity{Email,Nome}` no request context; bypass dev quando `HARNESS_DEV_BYPASS_AUTH=1` usa `HARNESS_DEV_USER_EMAIL`/`HARNESS_DEV_USER_NOME`; middleware faz upsert na tabela `usuarios` (email, nome, ultima_visita)
- [X] T006 Núcleo HTTP em `modules/apps/harness-api/internal/httpapi/server.go`: struct `Server{store, cfg}`, mux com patterns, helper `cors` (origens de `HARNESS_FRONTEND_ORIGINS`, methods/headers, resposta a OPTIONS/preflight), helpers `writeJSON`/`decodeJSON`/`writeError` com o corpo de erro do contrato (`{"erro":{"codigo","mensagem"}}` e `detalhes` em 422); rotas `GET /api/health` (sem auth), `GET /api/me` (identidade do context), `GET /api/sso` (302 para `?return=` só se origem ∈ allowlist, senão `422`); `main.go` conecta store+server e registra tudo sob o middleware
- [X] T007 [P] Cliente da API no frontend: `modules/apps/harness-frontend/src/lib/api.ts` (fetch com `credentials:"include"`, baseURL `VITE_HARNESS_API_URL` vazio local = relativo, parse do corpo de erro padrão, tipos TS dos endpoints de `contracts/api.md`) e `src/lib/auth.ts` (probe `fetch("/api/me",{redirect:"manual"})` → 200 logado; senão `window.top.location.href = "<api>/api/sso?return=" + location.origin`)

**Checkpoint**: `HARNESS_DEV_BYPASS_AUTH=1 go run .` → `GET /api/health` 200, `GET /api/me` devolve o usuário dev, `GET /api/sso` valida origem; SPA carrega shell e o probe funciona.

---

## Phase 3: User Story 1 — Dev inicia uma sessão de implementação (Priority: P1) 🎯 MVP

**Goal**: dev cria sessão com título/objetivo/contexto e todo o time a vê na lista com autor, status e dono

**Independent Test** (quickstart §1): criar sessão preenchida → aparece na lista do time com autor/status/dono corretos; sem título ou objetivo → recusa

### Implementation for User Story 1

- [X] T008 [US1] Store de sessões em `modules/apps/harness-api/internal/store/sessoes.go`: `CreateSessao` (validações dos limites do T004, `dono_atual_email = criador_email`, registra evento `criacao` com payload `{"titulo":...}`), `GetSessao`, `ListSessoes` (orden fixa: `em_andamento` primeiro, depois `atualizado_em DESC`)
- [X] T009 [P] [US1] Timeline em `modules/apps/harness-api/internal/store/eventos.go`: `InsertEvento(sessaoID, tipo, autor, payload)` e `ListEventos(sessaoID)` ascendente
- [X] T010 [US1] Handlers em `modules/apps/harness-api/internal/httpapi/sessoes.go` conforme `contracts/api.md`: `POST /api/sessoes` (422 `validacao` com `detalhes[{campo,problema}]` para título/objetivo ausentes e limites estourados), `GET /api/sessoes` (base de query `status`/`dono`/`origem` aceitos mas sem uso obrigatório ainda), `GET /api/sessoes/{id}` (`404 nao_encontrado`), `GET /api/sessoes/{id}/eventos`
- [X] T011 [US1] Página de lista em `modules/apps/harness-frontend/src/pages/ListaSessoes.tsx`: cards com título, repo, `resumo_objetivo`, StatusBadge, dono atual (nome via `usuarios` cache) e "última atualização" relativa, ordenação da API
- [X] T012 [US1] Form de criação em `modules/apps/harness-frontend/src/pages/NovaSessao.tsx`: título+objetivo required com validação client-side, contexto/próximos passos como textareas markdown, **rascunho preservado em localStorage** e restaurado ao voltar (edge case da spec), submit → `POST /api/sessoes` → navega para `/sessoes/{id}`
- [X] T013 [US1] Página da sessão (leitura) em `modules/apps/harness-frontend/src/pages/PaginaSessao.tsx`: objetivo, **dono atual em destaque** (FR-012), contexto e próximos passos via componente `src/components/MarkdownView.tsx` (react-markdown, sem HTML cru — FR-011; links com `target="_blank" rel="noopener noreferrer"`), timeline `src/components/Timeline.tsx` consumindo `/eventos` com autor e payload legível
- [X] T014 [US1] Testes handler em `modules/apps/harness-api/internal/httpapi/sessoes_test.go` (httptest + SQLite temporário): criação válida retorna 201 com dono=criador; sem título/objetivo → 422 com detalhes; contexto > 64KB → 422; lista ordenada com ativas primeiro; GET inexistente → 404; timeline contém `criacao`

**Checkpoint**: US1 completa e testável isolada (quickstart §1) — **MVP utilizável**

---

## Phase 4: User Story 2 — Dev retoma a sessão de outra pessoa (Priority: P1)

**Goal**: B assume a baton de A; edição de contexto/próximos passos registra na timeline; conflito concorrente avisado

**Independent Test** (quickstart §2–§3): B retoma → dono muda + evento; A recarrega e vê B como dono; edições simultâneas → 409 com opção de sobrescrever

### Implementation for User Story 2

- [X] T015 [US2] Store em `modules/apps/harness-api/internal/store/sessoes.go`: `RetomarSessao(id, novoDono)` — atualiza `dono_atual_email`, evento `retomada` payload `{"dono_anterior","dono_novo"}`, **idempotente** (mesmo dono → sem mudança e sem evento); `UpdateConteudo(id, campos, baseAtualizadoEm, force)` — concorrência otimista do data-model: se `base_atualizado_em != atualizado_em` e `!force` → retorno de conflito com estado vigente; em sucesso atualiza campos+`atualizado_em` e registra `atualizacao_contexto` payload `{"campos":[...],"force":bool}`
- [X] T016 [US2] Handlers: `POST /api/sessoes/{id}/retomar` (corpo vazio, 200 idempotente) e `PATCH /api/sessoes/{id}` (409 `conflito` **incluindo `sessao` com o estado vigente** no corpo, conforme contrato) em `modules/apps/harness-api/internal/httpapi/sessoes.go`
- [X] T017 [US2] Frontend da retomada: botão **Retomar** na `PaginaSessao.tsx` (chama `/retomar` e recarrega); modo edição de contexto/próximos passos (textareas sobre o `atualizado_em` visto); ao receber 409 → diálogo "conteúdo mudou desde a abertura — sobrescrever?" que refaz o PATCH com `force:true` mostrando o conteúdo vigente; rascunho em localStorage durante edição
- [X] T018 [US2] Testes em `modules/apps/harness-api/internal/httpapi/sessoes_test.go`: retomada por outro usuário troca dono + evento; segunda retomada do mesmo dono não duplica evento; PATCH desatualizado → 409 com sessão vigente; PATCH com `force:true` sobrescreve e registra `force` no payload

**Checkpoint**: US1+US2 independentes (quickstart §2–§3) — **o handoff funciona**

---

## Phase 5: User Story 3 — O time acompanha as sessões (Priority: P2)

**Goal**: qualquer pessoa autenticada vê a lista completa com filtros; leitura nunca bloqueada

**Independent Test** (quickstart + US-3): dev que não criou nada lista/abre/filtra sessões de outros sem convite

### Implementation for User Story 3

- [X] T019 [US3] Filtros e destaque na lista: `modules/apps/harness-frontend/src/pages/ListaSessoes.tsx` ganha filtros por `status` (multi: em andamento/entregue/arquivada) e por dono atual (select populado com `usuarios`), ativas em destaque visual no topo, estado vazio orientado à ação ("iniciar primeira sessão"); leitura de sessão de outro usuário sem qualquer bloqueio (US-3, aceite 3)
- [X] T020 [P] [US3] Testes dos filtros em `modules/apps/harness-api/internal/httpapi/sessoes_test.go`: `?status=entregue` só entrega; `?dono=<email>` só do dono; combinação `status`+`dono`; ordenação preservada dentro do filtro

**Checkpoint**: US1–US3 independentes — compartilhamento do time funcionando

---

## Phase 6: User Story 4 — Dev estende uma sessão (ramificação) (Priority: P2)

**Goal**: extensão herda contexto da origem, link bidirecional, edição independente

**Independent Test** (quickstart §4): estender S → nova sessão com contexto copiado e dono próprio; S lista a extensão; editar E não muda S

### Implementation for User Story 4

- [X] T021 [US4] Store da extensão em `modules/apps/harness-api/internal/store/sessoes.go`: `CreateSessao` com `origem_id` preenchido **copia `contexto_md` e `proximos_passos_md` da origem** (campos do body sobrescrevem a cópia), dono = criador da extensão; registra `criacao` na filha e `extensao_criada` payload `{"extensao_id","titulo"}` na **origem**; `GetSessao` retorna também `origem` (resumo) e `extensoes` (resumo das filhas) conforme contrato
- [X] T022 [US4] Handlers: `POST /api/sessoes` aceita `origem_id` (422 `validacao` se origem inexistente) e `GET /api/sessoes/{id}` inclui `origem`/`extensoes` — em `modules/apps/harness-api/internal/httpapi/sessoes.go`
- [X] T023 [US4] Frontend da extensão: botão **Estender** na `PaginaSessao.tsx` → `/sessoes/nova?origem={id}` (form pré-preenchido com contexto copiado + banner "extensão de {título da origem}"); seção **Extensões** na página (título, dono, status, link) e breadcrumb de origem quando `origem_id` presente
- [X] T024 [US4] Testes: extensão copia contexto da origem; editar extensão não altera origem; evento `extensao_criada` na origem; `origem_id` inválido → 422; `GET` traz origem+extensoes

**Checkpoint**: US1–US4 independentes (quickstart §4)

---

## Phase 7: User Story 5 — Sessão é entregue ou arquivada (Priority: P3)

**Goal**: ciclo de vida fechado — entregar (com PR link), arquivar, reabrir; tudo na timeline

**Independent Test** (quickstart §5): entregar com PR link → status/selo/evento; arquivar → fora do destaque, consultável; reabrir → volta a ativa

### Implementation for User Story 5

- [X] T025 [US5] Store de status em `modules/apps/harness-api/internal/store/sessoes.go`: `UpdateStatus(id, acao, prLink)` com as **únicas transições válidas do data-model**: `em_andamento→entregue|arquivada`, `entregue→arquivada|em_andamento`, `arquivada→em_andamento`; `pr_link` persistido apenas em `entregar`; não muda `dono_atual_email`; evento `status_mudou` payload `{"de","para","pr_link"}`
- [X] T026 [US5] Handler `POST /api/sessoes/{id}/status` (`{"acao":"entregar|arquivar|reabrir","pr_link":...}`, `422 transicao_invalida` fora do diagrama) em `modules/apps/harness-api/internal/httpapi/sessoes.go`
- [X] T027 [US5] Frontend do ciclo: ações **Entregar** (pede PR link opcional), **Arquivar**, **Reabrir** na `PaginaSessao.tsx` conforme status atual; `StatusBadge` na lista diferenciando os 3 status com sessões entregues/arquivadas fora do destaque de ativas
- [X] T028 [US5] Testes: cada transição válida grava evento correto; transições inválidas (ex.: `arquivada→entregue`) → 422; `pr_link` só em entregar; reabrir não muda dono

**Checkpoint**: todas as user stories funcionam isoladas (quickstart §5)

---

## Phase 8: Polish & Cross-Cutting (Infra, Deploy, Validação)

**Purpose**: wiring de infra/CI (research D5–D6), robustez e validação ponta-a-ponta

- [X] T029 [P] Terraform — registros declarativos em `modules/infra/terraform/locals.tf`: `services` (`harness-api.giomartins.dev → 8010`), `static_sites` (`harness-frontend`, bucket = nome da pasta), `path_protected_hostnames` (`harness-api.giomartins.dev/api`); `variables.tf` → `excluded_hostnames` com `harness-api.giomartins.dev` (bare) e `harness-frontend.giomartins.dev` (uma justificativa por linha, padrão do arquivo)
- [X] T030 [P] Terraform — módulo `modules/infra/terraform/compute/apps/harness-api/` (main/variables/versions/outputs) no shape bet_api: portas publicadas `127.0.0.1` (interna=externa=8010), `networks_advanced` na rede `apps`, `docker_volume` → `/data` (SQLite persistente), env `HARNESS_ACCESS_AUD` (de `module.cloud_cloudflare.access_app_auds["harness-api.giomartins.dev/api"]`), `HARNESS_FRONTEND_ORIGINS`, `HARNESS_ALLOWED_EMAILS`, label watchtower; registrar `module "compute_apps_harness_api"` no `modules/infra/terraform/main.tf`
- [X] T031 [P] CI Go — `modules/apps/../.github/workflows/go-ci-cd.yml`: adicionar `harness-api` no `case` do `-replace` (~linha 313, mapeando `module.compute_apps_harness_api.docker_container.harness_api`) sem o qual o container nunca é recriado
- [X] T032 [P] CI Frontend — `.github/workflows/ts-frontend-ci-cd.yml`: `harness-frontend` em `ALLOWED_APPS` (linha 56), em `push.paths` (linhas 33–37) e `VITE_HARNESS_API_URL=https://harness-api.giomartins.dev` no passo de Build
- [X] T033 [P] Robustez frontend: revisão de responsividade mobile nas 3 páginas (FR-014), estados de erro da API com retry manual, links externos seguros, título da página por rota
- [X] T034 READMEs de `modules/apps/harness-api/` e `modules/apps/harness-frontend/` (env vars, rodar local com bypass, deploy) no padrão dos apps existentes
- [X] T035 Executar validação completa do `specs/001-harness-corporativo/quickstart.md` (cenários 1–6 com dois usuários via bypass dev) — corrigir desvios encontrados
- [ ] T036 Validação de deploy pós-merge (quickstart §Deploy): tf apply **antes** do mirror do frontend (bucket race — research D5), pipelines `go-ci-cd`/`ts-frontend-ci-cd` verdes, `harness-api.giomartins.dev/api/health` sem cookie → 401 e com cookie → 200, cenários 1–2 com dois usuários reais do Access

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: imediato; T001 e T002/T003 em paralelo
- **Foundational (2)**: T004 → T006; T005 e T007 paralelizam com T004 (T005 precisa do T004 só para o upsert — pode ser escrito junto do T006). **Bloqueia todas as stories**
- **US1 (3)**: T008/T009 → T010 → T011–T013 (FE em paralelo aos handlers depois do contrato) → T014
- **US2 (4)**: após US2-store (T015) os handlers/FE/testes seguem; depende da US1 (página e store existentes)
- **US3 (5)**: depende da lista da US1; T020 independe do T019
- **US4 (6)**: estende `CreateSessao`/`GetSessao` da US1 — sequencial após US1
- **US5 (7)**: estende a página da US1 — sequencial após US1
- **Polish (8)**: após as stories desejadas; T029–T034 paralelizáveis entre si; T035/T036 por último

### User Story Dependencies

- **US1 (P1)**: só Foundational — nenhum cruzamento
- **US2 (P1)**: baseia-se na página/store da US1 (mesmo arquivo de store — evitar merge em paralelo)
- **US3 (P2)**: refina a lista da US1 (mesmo arquivo) — sequencial
- **US4 (P2)**: estende `CreateSessao`/`GetSessao` da US1 (mesmo arquivo) — sequencial
- **US5 (P3)**: estende a página da US1 (mesmo arquivo) — sequencial

> Arquivos compartilhados entre stories (`store/sessoes.go`, `httpapi/sessoes.go`, `PaginaSessao.tsx`) tornam a ordem P1→P5 sequencial na prática para um único implementador; com duas pessoas, API (T008–T010, T015–T016, T021–T022, T025–T026) e frontend (T011–T013, T017, T019, T023, T027) podem caminhar em trilhas paralelas.

### Parallel Opportunities

- **Setup**: T002 ∥ T003 (e ambos ∥ T001)
- **Foundational**: T005 ∥ T007; T004 → T006
- **US1**: T009 ∥ T008; FE (T011–T013) ∥ testes (T014) após handlers
- **US3**: T020 ∥ T019
- **Polish**: T029 ∥ T030 ∥ T031 ∥ T032 ∥ T033 ∥ T034

---

## Implementation Strategy

### MVP First (US1 apenas)

1. Phase 1 (Setup) → 2. Phase 2 (Foundational) → 3. Phase 3 (US1) → 4. **STOP**: validar quickstart §1 → 5. Deploy/demo se pronto

### Incremental Delivery

1. Setup + Foundational → fundação pronta
2. +US1 → validar §1 → **MVP publicável**
3. +US2 → validar §2–§3 → handoff real entre 2 pessoas (criterio SC-002)
4. +US3 → +US4 → validar §4 → +US5 → validar §5
5. Polish → deploy (T029–T032) → validação de produção (T036)

### Notes

- [P] = arquivos diferentes, sem dependência incompleta
- Commit por tarefa ou grupo lógico; validar checkpoint de cada fase antes de avançar
- Evitar: editar o mesmo arquivo em trilhas paralelas (ver dependências por arquivo acima)
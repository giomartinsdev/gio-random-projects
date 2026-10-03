---
description: "Task list for FC Clubs Hub implementation"
---

# Tasks: FC Clubs Hub

**Input**: Design documents from `/specs/003-fc-clubs-hub/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Testes aparecem só onde o repositório já exige esse padrão — testes
de integração `httptest`/testcontainers para os agregados novos no
`domain-worker`/`domain-api` (mesmo modelo de `deal_test.go`/`post_test.go`) e
testes de mapeamento `pytest` no worker (mesmo modelo de
`pld-scraper/tests/test_pld_mapping.py`). Não geramos suíte de frontend: não é
convenção hoje neste repo.

**Organization**: Tasks agrupadas por user story, na ordem de prioridade do
spec.md. Cada história é entregável e testável de forma independente via
`quickstart.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: US1..US5
- Caminhos de arquivo exatos em toda descrição
- **Deploy-ready**: toda task de setup que toca pipeline/infra inclui
  explicitamente a linha do `-replace` e a conferência por `curl` — é o passo
  que, faltando, dá deploy verde sem trocar nada (`docs/novo-app-ci-cd.md` §6)

## Path Conventions

- `modules/apps/domain-worker/`, `modules/apps/domain-api/` — extensões do
  serviço de domínio compartilhado
- `modules/apps/clubs-api/` — GO novo, 1 container, 1 host
- `modules/apps/clubs-ingest/` — Python novo, container, **sem host**
- `modules/apps/clubs-frontend/` — SPA estática nova, sem container
- `modules/infra/terraform/` — infraestrutura
- `.github/workflows/` — pipelines

## Portas e hostnames reservados

| Recurso | Valor | Situação |
|---|---|---|
| `clubs-api.giomartins.dev` | porta **8017** | livre — última usada é 8016 (`apostas-api`); workers não publicam porta |
| `clubs-ingest` | **sem porta, sem hostname** | padrão de `proventos_worker`/`pld_scraper` |
| `clubs.giomartins.dev` | bucket `clubs-frontend` | static site, sem porta |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding dos 3 projetos novos e da infraestrutura que os
sustenta, antes de qualquer lógica de negócio. É a fase que faz o deploy
"existir" — sem ela os pipelines não enxergam os apps.

- [X] T001 Criar a estrutura de diretórios dos 3 novos apps
      (`modules/apps/clubs-api/`, `modules/apps/clubs-ingest/`,
      `modules/apps/clubs-frontend/`) com `go.mod`
      (`github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api`)
      no Go, `pyproject.toml` (hatchling, `packages = ["src/clubs_ingest"]`)
      no Python, e `package.json` + `tsconfig.json` no frontend — seguindo
      `plan.md` → Project Structure
- [X] T002 [P] Criar `Dockerfile` multi-stage distroless para `clubs-api`
      seguindo `docs/novo-app-ci-cd.md` §3 (build `golang:1.25-alpine`,
      `CGO_ENABLED=0`, runtime `gcr.io/distroless/static-debian12:nonroot`),
      com `.dockerignore` (`node_modules`, artefatos de build). **O binding é
      em `0.0.0.0:8017`** — o container roda na bridge network compartilhada
      (padrão `contas-api`, não o `network_mode=host` do `cch-api`)
- [X] T003 [P] Criar `Dockerfile` do `clubs-ingest` seguindo
      `modules/apps/pld-scraper/Dockerfile` (base `python:3.12-slim`, usuário
      `app`, **build context = raiz do repo** — `python-ci-cd.yml` monta
      assim), `ENTRYPOINT ["python", "-m", "clubs_ingest.main"]`, sem
      `EXPOSE` e sem `PORT` (não serve nada), e `.dockerignore`
- [X] T004 [P] Inicializar `modules/apps/clubs-frontend` com
      Vite + React + TypeScript + Tailwind (mesmo stack de `hub-frontend`),
      incluindo `vite.config.ts` com proxy de dev para `clubs-api`
      (`/api` → `http://localhost:8017`) e o script `test` que o pipeline exige
      (pode ser `echo "no tests yet" && exit 0`, como no `hub-frontend`)
- [X] T005 [P] Adicionar `clubs-frontend` ao array `ALLOWED_APPS` de
      `.github/workflows/ts-frontend-ci-cd.yml` **e** o path
      `modules/apps/clubs-frontend/**` na lista `on.push.paths` do mesmo
      workflow (as duas coisas — um `package.json` sozinho não basta)
- [X] T006 [P] Criar os 2 módulos Terraform
      `modules/infra/terraform/modules/compute/apps/{clubs_api,clubs_ingest}/`
      (`main.tf`, `variables.tf`, `versions.tf`, `outputs.tf`), ambos na
      **bridge network compartilhada** (padrão `contas-api`, com
      `networks_advanced { name = var.network_name }`) e não em
      `network_mode=host`:
      `clubs_api` com `ports { ip = "127.0.0.1", internal = 8017, external = var.external_port }`
      e env `CLUBS_DOMAIN_API_URL`/`CLUBS_DOMAIN_API_KEY`/`PORT=8017`;
      `clubs_ingest` **sem bloco `ports`** (padrão `proventos_worker`), só com
      as env do worker. Ambos já com
      `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME` wired
- [X] T007 Registrar os 2 módulos em `modules/infra/terraform/main.tf`
      (`module "compute_apps_clubs_api"`, `module "compute_apps_clubs_ingest"`,
      ambos com `domain_api_key` vindo do `random_id` de T009 e
      `depends_on = [module.compute_apps_domain_api]`)
- [X] T008 [P] Registrar a regra de ingress de `clubs-api.giomartins.dev`
      (porta **8017**) em `modules/infra/terraform/locals.tf`, com o comentário
      explicando por que a porta bate, e adicionar `clubs.giomartins.dev` ao
      `static_sites` (bucket `clubs-frontend`)
- [X] T009 [P] Adicionar 2 chaves novas em `modules/infra/terraform/secrets.tf`:
      `random_id.clubs_api_domain_key` e `random_id.clubs_ingest_domain_key`
      (24 bytes cada, mesmo formato de `contas_api_domain_key`) — duas
      identidades separadas para que o log de auditoria distinga escrita de
      BFF e de worker
- [X] T010 Adicionar `clubs.giomartins.dev` e `clubs-api.giomartins.dev` a
      `excluded_hostnames` em `modules/infra/terraform/variables.tf`, com o
      comentário obrigatório (toda entrada dessa lista tem justificativa) —
      é o que mantém o produto público (FR-001). Adicionar
      `clubs-api.giomartins.dev/api` a `path_protected_hostnames` em
      `locals.tf` — é onde o login passa a ser exigido (FR-020)
- [X] T011 ⚠️ **A task que quebra em silêncio**: adicionar a linha do
      `-replace` nos 3 workflows:
      `clubs-api) REPLACE_ARGS+=("-replace=module.compute_apps_clubs_api.docker_container.clubs_api")`
      em `.github/workflows/go-ci-cd.yml`;
      `clubs-ingest) REPLACE_ARGS+=("-replace=module.compute_apps_clubs_ingest.docker_container.clubs_ingest")`
      em `.github/workflows/python-ci-cd.yml`;
      e a entrada do bucket do frontend já é automática (o workflow espelha por
      `matrix.app`). Sem isso o deploy fica verde e o container velho continua
      rodando (`docs/novo-app-ci-cd.md` §6)
- [X] T012 [P] Criar `.env.example` para `clubs-api`
      (`CLUBS_DOMAIN_API_URL`, `CLUBS_DOMAIN_API_KEY`,
      `CLUBS_DEV_BYPASS_AUTH=0`, `CLUBS_DEV_USER_EMAIL=`,
      `CLUBS_FRONTEND_ORIGINS=`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `PORT=8017`) e
      para `clubs-ingest` (`CLUBS_INGEST_DOMAIN_API_URL`,
      `CLUBS_INGEST_DOMAIN_API_KEY`, `CLUBS_INGEST_POLL_SECONDS=900`,
      `CLUBS_INGEST_PLATFORM=common-gen5`, `CLUBS_INGEST_TTL_MATCHES=300`,
      `CLUBS_INGEST_TTL_SQUAD=3600`), sem nenhum valor real. **Prefixo por app**
      (`CLUBS_`/`CLUBS_INGEST_`) é a convenção do repo, e evita que as duas
      variáveis `DOMAIN_API_KEY` (uma por serviço, chaves diferentes) colidam em
      qualquer ambiente que carregue os dois
- [X] T013 [P] Apontar `.specify/feature.json` para
      `specs/003-fc-clubs-hub` e adicionar `design/*.png` + `.shots/` ao
      `.gitignore` do `clubs-frontend` (o `ui.pen` fica versionado, os PNGs
      exportados não — decisão do dono do produto)

**Checkpoint**: os 3 apps existem, buildam vazio, os 2 pipelines e o
Terraform sabem que eles existem, e o `-replace` está no lugar. Um push
consegue fazer os containers subirem (vazios) e a SPA publicar um "hello".

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: O schema e a persistência compartilhada. **Nenhuma user story
entrega dado real sem esta fase** — é o que transforma uma resposta da origem
em algo que a API pode ler.

**⚠️ CRITICAL**: o banco é a fronteira. Nada de UI antes disto.

### Agregados no domain-worker

- [X] T014 [P] Criar o pacote de domínio `clube` em
      `modules/apps/domain-worker/internal/domain/clube/` (`clube.go`,
      `repository.go`, `events.go`): struct conforme `data-model.md` → Clube
      (`club_id` unique como texto, `acompanhado` boolean, cores RGB decimal
      cruas), validação de `club_id` não vazio — mesmo formato de
      `internal/domain/conta/`
- [X] T015 [P] Criar `clube_totais` em
      `modules/apps/domain-worker/internal/domain/clubetotais/` conforme
      `data-model.md` → ClubeTotais (existe para clubes que nunca serão
      acompanhados — FR-008)
- [X] T016 [P] Criar `partida` em
      `modules/apps/domain-worker/internal/domain/partida/` conforme
      `data-model.md` → Partida, incluindo `match_id` **unique** (é o que
      garante FR-018), o enum de tipo (`liga`|`amistoso`|`playoff`) e o enum de
      resultado (`vitoria`|`empate`|`derrota`) — **nunca** calcular resultado na
      leitura (FR-017)
- [X] T017 [P] Criar `linhapartida` em
      `modules/apps/domain-worker/internal/domain/linhapartida/` conforme
      `data-model.md`, com chave única (`partida_id`, `player_id`),
      `defesas_por_tipo` como jsonb nullable (só goleiro) e o enum de posição
      (`goleiro`|`defensor`|`meio`|`atacante`) — FR-006
- [X] T018 [P] Criar `clubesnapshot` em
      `modules/apps/domain-worker/internal/domain/clubesnapshot/` conforme
      `data-model.md`: **append-only, nunca atualiza linha existente**, com
      `nivel`, `divisao`, os agregados congelados e `tamanho_elenco` (permite
      detectar contratação por diff) — FR-009
- [X] T019 [P] Criar `mudancadivisao` em
      `modules/apps/domain-worker/internal/domain/mudancadivisao/` conforme
      `data-model.md`, derivado do diff de snapshots (`para < de` = promoção) —
      FR-010
- [X] T020 [P] Criar `preferencia` em
      `modules/apps/domain-worker/internal/domain/preferencia/` cobrindo
      watchlist (`usuario_email` + `club_id` + `origem`), pro reivindicado e
      avisos conforme `data-model.md` — **toda leitura filtrada por
      `usuario_email`** é o mecanismo que garante FR-025
- [X] T021 [P] Criar `anuncio` em
      `modules/apps/domain-worker/internal/domain/anuncio/` conforme
      `data-model.md` (tipo, título, texto, referência, expiração) — FR-001

### Migrations e repositórios

- [X] T022 Adicionar as 9 tabelas de `data-model.md` ao
      `modules/apps/domain-worker/internal/infrastructure/postgres/schema.sql`
      (**o arquivo único e idempotente** — não há migrations versionadas neste
      repo: `Migrate()` aplica o `schema.sql` inteiro, e toda instrução nele é
      escrita para poder rodar de novo, via `CREATE TABLE IF NOT EXISTS`, sem
      rastreamento de versão), com os índices que
      `contracts/domain-api-extensions.md` pressupõe — em especial
      `clubs_snapshots (club_id, lido_em desc)` (o gráfico de evolução) e
      `clubs_match_players (player_id)` (o índice cross-club). Espelhar as
      tabelas que a `domain-api` **lê** no
      `modules/apps/domain-api/internal/infrastructure/postgres/schema.sql`
      (que é o subconjunto de leitura do mesmo schema — os dois arquivos já
      divergem hoje por esse motivo)
- [X] T023 [P] Implementar os repositórios Postgres em
      `modules/apps/domain-worker/internal/infrastructure/postgres/{clube,partida,linhapartida,snapshot,preferencia,anuncio}_repository.go`,
      mesmo formato de `conta_repository.go`/`cchroom_repository.go`
- [X] T024 Implementar no repositório de partida a **gravação idempotente por
      `match_id`** (insert na primeira vez, update depois) e a gravação
      transacional de partida + linhas dos dois lados — é o que garante FR-018
      e a atomicidade da súmula
- [X] T025 Implementar no repositório de snapshot o **diff contra a última
      leitura** do mesmo clube, gerando `MudancaDivisao` quando `divisao` muda
      — FR-010

### Handler e commands no domain-api

- [X] T026 Implementar `commands.go`, `service.go` e `handler.go` em
      `modules/apps/domain-api/internal/application/{clube,partida,snapshot,preferencia,anuncio}/`
      cobrindo as rotas de escrita de
      `contracts/domain-api-extensions.md`, com o modo correto por rota
      (**`/sync`** para clube/partida/linha/preferência, **`202`** para
      snapshot/anúncio)
- [X] T027 Implementar as rotas de leitura de
      `contracts/domain-api-extensions.md` (clube, elenco agregado, partidas,
      súmula, snapshots, divisões, recordes, h2h, rankings, jogador, anuncios,
      preferencias) em `modules/apps/domain-api/internal/infrastructure/http/`
- [X] T028 [P] Adicionar os labels das 2 chaves novas (`clubs-api`,
      `clubs-ingest`) ao mapa de identidade do `apikey.go` do `domain-api` —
      sem isso as chaves de T009 autenticam mas aparecem sem nome no log de
      auditoria
- [X] T029 Escrever os testes de integração dos agregados novos em
      `modules/apps/domain-worker/internal/application/..._test.go` com Postgres
      via testcontainers (mesmo padrão de `deal_test.go`/`post_test.go`):
      idempotência de `match_id`, diff de divisão gerando evento, leitura de
      preferência isolada por `usuario_email`

**Checkpoint**: `POST` numa partida grava partida + linhas; um `POST` de
snapshot grava e gera evento de divisão quando muda; as leituras devolvem o que
foi gravado. `go test ./...` passa no `domain-worker` e no `domain-api`.

---

## Phase 3: User Story 1 - Ver o ranking global e os anúncios (Priority: P1) 🎯 MVP

**Goal**: uma pessoa visitante, sem conta, vê anúncios e os rankings globais de
clubes e jogadores.

**Independent Test**: `quickstart.md` Cenários 1 e 2 — o worker traz um clube, e
a home responde a um acesso anônimo.

### Worker de ingestão

- [X] T030 [US1] Vendorizar o client da origem: copiar `fc27_api.py` de
      `fc27-clubs-api/` para `modules/apps/clubs-ingest/src/fc27_api.py`,
      **preservando o `LICENSE.md` original** como
      `modules/apps/clubs-ingest/src/LICENSE.fc27` e adicionando crédito
      explícito ao autor no cabeçalho do arquivo — a origem é de terceiro (MIT)
- [X] T031 [P] [US1] Incorporar as fixtures da origem de
      `fc27-clubs-api/tests/fixtures/*.json` para
      `modules/apps/clubs-ingest/tests/fixtures/` (estrutura real, nomes e ids
      anonimizados) — são a base dos testes de mapeamento
- [X] T032 [US1] Criar `modules/apps/clubs-ingest/src/clubs_ingest/normalize.py`:
      a **camada única de tradução** de FR-017 — números como texto, `clubId`
      vs `clubIds`, os 5 códigos de resultado (`1`/`2`/`4`/`16385`/`10`), amistoso
      sem marcação (resultado derivado de gols pró vs sofridos), posição
      numérica → enum, e tabelas de-para para os identificadores sem publicação
      (posição, estilo, nacionalidade, escudo) com fallback explícito quando
      desconhecido
- [X] T033 [US1] Criar `modules/apps/clubs-ingest/src/clubs_ingest/client.py`:
      cliente HTTP da `domain-api` com `X-API-Key`, métodos para clube, totais,
      lote de partidas+lances e snapshot — modo `202` no snapshot
- [X] T034 [US1] Criar `modules/apps/clubs-ingest/src/clubs_ingest/cycle.py`:
      o ciclo de `contracts/clubs-ingest.md` — lê clubes acompanhados, checa TTL
      por tipo de consulta, consulta só o vencido, normaliza, grava; **cada
      clube em bloco isolado de falha** (FR-032), registrando o `club_id` que
      falhou e seguindo para o próximo (FR-019)
- [X] T035 [US1] Criar `modules/apps/clubs-ingest/src/clubs_ingest/main.py`:
      validação de env obrigatória (recusa bootar sem `CLUBS_INGEST_DOMAIN_API_URL`/
      `CLUBS_INGEST_DOMAIN_API_KEY` — mesmo `SystemExit` de `pld-scraper`), uma única
      instância do cliente da origem para o processo inteiro (o token de desafio
      do CDN precisa sobreviver entre ciclos), init de telemetria e o loop
- [X] T036 [US1] Criar `modules/apps/clubs-ingest/src/clubs_ingest/anuncios.py`:
      deriva anúncios dos fatos novos (resultado novo, recorde batido, mudança
      de divisão) e publica via `202` — FR-001
- [X] T037 [US1] Escrever `modules/apps/clubs-ingest/tests/test_normalize.py`
      cobrindo os 4 casos do Cenário 0 do quickstart: os 5 códigos de resultado,
      amistoso derivado, código de posição desconhecido que não quebra, e
      fixture com campo ausente que falha isoladamente
- [X] T038 [US1] Adicionar ao `clubs-ingest` o pacote de telemetria (copiar de
      `pld-scraper`/`deals_common`) e os contadores que a área de administração
      lê em FR-031: clubes processados, falhas por clube, estado do cache por
      tipo de consulta

### API pública

- [X] T039 [P] [US1] Criar `modules/apps/clubs-api/internal/domainclient/`:
      cliente HTTP da `domain-api` com `X-API-Key`, sem driver de banco
- [X] T040 [US1] Criar `modules/apps/clubs-api/internal/httpapi/server.go`
      com mux por patterns, `GET /healthz` (com contadores de base) e
      middleware de logging/telemetria
- [X] T041 [US1] Implementar as rotas **públicas** de anúncios e rankings
      (`GET /api/anuncios`, `GET /api/rankings/clubes?metrica=`,
      `GET /api/rankings/jogadores?metrica=&posicao=`) em
      `modules/apps/clubs-api/internal/httpapi/public.go`, com métrica
      desconhecida caindo no default em vez de erro (contrato `clubs-api.md`)
- [X] T042 [US1] Implementar a **degradação para base vazia**: listas vazias +
      objeto de estado, nunca `500` — é o que sustenta o Cenário 2 do quickstart
      no primeiro dia (FR-008, cenário 4 da US1)

### Frontend: fundação visual + Home

- [X] T043 [US1] Extrair os tokens do `ui.pen` (`GetVariables`) para
      `modules/apps/clubs-frontend/src/index.css` como CSS custom properties
      com os dois temas (claro/escuro) e `data-theme` no `<html>`, mesmo padrão
      de `hub-frontend`/`cch-frontend` — **os tokens são a fonte canônica; não
      inventar valores**
- [X] T044 [P] [US1] Configurar `tailwind.config.js` apontando as cores,
      tipografia, espaçamento e raio para as variáveis de T043 (Barlow
      Condensed/Barlow no protótipo; manter o que o `.pen` define)
- [X] T045 [US1] Portar os componentes primitivos do design system para
      `modules/apps/clubs-frontend/src/components/ui/` (Button, Badge, Avatar,
      Tabs, Filter, Table cells, Empty State, Alert, Input, Switch) a partir dos
      56 componentes do `ui.pen` — mesmas variantes e mesmas variáveis
- [X] T046 [P] [US1] Portar os 6 gráficos em SVG para
      `modules/apps/clubs-frontend/src/components/charts/` a partir da
      implementação à mão que já existe em
      `modules/apps/clubs-frontend/js/charts.js` (linha com tooltip, barra,
      radar, rosca, dispersão, sparkline) — **sem** biblioteca externa
- [X] T047 [US1] Criar o shell da SPA: sidebar (com seletor de clube), rota por
      hash, `src/lib/api.ts` (cliente da `clubs-api`), `src/lib/format.ts`
      (formatadores) e `src/App.tsx` — FR-037 (link direto sobrevive a recarregar
      e ao botão voltar)
- [X] T048 [US1] Implementar `modules/apps/clubs-frontend/src/pages/Home.tsx`:
      anúncios + ranking global com as duas abas (clubes/jogadores) e as
      métricas trocáveis, com as linhas clicáveis levando ao perfil — FR-001,
      FR-007, SC-001, SC-002

**Checkpoint US1**: com a base populada pelo worker, a home responde a um
acesso anônimo com anúncios e os dois rankings; sem base, mostra estado vazio
explicativo. É o MVP demonstrável.

---

## Phase 4: User Story 2 - Explorar clube, partida e jogador (Priority: P1)

**Goal**: navegação pública completa — busca, clube, elenco, partidas, súmula,
jogador.

**Independent Test**: `quickstart.md` Cenário 3 completo.

- [X] T049 [US2] Implementar as rotas públicas de clube em
      `modules/apps/clubs-api/internal/httpapi/public.go`:
      `GET /api/clubes?q=` (busca **tolerante a acento e caixa** — FR-002),
      `GET /api/clubes/{club_id}`, `GET /api/clubes/{club_id}/elenco`,
      `GET /api/clubes/{club_id}/partidas?tipo=&limite=`
- [X] T050 [US2] Implementar a leitura de súmula
      `GET /api/partidas/{match_id}` devolvendo **os dois lados** com nota, gols,
      assistências e minutos por jogador, e a marcação de desistência — FR-005
- [X] T051 [US2] Implementar `GET /api/jogadores?q=` (índice cross-club, FR-002)
      e `GET /api/jogadores/{player_id}` com forma recente, gols por jogo, acerto
      de passe, desarme e — para goleiro — o detalhamento de defesas por tipo
      (FR-006, FR-013)
- [X] T052 [P] [US2] Escrever os testes `httptest` por handler em
      `modules/apps/clubs-api/internal/httpapi/public_test.go`, cobrindo:
      busca sem acento encontra, clube não acompanhado devolve só totais com
      flag (FR-008), partida inexistente devolve `404`
- [X] T053 [US2] Implementar `modules/apps/clubs-frontend/src/pages/Clubes.tsx`
      (busca + diretório com tabela densa) e
      `modules/apps/clubs-frontend/src/pages/Jogadores.tsx` (índice com filtro
      por posição)
- [X] T054 [US2] Implementar `modules/apps/clubs-frontend/src/pages/Clube.tsx`
      com as 4 abas (Resumo, Elenco, Partidas, Números) — o **Resumo** mostra
      campanha, divisão atual e melhor, nível, sequências e últimas partidas
      (FR-003); a aba de **Elenco** usa o componente de tabela (FR-004)
- [X] T055 [US2] Implementar `modules/apps/clubs-frontend/src/pages/Partida.tsx`
      (súmula dos dois lados, linha do tempo, comparativo) e
      `modules/apps/clubs-frontend/src/pages/Jogador.tsx` (perfil completo)
- [X] T056 [US2] Implementar o **estado de clube não acompanhado** na página de
      clube: apenas totais gerais com explicação explícita, nunca tela vazia —
      FR-008, cenário 5 da US2
- [X] T057 [US2] Implementar a responsividade: sidebar → navegação compacta em
      tela pequena, sem rolagem horizontal — FR-036, cenário 7 do Cenário 3

**Checkpoint US2**: navegação pública completa, dados batendo entre telas, links
diretos funcionando, mobile sem rolagem horizontal.

---

## Phase 5: User Story 3 - Evolução, recordes e confrontos (Priority: P2)

**Goal**: o histórico que a EA não guarda — evolução de nível, mudanças de
divisão, recordes, h2h, gols por temporada.

**Independent Test**: `quickstart.md` Cenário 4 completo.

- [X] T058 [US3] Implementar em `public.go`: `GET /api/clubes/{club_id}/evolucao`
      (série de nível e divisão, FR-009), `GET /api/clubes/{club_id}/divisoes`
      (eventos datados, FR-010), `GET /api/clubes/{club_id}/recordes` (FR-011) e
      `GET /api/clubes/{club_id}/confrontos/{rival_id}` (FR-012)
- [X] T059 [US3] Implementar os **recordes computados na leitura** a partir do
      histórico persistido, não da janela recente da origem (FR-014): maior
      goleada, pior derrota, jogo com mais gols, melhor nota individual, maior
      sequência de vitórias
- [X] T060 [US3] Implementar o h2h agregando `Partida` por par de clubes e
      cruzando as estatísticas dos dois (FR-012)
- [X] T061 [P] [US3] Teste do cálculo de recordes com dados de fixture:
      garante que um recorde que **não** está mais na janela recente da origem
      continua sendo encontrado (é a asserção que prova FR-014)
- [X] T062 [US3] Implementar as abas **Números** (evolução, divisões, recordes)
      e o comparador no `Clubes.tsx`/`Clube.tsx` do frontend, com o gráfico de
      linha da evolução (T046)
- [X] T063 [US3] Implementar o **estado de histórico curto**: com apenas um
      snapshot, mostrar o valor atual e explicar que o histórico cresce a cada
      atualização, em vez de desenhar gráfico degenerado — cenário 5 da US3

**Checkpoint US3**: a aba de números de um clube mostra evolução, mudanças de
divisão datadas, recordes e h2h; com histórico curto, degrada de forma
explicativa.

---

## Phase 6: User Story 4 - Login e sincronização (Priority: P2)

**Goal**: login opt-in; o hub descobre e sincroniza os clubes da pessoa, os
rivais e os rivais dos rivais, em segundo plano, sem bloquear a navegação.

**Independent Test**: `quickstart.md` Cenário 5 completo.

### Identidade

- [X] T064 [US4] Criar `modules/apps/clubs-api/internal/httpapi/auth.go`:
      middleware de validação do token do provedor de identidade (`keyfunc`,
      mesma lib de `bet-api`/`harness-api`) + o bypass de desenvolvimento
      (`CLUBS_DEV_BYPASS_AUTH`/`CLUBS_DEV_USER_EMAIL`), sem lib
      compartilhada — é a convenção do repo
- [X] T065 [US4] Implementar `GET /api/me` (probe de login da SPA: `200` com
      identidade ou redirecionamento opaco, contrato `clubs-api.md`) e
      `GET /api/sso` (hop de login com allowlist de origem) — FR-020
- [X] T066 [US4] Implementar as rotas **pessoais** em
      `modules/apps/clubs-api/internal/httpapi/personal.go`:
      `GET/POST /api/preferencias`, `GET/POST /api/minha-area`,
      `POST /api/minha-area/pro`, todas escopadas por identidade e retornando
      `403` sem ela — FR-023, FR-024, FR-025, FR-027
- [X] T067 [P] [US4] Teste de isolamento: com duas identidades distintas,
      garantir que a watchlist e o pro reivindicado de uma **nunca** aparecem na
      resposta da outra — é a asserção que prova FR-025 e SC-005

### Sincronização em segundo plano

- [X] T068 [US4] Implementar a descoberta em **três níveis** no
      `clubs-ingest` (ou num endpoint de comando na `domain-api`):
      nível 1 = clubes da pessoa; nível 2 = adversários desses clubes;
      nível 3 = adversários dos rivais — cada nível enfileirado e processado
      como os clubes normais (FR-021)
- [X] T069 [US4] Persistir a `origem` de cada clube seguido
      (`proprio`/`rival`/`rival_de_rival`/`manual`) conforme `data-model.md` —
      alimenta a tela de Minha Área e o progresso por nível
- [X] T070 [US4] Implementar `GET /api/sync/status` com o payload de
      `contracts/clubs-api.md` (rodando, nível, total, concluídos, atual, novos)
      e `POST /api/sync` — FR-021, FR-022
- [X] T071 [US4] Implementar no `clubs-ingest` o **isolamento de falha** da
      sincronização: sair no meio descarta o pendente sem estado inconsistente
      (cenário 5 dos edge cases)

### Frontend

- [X] T072 [P] [US4] Criar `src/lib/auth.ts` (probe de `/api/me`, hop de
      `/api/sso`) e `src/lib/useSync.ts` (polling do `/api/sync/status`) no
      frontend
- [X] T073 [US4] Implementar `modules/apps/clubs-frontend/src/pages/MinhaArea.tsx`:
      tela de login quando visitante; quando conectado, o pro reivindicado com a
      marca de verificado, a watchlist e o **painel dos três níveis** mostrando o
      que o login desbloqueou
- [X] T074 [US4] Implementar o **indicador de sincronização** no shell da SPA:
      progresso por nível, nomeando o clube em processamento, **sem bloquear a
      navegação** — FR-022, SC-004
- [X] T075 [US4] Implementar o fluxo de sair: volta ao estado de visitante sem
      quebrar a tela atual — FR-026, cenário 8 do Cenário 5

**Checkpoint US4**: entrar, ver os três níveis sincronizando enquanto navega,
e ao final os clubes descobertos estarem completos; em janela anônima, a marca
de verificado não aparece.

---

## Phase 7: User Story 5 - Notificações e Administração (Priority: P3)

**Goal**: avisos no Discord, controláveis individualmente; e a área restrita com
todo o conteúdo técnico.

**Independent Test**: `quickstart.md` Cenários 6 e 7.

- [X] T076 [US5] Implementar o envio para o canal externo no `clubs-ingest`:
      resumo periódico, recorde/mudança de divisão, resultado de partida, cada um
      condicionado à preferência da pessoa — FR-028
- [X] T077 [US5] Implementar a **degradação sem canal**: sem canal configurado ou
      com falha de envio, o hub opera normalmente e não quebra a ingestão —
      FR-029, cenário 3 do Cenário 6
- [X] T078 [P] [US5] Adicionar o segredo do canal em Vaultwarden
      (`CLUBS_DISCORD_WEBHOOK_URL`, **opcional** com o sufixo `?` no
      `ITEM_MAP`, mesmo tratamento dos webhooks opcionais dos outros
      workers) e wire no
      módulo Terraform do `clubs-ingest` — nunca em texto claro
- [X] T079 [US5] Implementar a **restrição de administração**: as rotas técnicas
      respondem `403` para quem não é administrador — FR-030, cenário 4 do
      Cenário 7
- [X] T080 [US5] Implementar `GET /api/admin/status` com o estado da ingestão
      (clubes acompanhados, pendentes, volume de partidas, cache por tipo de
      consulta) — FR-031
- [X] T081 [US5] Implementar
      `modules/apps/clubs-frontend/src/pages/Notificacoes.tsx` (toggles
      individuais, prévia das mensagens, passo a passo) — FR-027
- [X] T082 [US5] Implementar `modules/apps/clubs-frontend/src/pages/Admin.tsx`
      com as abas de visão geral, integração, histórico, experimentos e decisões
      — FR-035. **Todo o conteúdo técnico vive aqui e em nenhum outro lugar**
- [X] T083 [P] [US5] Varredura de vazamento de jargão: teste/script que falha se
      termos técnicos (`snapshot`, `ingest`, `cache`, `endpoint`, `worker`)
      aparecerem nas telas públicas — é a asserção que prova FR-034 e FR-035

**Checkpoint US5**: avisos chegam no canal quando configurados; a área técnica
recusa quem não é administrador e concentra todo o conteúdo técnico.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T084 [P] Garantir `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME` nos 2
      módulos Terraform e o pacote de telemetria nos 2 serviços (padrão de todo
      app do repo) — sem isso traces e métricas não entram
- [X] T085 [P] Escrever `README.md` do `clubs-api` (modelo público vs pessoal,
      rotas, como rodar local), do `clubs-ingest` (o ciclo, os TTLs, a
      normalização, **a atribuição ao autor do client vendorizado**) e do
      `clubs-frontend` (os tokens vêm do `ui.pen`, os 2 temas, como buildar)
- [X] T086 [P] Adicionar `clubs` ao `README.md` de `modules/apps/` (a linha que
      lista cada app e o que ele é)
- [X] T087 Auditar contraste dos dois temas com a mesma medição WCAG já feita no
      protótipo (o `success` e o `text-faint` no claro foram os que reprovaram e
      precisaram de ajuste) — SC-009
- [X] T088 Rodar o `quickstart.md` inteiro do Cenário 0 ao 10 em produção e
      registrar o resultado
- [X] T089 Verificação de deploy que engana: `curl` no `/healthz` do
      `clubs-api` **e** conferir que o hash do bundle da SPA mudou em relação ao
      build anterior — o sintoma de `-replace` faltando é o hash repetido
      (`docs/novo-app-ci-cd.md` §9)
- [X] T090 [P] Limpeza do repositório: remover `ui.SKILL.MD` e os `.DS_Store`
      soltos na raiz; confirmar que `fc27-clubs-api/` (repo de terceiro
      aninhado) **não** fica versionado aqui — o código útil foi vendorizado em
      T030

---

## Dependencies & Execution Order

### Dependências entre fases

```
Phase 1 (Setup)
    └──> Phase 2 (Fundamentos: schema + domain-api)
              └──> Phase 3 (US1: ingest + API pública + Home)   ← MVP
                        └──> Phase 4 (US2: clube/partida/jogador)
                                  └──> Phase 5 (US3: histórico e recordes)
                        └──> Phase 6 (US4: login + sync)
                                  └──> Phase 7 (US5: notificações + admin)
                                              └──> Phase 8 (Polish)
```

### Dependências críticas (o que não pode ser paralelizado)

| Dependência | Por quê |
|---|---|
| T001 → T002..T013 | os diretórios precisam existir antes dos arquivos |
| T014..T028 → T030..T048 | sem schema não há onde gravar nem o que ler |
| T011 (o `-replace`) → qualquer deploy | **sem a linha, o deploy é verde e não muda nada** |
| T009 (as 2 chaves) → T007 e T026 | os módulos e o `apikey.go` precisam das chaves |
| T030..T032 (normalização) → T034 (ciclo) | o ciclo chama o normalizador |
| T043 (tokens do `.pen`) → T045/T046/T048 | os componentes leem as variáveis |
| T064..T067 (identidade) → T068..T071 (sync) | o sync é por identidade |
| T076..T080 (admin) → T082 (página de admin) | a página consome as rotas |

### Oportunidades de paralelismo

- **T002, T003, T004** — os 3 Dockerfiles/scaffolds, apps diferentes.
- **T014 a T021** — os 8 pacotes de domínio, arquivos diferentes.
- **T005, T008, T009, T012, T013** — infra e config, arquivos diferentes.
- **T039 + T043..T046** — a `clubs-api` e a fundação visual do frontend não se
  tocam; a SPA pode ser montada contra o mock local enquanto a API não existe.
- **T084, T085, T086, T090** — polish independente.

### MVP sugerido

**Entrega mínima que já é um produto no ar**: Phase 1 + Phase 2 + Phase 3 =
um hub público com ranking global, anúncios e ingestão rodando de verdade.
É o que faz o site existir — as fases seguintes enriquecem, mas não criam o
produto.

**Segunda entrega**: Phase 4 (navegação completa) + Phase 5 (o histórico, que é
a razão de existir do produto).

**Terceira entrega**: Phase 6 (login e sync, o que torna o hub pessoal) +
Phase 7 (notificações e administração).

---

## Notes

- **[P]** = arquivos diferentes, sem dependência entre si.
- **Caminho crítico para sair do papel**: T001 → T014..T028 → T030..T042 →
  T043..T048. Tudo o mais pode esperar.
- **A task mais fácil de errar**: T011. O sintoma é um check verde que não
  mudou nada — por isso T089 é obrigatória, não opcional.
- **A asserção mais importante**: T067 (isolamento entre pessoas). É o único
  requisito cuja falha é um incidente de privacidade, não um bug de UI.
- **A task mais fácil de esquecer**: T030 preservar a licença do client de
  terceiro. Vendorizar sem a licença é violação de atribuição.
- **Não reabrir o design**: o `ui.pen` é a fonte canônica visual. Se a
  implementação divergir, quem está errado é o código.
- Commit sugerido após cada checkpoint (US1..US5), seguindo o estilo do repo
  (`feat(clubs): ...`).

---
description: "Task list template for feature implementation"
---

# Tasks: Gestão Financeira Modular

**Input**: Design documents from `/specs/002-gestao-financeira-modular/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Não foram pedidos explicitamente no spec/plan. Tasks de teste
aparecem só onde o próprio repositório já exige esse padrão (testes de
integração `httptest`/testcontainers dos agregados no `domain-worker`,
mesmo modelo de `deal_test.go`/`post_test.go`) — não geramos suíte nova de
testes de frontend, que não é convenção hoje neste repo.

**Organization**: Tasks agrupadas por user story (US1 Contas, US2
Transacional, US3 Dashboard, US4 Asset Manager), na ordem de prioridade do
spec.md. Cada história é entregável e testável de forma independente via
`quickstart.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: US1/US2/US3/US4
- Caminhos de arquivo exatos em toda descrição

## Path Conventions

Web app multi-serviço dentro do monorepo (ver `plan.md` → Project
Structure):

- `modules/apps/domain-worker/internal/...` e
  `modules/apps/domain-api/internal/infrastructure/http/...` — extensões
  do serviço de domínio compartilhado
- `modules/apps/{contas,transacional,asset-manager,dashboard}-api/` — os 4
  novos microsserviços
- `modules/apps/financas-frontend/` — o frontend único
- `modules/infra/terraform/...` — infraestrutura

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding dos 5 projetos novos e da infraestrutura que os
sustenta, antes de qualquer lógica de negócio.

- [X] T001 Criar a estrutura de diretórios dos 5 novos apps
      (`modules/apps/contas-api/`, `modules/apps/transacional-api/`,
      `modules/apps/asset-manager-api/`, `modules/apps/dashboard-api/`,
      `modules/apps/financas-frontend/`) com `go.mod`
      (`github.com/giomartinsdev/gio-random-projects/modules/apps/<nome>`)
      em cada backend, seguindo o layout de `plan.md` → Project Structure
- [X] T002 [P] Criar `Dockerfile` multi-stage distroless para
      `contas-api`, `transacional-api`, `asset-manager-api` e
      `dashboard-api` seguindo a receita de `docs/novo-app-ci-cd.md` §3
      (build stage `golang:1.25-alpine`, `CGO_ENABLED=0`, runtime
      `gcr.io/distroless/static-debian12:nonroot`)
- [X] T003 [P] Inicializar `modules/apps/financas-frontend` com
      Vite + React + TypeScript + Tailwind (mesmo stack de
      `hub-frontend`/`bet-frontend`), incluindo `vite.config.ts` com proxy
      de dev para os 4 backends (`/api/contas` → `:8020`, etc., portas
      definidas em T006)
- [X] T004 [P] Adicionar `financas-frontend` ao array `ALLOWED_APPS` de
      `.github/workflows/ts-frontend-ci-cd.yml`
- [X] T005 [P] Criar os 4 módulos Terraform
      `modules/infra/terraform/modules/compute/apps/{contas_api,
      transacional_api,asset_manager_api,dashboard_api}/` (`main.tf`,
      `variables.tf`, `versions.tf`, `outputs.tf`) por
      `docs/novo-app-ci-cd.md` §4, cada um já com
      `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME` wired
- [X] T006 Escolher e reservar 4 portas externas livres (após 8007, ver
      `docs/novo-app-ci-cd.md`) e registrar as 4 regras de ingress
      (`contas-api.giomartins.dev`, `transacional-api.giomartins.dev`,
      `asset-manager-api.giomartins.dev`, `dashboard-api.giomartins.dev`)
      em `modules/infra/terraform/locals.tf`
- [X] T007 Registrar os 4 módulos `compute_apps_<nome>` em
      `modules/infra/terraform/main.tf` e adicionar o mapeamento `-replace`
      de cada um no `case` de `.github/workflows/go-ci-cd.yml` (§6 de
      `docs/novo-app-ci-cd.md` — sem isso o deploy fica "verde" sem trocar
      nada)
- [X] T008 [P] Adicionar `financas-frontend` a
      `modules/infra/terraform/static_sites.tf` (bucket MinIO + ingress),
      mesmo padrão de `tela-frontend`
- [X] T009 [P] Adicionar 4 entradas novas em `local.domain_api_keys`
      (`modules/infra/terraform/secrets.tf`) — uma `X-API-Key` própria
      para `contas-api`, `transacional-api`, `asset-manager-api` e
      `dashboard-api`
- [X] T010 Adicionar variável de segredo `ASSET_MANAGER_BRAPI_TOKEN` no
      módulo Terraform de `asset-manager-api` (T005) — nunca em texto
      claro no repositório, só via `terraform.tfvars`/secret store, e
      documentar isso no README do serviço (T042)

**Checkpoint**: projetos existem, buildam vazio, pipeline de CI/CD e
infraestrutura sabem que eles existem.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Autenticação e identidade compartilhadas — bloqueiam
qualquer user story, porque toda rota de todo módulo exige login (FR-001).

**⚠️ CRITICAL**: nenhuma user story pode ser considerada "pronta" em
produção sem esta fase, embora o desenvolvimento local possa usar o
bypass de dev (`<MODULO>_DEV_BYPASS_AUTH=1`, mesmo padrão do
`harness-api`) enquanto isto não existe.

- [X] T011 [P] Criar 4 Cloudflare Access applications (uma por hostname:
      `contas-api.giomartins.dev`, `transacional-api.giomartins.dev`,
      `asset-manager-api.giomartins.dev`, `dashboard-api.giomartins.dev`),
      mesmo team/Google SSO/`allowed_emails` dos apps existentes
      (`bet-api`/`harness-api`), no módulo Terraform Cloudflare — outputs
      alimentam a env `*_ACCESS_AUD` de cada serviço
- [X] T012 [P] Criar uma Cloudflare Access application escopada ao path
      `financas.giomartins.dev/sso` (mesmo truque do `hub-frontend`),
      deixando o hostname bare de `financas-frontend` em
      `excluded_hostnames` (`modules/infra/terraform/variables.tf`) com o
      comentário explicando o porquê, igual às entradas existentes
- [X] T013 Documentar (README de cada serviço, ver T042/T043) a convenção
      de identidade compartilhada: todo agregado novo do domain-worker
      carrega `usuario_email` (do JWT do Access) e toda leitura filtra por
      esse campo — é o mecanismo que garante FR-002 (isolamento entre
      pessoas usuárias) e SC-005

**Checkpoint**: identidade e login resolvidos de forma consistente para
os 4 módulos — cada user story só precisa implementar seu próprio
middleware (copiado do padrão `bet-api`/`harness-api`, sem lib
compartilhada, como é convenção no repo).

---

## Phase 3: User Story 1 - Organizar as contas financeiras (Priority: P1) 🎯 MVP

**Goal**: a pessoa usuária cria, edita e arquiva contas (corrente ou
investimento), base para todos os outros módulos.

**Independent Test**: criar, editar, listar e arquivar uma conta via
`contas-api`, confirmando que o tipo fica associado e que arquivar (não
excluir) é a única forma de remoção quando há vínculos — `quickstart.md`
Cenário 1.

### Domain-worker / domain-api (agregado `conta`)

- [X] T014 [US1] Criar o pacote de domínio `conta` em
      `modules/apps/domain-worker/internal/domain/conta/conta.go`:
      struct com `id`, `usuario_email`, `nome`, `tipo` (enum
      `corrente`|`investimento`, imutável após criação — FR-010),
      `status` (enum `ativa`|`arquivada`), `criado_em`, `atualizado_em`;
      validação: `tipo` só pode ser `corrente` ou `investimento`
- [X] T015 [P] [US1] Criar `repository.go` e `events.go` do agregado
      `conta` em `modules/apps/domain-worker/internal/domain/conta/`
      (mesmo formato de `internal/domain/room/`)
- [X] T016 [US1] Criar a migration `contas`
      (`modules/apps/domain-worker/internal/infrastructure/postgres/migrations/`
      — nome sequencial após a última existente) com colunas equivalentes
      ao struct de T014
- [X] T017 [US1] Implementar `commands.go`, `service.go` e `handler.go`
      em `modules/apps/domain-worker/internal/application/conta/`
      cobrindo as actions `conta.criar`, `conta.editar`, `conta.arquivar`
      (dispatch pelo prefixo `conta.`, registrado no dispatcher central,
      mesmo padrão de `internal/application/room/`)
- [X] T018 [US1] Implementar `contahandlers.go` + `contadto.go` em
      `modules/apps/domain-api/internal/infrastructure/http/`:
      `GET /contas?usuario=&status=`, `GET /contas/{id}`, e o roteamento
      de `POST /sync` para as 3 actions de T017; registrar as rotas em
      `router.go` e documentar em `openapi.yaml`
- [X] T019 [P] [US1] Escrever `contahandlers_test.go` (httptest +
      Postgres via testcontainers, mesmo padrão de
      `dealhandlers_test.go`) cobrindo: criar conta com tipo válido,
      rejeitar tipo inválido, editar nome, arquivar

### contas-api (microsserviço do módulo)

- [X] T020 [US1] Implementar `internal/httpapi/auth.go` em
      `modules/apps/contas-api/` — validação do JWT do Cloudflare Access
      (`Cf-Access-Jwt-Assertion` contra o JWKS do team via `keyfunc`,
      `aud` da app de T011, allowlist de e-mails), com
      `CONTAS_DEV_BYPASS_AUTH`/`CONTAS_DEV_USER_EMAIL` para dev — cópia
      direta do padrão de `harness-api/internal/httpapi/auth.go`
- [X] T021 [US1] Implementar `internal/httpapi/server.go` em
      `modules/apps/contas-api/` — mux stdlib, CORS com credentials,
      corpo de erro padrão `{"erro":{"codigo","mensagem"}}` (mesmo
      formato de `harness-api`), rotas `GET /api/health` (sem auth),
      `GET /api/me`, `GET /api/sso?return=`
- [X] T022 [US1] Implementar `internal/domainapi/client.go` em
      `modules/apps/contas-api/` — cliente HTTP para a domain-api
      (`X-API-Key` de T009), sem driver de banco, com os métodos
      `CriarConta`, `EditarConta`, `ArquivarConta` (via `/sync`) e
      `ListarContas`/`BuscarConta` (via `GET`)
- [X] T023 [US1] Implementar as rotas `GET /api/contas`,
      `POST /api/contas`, `PATCH /api/contas/{id}`,
      `POST /api/contas/{id}/arquivar` em
      `modules/apps/contas-api/internal/httpapi/contahandlers.go`,
      retornando `422` para `tipo` inválido e `409` ao arquivar uma
      conta já arquivada
- [X] T024 [US1] Implementar `GET /api/contas/{id}/saldo` em
      `modules/apps/contas-api/internal/httpapi/contahandlers.go`
      (consolida a partir das leituras já disponíveis na domain-api —
      FR-013)
- [X] T025 [US1] `main.go` de `contas-api` amarrando config (env),
      cliente domain-api, auth e server — seguindo `main.go` de
      `harness-api` como referência de bootstrap

### Frontend (módulo Contas)

- [X] T026 [US1] Criar `modules/apps/financas-frontend/src/lib/theme.ts`
      e os tokens de design (tipografia, cor, motion) da identidade
      visual autoral do produto — base usada por todos os módulos
      seguintes, não só Contas; "fora da caixinha", sem clichê de
      dashboard financeiro genérico (referência de qualidade: Nubank/BTG,
      nunca cópia literal)
- [X] T027 [US1] Criar `modules/apps/financas-frontend/src/lib/api/contas.ts`
      (cliente HTTP de `contas-api`, com `credentials: "include"` para o
      cookie do Access) e `src/lib/auth.ts` (probe de login via `/sso`,
      mesmo padrão de `hub-frontend/src/lib/auth.ts`)
- [X] T028 [US1] Criar `modules/apps/financas-frontend/src/modules/contas/`
      — tela de listagem de contas (nome, tipo, saldo), formulário de
      criação (`nome`, `tipo` como seletor `corrente`/`investimento`),
      edição de nome
- [X] T029 [US1] Implementar a ação "arquivar" na UI de contas — **não**
      existe botão de exclusão definitiva na interface (FR-012 é
      satisfeito por design: a única remoção exposta é arquivar), com
      confirmação quando a conta tiver vínculos

**Checkpoint**: US1 completa e testável de forma independente
(`quickstart.md` Cenário 1) — MVP demonstrável.

---

## Phase 4: User Story 2 - Registrar transações do dia a dia (Priority: P2)

**Goal**: lançar, editar, excluir e filtrar transações manuais por conta,
com anexo de imagem preparado para OCR futuro.

**Independent Test**: com uma conta já criada (US1), lançar transações de
entrada/saída, editar, excluir e filtrar — `quickstart.md` Cenário 2.

### Domain-worker / domain-api (agregado `transacao`)

- [X] T030 [US2] Criar o pacote de domínio `transacao` em
      `modules/apps/domain-worker/internal/domain/transacao/transacao.go`:
      `id`, `usuario_email`, `conta_id`, `tipo` (enum `entrada`|`saida`),
      `valor` (decimal, deve ser **> 0** — FR-024), `data` (date válida —
      FR-024), `categoria`, `descricao` (opcional), `anexo_imagem`
      (blob/base64 opcional — FR-023, não processado nesta fase),
      `criado_em`/`atualizado_em`, com `repository.go`/`events.go`
- [X] T031 [US2] Criar a migration `transacoes` em
      `modules/apps/domain-worker/internal/infrastructure/postgres/migrations/`
- [X] T032 [US2] Implementar `commands.go`/`service.go`/`handler.go` em
      `modules/apps/domain-worker/internal/application/transacao/`
      cobrindo `transacao.criar`, `transacao.editar`, `transacao.excluir`
      — dispatch assíncrono (`202`), conforme `research.md` §2
- [X] T033 [US2] Implementar `transacaohandlers.go` + `transacaodto.go`
      em `modules/apps/domain-api/internal/infrastructure/http/`:
      `GET /transacoes?usuario=&conta=&de=&ate=&categoria=` (FR-022),
      registrar rotas e `openapi.yaml`
- [X] T034 [P] [US2] Escrever `transacaohandlers_test.go` cobrindo:
      criação com valor/data válidos, rejeição de valor ≤ 0, filtro por
      categoria/conta/período

### transacional-api (microsserviço do módulo)

- [X] T035 [US2] Scaffold de `transacional-api`
      (`internal/httpapi/auth.go`, `server.go`, `internal/domainapi/client.go`,
      `main.go`) replicando exatamente o padrão criado em T020–T022/T025
      para `contas-api`, com suas próprias env vars
      (`TRANSACIONAL_ACCESS_AUD`, `TRANSACIONAL_DEV_BYPASS_AUTH`, etc.)
- [X] T036 [US2] Implementar `POST /api/transacoes` e
      `PATCH /api/transacoes/{id}` em
      `modules/apps/transacional-api/internal/httpapi/transacaohandlers.go`
      — valida `valor` numérico > 0, `data` válida, e que `contaId`
      existe e não está arquivada no momento da criação (consulta
      `GET /contas/{id}` na domain-api com a própria `X-API-Key`),
      respondendo `422 conta_invalida` caso contrário (FR-020, FR-024,
      edge case do spec)
- [X] T037 [US2] Implementar `DELETE /api/transacoes/{id}` e
      `GET /api/transacoes` (com filtros `conta`/`de`/`ate`/`categoria`)
      em `modules/apps/transacional-api/internal/httpapi/transacaohandlers.go`
      (FR-021, FR-022)
- [X] T038 [US2] Implementar o tratamento de `anexoImagem` (base64) em
      `POST`/`PATCH /api/transacoes`: `413` acima do limite de tamanho
      configurado, `415` para formato não suportado, sem nenhum
      processamento de OCR nesta fase (FR-023, edge case do spec)

### Frontend (módulo Transacional)

- [X] T039 [US2] Criar
      `modules/apps/financas-frontend/src/lib/api/transacional.ts` e
      `src/modules/transacional/` — formulário de lançamento manual
      (valor, data, tipo, categoria, conta, descrição), botão de anexar
      imagem (upload que só guarda o arquivo, com aviso de "leitura
      automática em breve"), lista com filtros por conta/período/categoria,
      edição e exclusão com recálculo imediato de totais na tela

**Checkpoint**: US1 + US2 funcionam juntas e de forma independente
(`quickstart.md` Cenários 1–2).

---

## Phase 5: User Story 3 - Visão personalizada e modular no dashboard (Priority: P3)

**Goal**: dashboard com layout padrão + composição totalmente livre de
blocos (adicionar, remover, redimensionar, reposicionar, escolher fonte e
tipo de visualização), persistido por pessoa usuária.

**Independent Test**: carregar o layout padrão, adicionar/remover/
redimensionar um bloco, confirmar persistência entre sessões, restaurar o
padrão — `quickstart.md` Cenário 4.

### Domain-worker / domain-api (agregado `dashboardlayout`)

- [X] T040 [US3] Criar o pacote de domínio `dashboardlayout` em
      `modules/apps/domain-worker/internal/domain/dashboardlayout/dashboardlayout.go`:
      `id`, `usuario_email` (1 layout ativo por pessoa usuária — upsert,
      não histórico), `blocos` (json — lista de
      `{id, tipoVisualizacao ∈ {linha,barra,pizza,indicador,tabela},
      fonteDados, posicao:{x,y}, tamanho:{largura,altura}}`),
      `atualizado_em`, com `repository.go`/`events.go`
- [X] T041 [US3] Criar a migration `dashboard_layouts` em
      `modules/apps/domain-worker/internal/infrastructure/postgres/migrations/`
      (unique constraint em `usuario_email`)
- [X] T042 [US3] Implementar `commands.go`/`service.go`/`handler.go` em
      `modules/apps/domain-worker/internal/application/dashboardlayout/`
      cobrindo `dashboardlayout.salvar` (upsert, via `/sync`)
- [X] T043 [US3] Implementar `dashboardlayouthandlers.go` +
      `dashboardlayoutdto.go` em
      `modules/apps/domain-api/internal/infrastructure/http/`:
      `GET /dashboardlayouts/{usuario}` (404 quando não existe),
      registrar rotas e `openapi.yaml`

### dashboard-api (microsserviço do módulo)

- [X] T044 [US3] Scaffold de `dashboard-api` replicando o padrão de
      T020–T022/T025 (`DASHBOARD_ACCESS_AUD`, etc.)
- [X] T045 [US3] Implementar `GET /api/layout` (404 → frontend usa o
      padrão embutido), `PUT /api/layout` (substitui `blocos`, valida
      `tipoVisualizacao` ∈ ao enum e presença de `posicao`/`tamanho`/
      `fonteDados`, sem validar se a fonte referenciada ainda existe —
      isso fica no frontend) e `DELETE /api/layout` em
      `modules/apps/dashboard-api/internal/httpapi/layouthandlers.go`
      (FR-040 a FR-044)

### Frontend (módulo Dashboard)

- [X] T046 [US3] Criar
      `modules/apps/financas-frontend/src/modules/dashboard/defaultLayout.ts`
      com o layout padrão embutido (saldo consolidado, gastos por
      categoria, evolução patrimonial — FR-040), usado quando
      `GET /api/layout` devolve 404
- [X] T047 [US3] Implementar o motor de grade modular em
      `modules/apps/financas-frontend/src/modules/dashboard/` — adicionar,
      remover, redimensionar e reposicionar blocos livremente (FR-041),
      persistindo via `PUT /api/layout` a cada alteração (FR-043) e
      oferecendo "restaurar padrão" (`DELETE /api/layout` — FR-044)
- [X] T048 [P] [US3] Implementar os 5 tipos de visualização de bloco
      (linha, barra, pizza, indicador, tabela) em
      `modules/apps/financas-frontend/src/modules/dashboard/blocos/`,
      cada um buscando dados diretamente em `contas-api`/
      `transacional-api`/`asset-manager-api` conforme a `fonteDados`
      escolhida (FR-042) — usando os tokens visuais de T026
- [X] T049 [US3] Implementar o estado de "fonte indisponível" num bloco
      cuja `fonteDados` aponta para uma conta arquivada/excluída, sem
      quebrar o restante do dashboard (edge case do spec)

**Checkpoint**: US1, US2 e US3 funcionam juntas e de forma independente
(`quickstart.md` Cenários 1–2 e 4).

---

## Phase 6: User Story 4 - Acompanhar investimentos e sua rentabilidade (Priority: P4)

**Goal**: cadastrar ativos por conta de investimento, obter cotação de
mercado (brapi.dev) e calcular rentabilidade, incluindo proventos e vendas.

**Independent Test**: cadastrar uma conta de investimento (US1), registrar
a compra de um ativo, ver cotação/valor de mercado/rentabilidade —
`quickstart.md` Cenário 3.

### Domain-worker / domain-api (agregados `ativo` e `ativo_movimento`)

- [X] T050 [US4] Criar o pacote de domínio `ativo` em
      `modules/apps/domain-worker/internal/domain/ativo/ativo.go`:
      `id`, `usuario_email`, `conta_id` (deve referenciar uma conta do
      tipo `investimento`), `ticker`, `quantidade_atual`, `custo_medio`
      (recalculado a cada movimento — FR-030), `ultima_cotacao`,
      `ultima_cotacao_em`, `status` (enum `aberta`|`encerrada`,
      `encerrada` quando `quantidade_atual` chega a zero — FR-034), com
      `repository.go`/`events.go`
- [X] T051 [P] [US4] Criar o pacote de domínio `ativo_movimento` em
      `modules/apps/domain-worker/internal/domain/ativomovimento/ativomovimento.go`:
      `id`, `ativo_id`, `tipo` (enum `compra`|`venda`|`provento`),
      `quantidade` (**obrigatório e > 0** em compra/venda), `preco_unitario`
      (obrigatório em compra/venda), `valor_provento` (obrigatório em
      provento), `data`, `resultado_realizado` (calculado em venda —
      FR-034); validação: uma `venda` não pode reduzir
      `quantidade_atual` do ativo abaixo de zero
- [X] T052 [US4] Criar as migrations `ativos` e `ativo_movimentos` em
      `modules/apps/domain-worker/internal/infrastructure/postgres/migrations/`
- [X] T053 [US4] Implementar `commands.go`/`service.go`/`handler.go` em
      `modules/apps/domain-worker/internal/application/ativo/` cobrindo
      `ativo.criar`, `ativo.registrarMovimento` (via `/sync`) e
      `ativo.atualizarCotacao` (via `202`, chamado em background pelo
      Asset Manager — `research.md` §2)
- [X] T054 [US4] Implementar `ativohandlers.go` + `ativodto.go` em
      `modules/apps/domain-api/internal/infrastructure/http/`:
      `GET /ativos?usuario=&conta=`, `GET /ativos/{id}/movimentos`,
      registrar rotas e `openapi.yaml`
- [X] T055 [P] [US4] Escrever `ativohandlers_test.go` cobrindo: compra
      inicial, venda parcial (recalcula `quantidade_atual`/
      `custo_medio`), venda que zera a posição (`status=encerrada`),
      rejeição de venda que ultrapassa a quantidade disponível

### asset-manager-api (microsserviço do módulo)

- [X] T056 [US4] Scaffold de `asset-manager-api` replicando o padrão de
      T020–T022/T025 (`ASSET_MANAGER_ACCESS_AUD`, etc.)
- [X] T057 [US4] Implementar `internal/quotes/brapi.go` em
      `modules/apps/asset-manager-api/` — cliente para
      `GET https://brapi.dev/api/quote/{tickers}` com
      `Authorization: Bearer ${ASSET_MANAGER_BRAPI_TOKEN}` (env, nunca
      hardcoded), e cache em memória por `ticker` com TTL curto
      (minutos, compatível com SC-004 ≤ 15 min de atraso)
- [X] T058 [US4] Implementar o fallback de cotação em
      `modules/apps/asset-manager-api/internal/httpapi/`: quando a
      chamada à brapi.dev falhar ou o ticker não retornar cotação, usar
      `ultimaCotacao`/`ultimaCotacaoEm` persistidos no agregado `Ativo`
      (via domain-api) e sinalizar `desatualizada: true` — nunca `5xx`
      só por a fonte externa estar fora do ar (FR-035, edge case do spec)
- [X] T059 [US4] Implementar `POST /api/ativos` (compra inicial) e
      `POST /api/ativos/{id}/movimentos` (compra adicional, venda,
      provento) em
      `modules/apps/asset-manager-api/internal/httpapi/ativohandlers.go`
      (FR-030, FR-033, FR-034)
- [X] T060 [US4] Implementar `GET /api/ativos` (com cálculo de
      rentabilidade: `valorMercadoAtual = quantidadeAtual × ultimaCotacao`;
      `rentabilidade = (valorMercadoAtual + proventosRecebidos - custoTotal) / custoTotal`,
      consolidado por conta/usuário — FR-032) e
      `GET /api/ativos/{id}/movimentos` em
      `modules/apps/asset-manager-api/internal/httpapi/ativohandlers.go`
- [X] T061 [US4] Implementar `GET /api/cotacoes?tickers=` (cache-first)
      em `modules/apps/asset-manager-api/internal/httpapi/cotacoeshandlers.go`
      (FR-031)

### Frontend (módulo Asset Manager)

- [X] T062 [US4] Criar
      `modules/apps/financas-frontend/src/lib/api/asset-manager.ts` e
      `src/modules/asset-manager/` — cadastro de ativo por conta de
      investimento, carteira com custo/valor de mercado/rentabilidade,
      indicador visual de cotação desatualizada, ações de registrar
      provento e vender/encerrar posição

**Checkpoint**: todas as 4 user stories funcionam de forma independente e
integrada (`quickstart.md` Cenários 1–5 completos).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: acabamento que atravessa os 4 módulos.

- [X] T063 [P] Escrever o README de cada novo serviço
      (`contas-api`, `transacional-api`, `asset-manager-api`,
      `dashboard-api`, `financas-frontend`) seguindo o formato dos
      READMEs existentes (`harness-api`, `cch-api`, `tela-frontend`):
      como funciona, rotas, env vars, dev, deploy
- [X] T064 Registrar `financas-frontend` como `Microfrontend` em
      `modules/apps/hub-frontend/src/lib/apps.ts` (id `financas`, url
      `https://financas.giomartins.dev`), seguindo o padrão da entrada
      `bet`
- [ ] T065 Rodar os 5 cenários de `quickstart.md` de ponta a ponta local
      (bypass de dev) e depois em produção, confirmando os critérios de
      sucesso SC-001 a SC-006 do spec
- [ ] T066 [P] Confirmar nos 4 novos serviços que logs/métricas/traces
      chegam ao Grafana via o `OTEL_EXPORTER_OTLP_ENDPOINT` configurado em
      T005 (mesma verificação feita em todo app novo do repositório)
- [X] T067 Revisão de segurança final: confirmar que nenhum token/segredo
      (`ASSET_MANAGER_BRAPI_TOKEN`, as 4 `X-API-Key` de domain-api, os 4
      `aud` de Access) está commitado em texto claro em qualquer arquivo
      deste feature, e que o isolamento por `usuario_email` (T013) está
      de fato aplicado em toda rota de leitura dos 4 agregados novos

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende do Setup — bloqueia o uso em
  produção de qualquer user story (dev local pode seguir com bypass)
- **User Stories (Phase 3-6)**: US1 é o alicerce de dados (contas) que
  US2/US3/US4 referenciam — respeitando exatamente a ordem de
  pré-requisito já documentada no próprio spec.md ("Independent Test" de
  US2/US4 assume uma conta já criada); US3 (Dashboard) só entrega valor
  pleno depois que US1/US2/US4 têm dados para exibir, mas seu código é
  entregável antes (mostra o layout padrão vazio)
- **Polish (Phase 7)**: depende de todas as user stories desejadas
  estarem completas

### User Story Dependencies

- **US1 (P1)**: depende só do Foundational — é o alicerce
- **US2 (P2)**: precisa de pelo menos uma conta existir (dado de teste
  de US1), mas seu código (domain-worker/domain-api/transacional-api) é
  implementável em paralelo a US1 depois que a migration `contas` (T016)
  existe
- **US3 (P3)**: independente de dados de US1/US2/US4 para o layout
  padrão vazio; blocos reais exigem que as fontes de dados existam
- **US4 (P4)**: precisa de uma conta do tipo `investimento` existir
  (dado de teste de US1), mesmo padrão de US2

### Parallel Opportunities

- Todas as tasks `[P]` de uma mesma fase podem rodar em paralelo (arquivos
  diferentes, sem dependência entre si)
- Depois do Foundational, os 4 conjuntos de tasks de domain-worker/
  domain-api (T014-T019, T030-T034, T040-T043, T050-T055) podem ser
  desenvolvidos em paralelo por pessoas diferentes, já que cada agregado é
  um pacote Go isolado
- Os 4 microsserviços (`contas-api`, `transacional-api`,
  `asset-manager-api`, `dashboard-api`) podem ser implementados em
  paralelo depois que seu respectivo agregado na domain-api existe

---

## Parallel Example: User Story 1

```bash
Task: "Criar repository.go e events.go do agregado conta em modules/apps/domain-worker/internal/domain/conta/"
Task: "Escrever contahandlers_test.go em modules/apps/domain-api/internal/infrastructure/http/"
```

---

## Implementation Strategy

### MVP First (User Story 1 apenas)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundational (Access apps — ou bypass de dev para
   validar localmente antes disso)
3. Completar Phase 3: US1 (Contas)
4. **Parar e validar**: `quickstart.md` Cenário 1
5. Demonstrar/deployar

### Incremental Delivery

1. Setup + Foundational → base pronta
2. US1 (Contas) → validar → deploy/demo (MVP)
3. US2 (Transacional) → validar → deploy/demo
4. US3 (Dashboard) → validar → deploy/demo
5. US4 (Asset Manager) → validar → deploy/demo
6. Polish → validação final completa dos 6 critérios de sucesso do spec

---

## Notes

- `[P]` = arquivos diferentes, sem dependência
- `[US1]`/`[US2]`/`[US3]`/`[US4]` mapeiam a task à user story do spec.md
  para rastreabilidade
- Nenhum dos 4 novos microsserviços ganha driver de banco de dados —
  toda persistência passa pela domain-api (decisão de arquitetura fixada
  no plan.md/research.md, não uma escolha em aberto)
- Segredos (token brapi.dev, `X-API-Key`s, `aud`s de Access) só em
  Terraform/env, nunca neste repositório em texto claro
- Parar em qualquer checkpoint para validar uma user story de forma
  independente antes de seguir para a próxima

## Status da implementação (execução via 8 agentes paralelos)

Todo o código foi implementado e cada peça passou `go build`/`go vet`/
`go test` (Go) ou `npm run build` (frontend) isoladamente, incluindo
`terraform fmt`/`terraform validate` na infraestrutura. T065/T066 ficam
pendentes porque dependem de um deploy real (push → CI/CD → apply) e de
rodar os serviços juntos contra o Postgres/Redis compartilhados — nenhum
agente tinha acesso a isso.

Divergências relatadas pelos agentes (nenhuma bloqueante, todas
documentadas nos READMEs de cada serviço):

- **Nomenclatura de actions**: `contracts/domain-api-extensions.md` usava
  verbos em português (`conta.criar`, `ativo.atualizarCotacao`); a
  implementação real usa verbos em inglês (`conta.create`,
  `ativo.updateQuote`, etc.), para casar com a convenção já existente no
  `domain-worker`/`domain-api` (`user.create`, `room.update`, `deal.upsert`).
  Os 8 agentes usaram consistentemente os nomes em inglês — o documento de
  contrato ficou desatualizado, não o código.
- **T012 (Access da SPA)**: em vez de uma Cloudflare Access application
  dedicada em `financas.giomartins.dev/sso`, a SPA sonda `/api/me` direto
  em `contas-api` (que já tem seu próprio Access app em `/api`) — mais
  simples, mesmo efeito.
- **Motor de grade do dashboard**: usa controles explícitos de
  mover/redimensionar em vez de drag-and-drop por ponteiro — mesma
  funcionalidade (FR-041), muito menos superfície de bug.
- **`asset-manager-api`**: exige `TF_VAR_asset_manager_brapi_token` antes
  de qualquer apply real — não tem default de propósito.
- **`compute_services_ingress` depends_on**: o agente de infra notou que
  `compute_apps_harness_api` já estava faltando dessa lista antes desta
  feature — não corrigiu (fora de escopo), só não repetiu a lacuna nos 4
  módulos novos.

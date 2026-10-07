---
description: "Task list for Prospecta implementation"
---

# Tasks: Prospecta — Marketing Agêntico & Captação de Clientes

**Input**: Design documents from `/specs/004-prospecta/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md

**Tests**: Este repo exige testes de integração **feature-first** — `.feature`
(Gherkin) + steps `pytest-bdd` + testcontainers reais, escritos **primeiro**
(ver `.claude/skills/feature-first-tdd/SKILL.md`). Não há tier de unit test. Para
`prospecta-api` (Go), testes de integração `httptest`/testcontainers no molde de
`domain-worker/main_test.go`. Não geramos suíte de frontend (não é convenção do
repo).

**Organization**: tarefas agrupadas por user story, na ordem de prioridade do
spec.md. Cada história é entregável e testável de forma independente via
`quickstart.md`.

## Format: `[ID] [P?] [Story] [Lane] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência).
- **[Story]**: US1..US4.
- **[Lane]**: qual agente assume — ver "Lanes" abaixo. Um agente não pega duas
  lanes na mesma fase.
- Caminhos de arquivo exatos em toda descrição.
- **Deploy-ready**: toda task de setup que toca pipeline/infra inclui
  explicitamente a linha do `-replace` e a conferência por `curl` — é o passo
  que, faltando, dá deploy verde sem trocar nada (`docs/novo-app-ci-cd.md` §6).
- **Test-first**: toda task de implementação tem uma task `*-TEST` imediatamente
  antes, que escreve o `.feature` + steps e **assiste falhar** antes do código.

## Lanes (paralelização entre agentes)

| Lane | Escopo | Apps |
| --- | --- | --- |
| **L-CONTRACTS** | pacote de contratos | `packages/prospecta-contracts` |
| **L-INFRA** | Terraform, pipelines, stacks | `modules/infra/terraform/`, `.github/workflows/`, `stacks/` |
| **L-DOMAIN** | agregados + comando/worker de domínio | `modules/apps/domain-api`, `modules/apps/domain-worker` |
| **L-API** | BFF/ACL Go | `modules/apps/prospecta-api` |
| **L-AGENT** | núcleo agêntico Python | `modules/apps/prospecta-agent-worker` |
| **L-FRONT** | SPA React | `modules/apps/prospecta-frontend` |
| **L-QA** | cenários negativos/edge transversais | `*/tests/features` |

**Ordem de dependência:** `L-CONTRACTS` → (`L-DOMAIN`, `L-API`, `L-AGENT`) →
`L-FRONT`. `L-INFRA` anda em paralelo desde o início. `L-QA` entra em cada fase
depois que a lane dona fechou o happy path.

## Path Conventions

- `modules/apps/prospecta-api/` — Go novo, 1 container, 1 host.
- `modules/apps/prospecta-agent-worker/` — Python novo, container, **sem host**.
- `modules/apps/prospecta-frontend/` — SPA estática, sem container.
- `modules/apps/domain-api/`, `modules/apps/domain-worker/` — extensões.
- `packages/prospecta-contracts/` — contrato único.
- `modules/infra/terraform/`, `.github/workflows/`, `stacks/`.

## Portas e hostnames reservados

| Recurso | Valor | Situação |
| --- | --- | --- |
| `prospecta-api.giomartins.dev` | porta **8022** | livre (8000 domain, 8007 tela, 8017 clubs) |
| `prospecta-agent-worker` | **sem porta, sem hostname** | padrão dos workers |
| `prospecta.giomartins.dev` | bucket `prospecta-frontend` | SPA estática, sem porta |

---

## Phase 0: Pesquisa & Contratos (L-CONTRACTS)

**Purpose**: travar o contrato antes de qualquer código. Nada implementa sem o
envelope e os eventos definidos.

- [ ] T000 [L-CONTRACTS] Escrever `specs/004-prospecta/research.md` — orquestração
      de agentes (LangGraph vs máquina de estados própria), escolha das tools de
      busca (`web.search`) e enriquecimento (`enrich.company`), dedup de leads
      (chave `domain+company_name`), política LGPD, e o contrato exato do
      **9router** (`POST /v1/chat/completions`, streaming, fallback).
- [ ] T001 [L-CONTRACTS] Escrever `specs/004-prospecta/data-model.md` — DDL dos
      schemas `prospecta_company`, `prospecta_icp`, `prospecta_campaign`,
      `prospecta_lead`, `prospecta_message`, `prospecta_conversation`,
      `prospecta_agent_run`, `prospecta_audit_log`; índices (`tenant_id`, `fit`,
      `thread_key`), **pgvector** em `prospecta_icp.embedding`, **RLS** por
      `tenant_id`.
- [ ] T002 [L-CONTRACTS] Escrever `specs/004-prospecta/contracts/prospecta-api.md`
      — todos os endpoints do §7.3, com request/response JSON, códigos (200/202/
      401/404/422) e o schema SSE de `/agent/activity`.
- [ ] T003 [L-CONTRACTS] Escrever
      `specs/004-prospecta/contracts/prospecta-agent-worker.md` — as filas que
      consome/publica, o parse do payload Evolution v2.3.7, o formato do request
      ao 9router e o contrato dos tools.
- [ ] T004 [L-CONTRACTS] Escrever
      `specs/004-prospecta/contracts/domain-api-extensions.md` — os comandos
      novos (`CreateCompany`..`BookMeeting`) no envelope `{action, payload}` e os
      eventos `prospecta.*` publicados.
- [ ] T005 [P] [L-CONTRACTS] Escrever `specs/004-prospecta/quickstart.md` — como
      subir local (`compose`) e validar cada user story de ponta a ponta.
- [ ] T006 [P] [L-CONTRACTS] Escrever
      `specs/004-prospecta/checklists/requirements.md` — checklist de aceite do
      spec (requisitos funcionais, não-funcionais, LGPD, observabilidade).
- [ ] T007 [L-CONTRACTS] Criar `packages/prospecta-contracts/` (hatchling,
      `packages = ["src/prospecta_contracts"]`) com `envelope.py` (o
      `{action, payload}` da casa) e `events.py` (os 12 eventos do §7.1), no molde
      de `packages/finance-contracts`.
- [ ] T008 [L-CONTRACTS] Testes de contrato em
      `packages/prospecta-contracts/tests/` (`test_envelope.py`,
      `test_events.py`) — serialização/round-trip e validação dos campos
      obrigatórios; rodar e ver passar. **Sem** dependência de infra (exceção
      comentada no `.feature`, como em `object_storage_infrastructure.feature`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: scaffolding dos 3 apps novos + infra. É a fase que faz o deploy
"existir" — sem ela os pipelines não enxergam os apps.

- [ ] T010 [L-INFRA] Criar a estrutura dos 3 apps
      (`modules/apps/prospecta-api/`, `modules/apps/prospecta-agent-worker/`,
      `modules/apps/prospecta-frontend/`) — `go.mod`
      (`github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api`),
      `pyproject.toml` (hatchling, `packages = ["src/prospecta_agent_worker"]`),
      `package.json` + `tsconfig.json` — seguindo `plan.md` → Project Structure.
- [ ] T011 [P] [L-INFRA] `Dockerfile` multi-stage distroless do `prospecta-api`
      (`golang:1.25-alpine` → `gcr.io/distroless/static-debian12:nonroot`,
      `CGO_ENABLED=0`, binding `0.0.0.0:8022`) + `.dockerignore`.
- [ ] T012 [P] [L-INFRA] `Dockerfile` do `prospecta-agent-worker`
      (base `python:3.12-slim`, usuário `app`, build context = raiz do repo,
      `ENTRYPOINT ["python","-m","prospecta_agent_worker.main"]`, **sem `EXPOSE`
      e sem `PORT`**) + `.dockerignore`.
- [ ] T013 [P] [L-INFRA] Inicializar `prospecta-frontend` (Vite + React + TS +
      Tailwind, padrão `hub-frontend`), `vite.config.ts` com proxy de dev
      `/api` → `http://localhost:8022` e script `test` no-op.
- [ ] T014 [P] [L-INFRA] Adicionar `prospecta-frontend` ao array `ALLOWED_APPS`
      **e** o path `modules/apps/prospecta-frontend/**` em `on.push.paths` de
      `.github/workflows/ts-frontend-ci-cd.yml`.
- [ ] T015 [P] [L-INFRA] Módulo Terraform
      `modules/infra/terraform/modules/compute/apps/prospecta_api/`
      (`main.tf`, `variables.tf`, `versions.tf`, `outputs.tf`), porta 8018 via
      `127.0.0.1`, `networks_advanced { name = var.network_name }`, com
      `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_SERVICE_NAME=prospecta-api`.
- [ ] T016 [P] [L-INFRA] Registrar `module "compute_apps_prospecta_api"` em
      `modules/infra/terraform/main.tf` e o bucket `prospecta-frontend` em
      `modules/infra/terraform/static_sites.tf`.
- [ ] T017 [P] [L-INFRA] Ingress em `modules/infra/terraform/locals.tf`:
      `prospecta-api.giomartins.dev → localhost:8022` e `prospecta.giomartins.dev
      → bucket`. Em `variables.tf`, `excluded_hostnames` para o hostname da SPA
      (pública de propósito), **com o porquê na mesma linha**.
- [ ] T018 [P] [L-INFRA] Entrada no `case` do `-replace` (o passo que quebra
      silenciosamente — `docs/novo-app-ci-cd.md` §6):
      `prospecta-api) REPLACE_ARGS+=("-replace=module.compute_apps_prospecta_api.docker_container.prospecta_api") ;;`
      nos workflows Go/Python/TS conforme o app.
- [ ] T019 [L-INFRA] Adicionar `prospecta-agent-worker` ao
      `python-ci-cd.yml` (auto-descoberto por `pyproject.toml` — confirmar que a
      descoberta cobre `modules/apps/prospecta-agent-worker/pyproject.toml`) e
      criar o stack `stacks/prospecta.yml` (rede `apps`, envs via `.env`,
      segredos do §9 do spec), no molde de `stacks/domain.yml`.
- [ ] T020 [L-INFRA] Bootstrap de schema: serviço one-shot
      `prospecta-db-init` (no espírito do `evolution-db-init`) criando os schemas
      `prospecta_*` no DB `domain`; aplicar a DDL do `data-model.md`.

**Checkpoint**: rodar os 3 workflows à mão (`gh workflow run ...`) e conferir por
`curl` — `https://prospecta-api.giomartins.dev/healthz` responde, e o hash do
bundle da SPA bate com o build local. Não confiar no check verde.

---

## Phase 2: User Story 1 — Empresa + ICP (Priority: P1) 🎯

**Goal**: a empresa se cadastra e define o ICP em linguagem natural; o dado
persiste pelo par de domínio e pode ser lido de volta.

**Independent Test**: criar empresa → definir ICP → `GET /companies/{id}`
retorna o ICP; via `quickstart.md`.

### Tests (write first, watch fail)

- [ ] T021 [US1] [L-DOMAIN] `.feature` em
      `modules/apps/domain-worker/features/prospecta_company.feature` — positivo
      (CreateCompany aplica + audit), negativo (payload inválido → 422, sem
      escrita parcial), edge (idempotência: mesmo comando duas vezes = 1 linha;
      id inexistente).
- [ ] T022 [P] [US1] [L-API] `.feature` em
      `modules/apps/prospecta-api/tests/features/company.feature` — `POST
      /companies` → 202; `GET /companies/{id}` → 200; `X-API-Key` ausente → 401;
      id inexistente → 404; ICP vazio → 422.

### Implementation

- [ ] T023 [US1] [L-DOMAIN] Agregado `Company` + `ICP` no `domain-*`
      (`internal/domain`), com `tenant_id` e RLS; comando `CreateCompany`/
      `DefineICP`; handler no `domain-worker`; gravação em `prospecta_company` e
      `prospecta_icp`; audit log (sucesso **e** falha).
- [ ] T024 [US1] [L-DOMAIN] Embedding do ICP: gerar via 9router (embeddings) e
      gravar em `prospecta_icp.embedding` (pgvector), com índice apropriado.
- [ ] T025 [US1] [L-API] `prospecta-api`: `POST /companies`, `GET /companies/{id}`,
      `POST /companies/{id}/icp` — leitura pelo par de domínio, escrita publica
      comando e devolve 202; middleware `X-API-Key`.
- [ ] T026 [US1] [L-FRONT] Tela **Configurações → Empresa** (perfil + ICP +
      tags) consumindo a API — fiel ao `poc.pen` (dark, orb-lattice no badge de
      agente).
- [ ] T027 [US1] [L-AGENT] `prospecta-agent-worker/main.py`: bootstrap
      (env obrigatórias como o worker financeiro), conexão AMQP, e consumidor de
      `CompanyRegistered`/`ICPDefined` (por ora só loga/registra).

**Checkpoint**: US1 entregável e testável sozinha.

---

## Phase 3: User Story 2 — Campanha + Agente busca (Priority: P1) 🎯

**Goal**: criar campanha a partir do ICP, disparar, e o agente encontrar,
qualificar e enriquecer leads — gravando via par de domínio.

**Independent Test**: criar campanha → start → em minutos, `GET /leads` mostra
leads com fit e fonte; feed de atividade registra o run.

### Tests (write first)

- [ ] T030 [US2] [L-AGENT] `.feature` em
      `modules/apps/prospecta-agent-worker/tests/features/prospecting.feature` —
      positivo (consome `ProspectRequested`, chama 9router via upstream HTTP
      real em container, produz `LeadDiscovered`); negativo (9router 5xx →
      retry/backoff, sem loop infinito); edge (ICP sem embedding, zero
      resultados, lead duplicado não re-insere).
- [ ] T031 [P] [US2] [L-DOMAIN] `.feature` em
      `modules/apps/domain-worker/features/prospecta_lead.feature` — upsert de
      lead idempotente, dedup por `domain+company_name`, `fit` fora de 0..100 →
      422.
- [ ] T032 [P] [US2] [L-API] `.feature` em
      `prospecta-api/tests/features/campaigns.feature` — `POST /campaigns` → 202;
      `POST /campaigns/{id}/start` → 202 + publica `ProspectRequested`; `GET
      /campaigns` paginado.

### Implementation

- [ ] T033 [US2] [L-DOMAIN] Agregados `Campaign` + `Lead` + `AgentRun`;
      comandos `CreateCampaign`, `StartCampaign`, `RequestProspect`, `UpsertLead`,
      `QualifyLead`; eventos `CampaignStarted`/`ProspectRequested`/
      `LeadQualified`; outbox durável.
- [ ] T034 [US2] [L-API] Endpoints de campanha e leads (§7.3), leitura e comando.
- [ ] T035 [US2] [L-AGENT] `agents/orchestrator.py` — máquina de estados do run
      (planejar → buscar → qualificar → enriquecer), com retry/circuit-breaker e
      estado em `prospecta_agent_run` (via API).
- [ ] T036 [US2] [L-AGENT] `agents/tools.py` — `web.search` (SerpAPI/Brave)
      respeitando `robots.txt`/rate-limit e `enrich.company` (Clearbit/Apollo/
      CNPJ); cada tool é um adapter isolado e testável.
- [ ] T037 [US2] [L-AGENT] `gateway/ninerouter.py` — cliente
      `POST /v1/chat/completions` (OpenAI-compatible), com fallback, timeout e
      budget por tenant; **única** porta de IA do worker.
- [ ] T038 [US2] [L-AGENT] Qualificação: gerar `fit` comparando o prospect ao
      embedding do ICP (pgvector via API) + sinais; publica `LeadEnriched`/
      `LeadQualified`.
- [ ] T039 [US2] [L-FRONT] Tela **Campanha** (construtor de ICP em linguagem
      natural, canais, plano do agente, preview) e **Cockpit** (métricas +
      painel "Agentes em ação" + tabela de leads + feed) — fiel ao `poc.pen`.

**Checkpoint**: US2 entregável; agente funciona sem a UI de abordagem.

---

## Phase 4: User Story 3 — Abordagem e-mail/WhatsApp (Priority: P1) 🎯

**Goal**: o agente redige, o humano aprova, o envio sai pela Evolution (WhatsApp)
ou e-mail; a resposta do cliente volta pro inbox.

**Independent Test**: aprovar uma mensagem → ela sai (Evolution/e-mail) →
simular resposta no RabbitMQ `evolution.messages.upsert` → aparece em
`GET /conversations`.

### Tests (write first)

- [ ] T040 [US3] [L-AGENT] `.feature` em
      `prospecta-agent-worker/tests/features/messaging.feature` — positivo
      (draft → aprovação → `sendText` com header `apikey` e `number` E.164 sem
      `+`); negativo (opt-out → **não envia**, publica `MessageBlocked`, jamais
      contorna); edge (payload Evolution v2.3.7 com `fromMe=true` é ignorado;
      grupo `@g.us` é recusado; resposta duplicada deduplicada).
- [ ] T041 [P] [US3] [L-DOMAIN] `.feature` em
      `domain-worker/features/prospecta_conversation.feature` — `ReceiveReply`
      idempotente por `thread_key`; `MessageApproved` só transiciona de
      `drafted`.
- [ ] T042 [P] [US3] [L-API] `.feature` em
      `prospecta-api/tests/features/conversations.feature` — `GET /conversations`,
      `GET /conversations/{id}`, `POST /messages`, `POST /messages/{id}/approve`.

### Implementation

- [ ] T043 [US3] [L-AGENT] `gateway/evolution.py` — **porta fiel** do
      `EvolutionClient` de `finance-customersupport-worker`
      (`send_text`/`send_media`, `jid_to_number`, header `apikey`); não
      reescrever semântica.
- [ ] T044 [US3] [L-AGENT] `consumers/evolution.py` — consome
      `evolution.messages.upsert` do RabbitMQ (exchange `evolution`), faz o parse
      do payload v2.3.7 e publica `ReplyReceived`.
- [ ] T045 [US3] [L-AGENT] `agents/composer.py` — redige a abordagem
      personalizada por lead via 9router, aplicando o tom de voz da empresa e
      rodapé de opt-out; publica `MessageDrafted`.
- [ ] T046 [US3] [L-AGENT] `agents/guardrails.py` — PII scrubbing antes do
      9router; consulta de opt-out **antes** de todo envio; `policy.approval=human`
      bloqueia envio automático no MVP.
- [ ] T047 [US3] [L-DOMAIN] Agregados `Message` + `Conversation`; comandos
      `DraftMessage`, `ApproveMessage`, `SendMessage`, `ReceiveReply`,
      `BookMeeting`; eventos `MessageSent`, `ReplyReceived`, `MeetingBooked`.
- [ ] T048 [US3] [L-AGENT] E-mail de saída (`D9`): adapter SES/Postmark com
      SPF/DKIM/DMARC e tratamento de bounce/complaint. **Só após D9 fechado.**
- [ ] T049 [US3] [L-FRONT] Tela **Conversas** (inbox unificado, thread, composer
      com sugestão aprovável) e **Leads** (tabela + drawer de detalhe) — fiel ao
      `poc.pen`.

**Checkpoint**: US3 entregável; WhatsApp ponta a ponta pela Evolution.

---

## Phase 5: User Story 4 — Cockpit, atividade e config (Priority: P2)

**Goal**: visão de operação — pipeline, métricas, feed ao vivo, time de agentes
com toggles, canais conectados e LGPD.

**Independent Test**: `GET /agent/activity` (SSE) emite eventos ao vivo enquanto
um run roda; config reflete agentes/canais.

### Tests (write first)

- [ ] T050 [US4] [L-API] `.feature` em
      `prospecta-api/tests/features/activity.feature` — SSE entrega eventos de
      `prospecta.agent_run` em ordem; cliente que desconecta não vaza goroutine.
- [ ] T051 [P] [US4] [L-DOMAIN] `.feature` em
      `domain-worker/features/prospecta_metrics.feature` — projeções do Cockpit
      (leads qualificados, reuniões, taxa de resposta, custo por lead) batem com
      os eventos.

### Implementation

- [ ] T052 [US4] [L-API] `GET /agent/activity` (SSE) + endpoints de métricas do
      Cockpit; leitura via par de domínio.
- [ ] T053 [US4] [L-DOMAIN] Projeções/materializações para as métricas do
      Cockpit (a partir dos eventos `prospecta.*`).
- [ ] T054 [US4] [L-FRONT] Tela **Configurações** completa (empresa, ICP, time de
      agentes com toggles e orbs, canais conectados, cartão LGPD) e o feed ao
      vivo do Cockpit (SSE). Ativar/desativar canal e agente.
- [ ] T055 [US4] [L-FRONT] Implementar o **design system** do `poc.pen` como
      componentes React (orbs, botões, input, badge, card de agente, tabela,
      drawer) — sem lib de UI externa.

**Checkpoint**: US4 entregável; operação vê tudo funcionando.

---

## Phase 6: Hardening & Entrega (Priority: P2)

- [ ] T060 [P] [L-QA] Cenários **negativos/edge transversais** em cada serviço:
      comando duplicado, broker indisponível, 9router timeout, Evolution fora,
      payload Evolution malformado, tenant cruzado (RLS), lead sem e-mail.
- [ ] T061 [L-INFRA] Observabilidade: confirmar OTLP no `alloy:4318` e
      `OTEL_SERVICE_NAME` nos 3 serviços; dashboard no Grafana (runs do agente,
      taxa de envio, opt-out, erros de 9router/Evolution).
- [ ] T062 [L-INFRA] Segredos no **Vault**: `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`
      (default `web-businesses`), `NINEROUTER_BASE_URL`/chave (se exigida),
      `PROSPECTA_API_KEYS`, credenciais de e-mail; documentar em `stacks/README.md`.
- [ ] T063 [L-QA] Carga: N campanhas simultâneas, dedup e idempotência sob
      concorrência; limites de rate-limit por tenant.
- [ ] T064 [L-QA] LGPD: verificar opt-out em todos os caminhos, PII scrubbing
      nos logs/traces e que telefone/e-mail nunca aparecem completos.
- [ ] T065 [L-INFRA] Atualizar `modules/apps/README.md` e `docs/architecture.md`
      com os 3 apps e o fluxo do Prospecta; conferir deploy por `curl`.

---

## Dependencies & Execution Order

```
T000–T008 (L-CONTRACTS)
      │  contrato travado
      ▼
T010–T020 (L-INFRA, paralelo desde já)
      │
      ├──────────────┬──────────────┬──────────────┐
      ▼              ▼              ▼              ▼
   L-DOMAIN       L-API         L-AGENT        L-FRONT
   T023+          T025+         T027+          (US1)
      └──────────────┴──────────────┴──────────────┘
                     │  US2 → US3 → US4 (cada uma fecha antes da próxima)
                     ▼
              T060–T065 (L-QA + hardening)
```

- **US1** antes de **US2** (o agente precisa do ICP). **US2** antes de **US3**
  (não há o que abordar sem leads). **US4** por último (observa o resto).
- `L-INFRA` e `L-CONTRACTS` são independentes das user stories e podem começar
  no minuto zero.
- Dentro de uma fase, tudo `[P]` roda junto; nada `[P]` toca o mesmo arquivo.

## Notes

- **Nunca** commitar sem `git status`/`git diff`; só commitar quando o humano
  pedir.
- Toda task de código é **test-first**: escreva o `.feature`, rode e veja
  falhar, só então implemente (`.claude/skills/feature-first-tdd/SKILL.md`).
- Verificar cada serviço imediatamente após implementar — por `curl`/teste, não
  pelo check verde.
- Reusar `EvolutionClient` e o envelope da casa; **não** reimplementar semântica
  de WhatsApp nem inventar broker/banco.

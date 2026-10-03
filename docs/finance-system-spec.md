# 💳 WhatsApp Financial Dashboard & Engine — Technical Specification

> **Status:** rascunho para revisão · **Branch:** `feat/finance-whatsapp-system`
> **Escopo desta spec:** desenho do domínio + o caminho real de deploy neste
> repositório (stack Dockhand) + plano de teste.
>
> **Regra desta spec:** toda seção de infraestrutura descreve o que este
> repositório **já faz hoje**. Nada de `docker-compose.yml` inventado, nada de
> `terraform apply -replace` — o Terraform ficou só com Cloudflare +
> `host_baseline`; os apps rodam por **stacks git-backed do Dockhand**.

---

## 1. Visão Geral do Sistema

Sistema de gestão financeira pessoal e empresarial com experiência
conversacional via WhatsApp, seguindo **DDD**, **CQRS** e **Event-Driven
Architecture**, com tipagem estrita.

### 1.1. Princípio Fundamental — Regra de Isolamento de Domínio

> O `finance-whatsapp-worker` **NUNCA** acessa banco de dados diretamente.
> Toda persistência, invariante de domínio e consulta passa estritamente pela
> `finance-api` — via REST tipado (queries) e mensageria (commands/eventos).

Esse princípio **não é novo neste repo**: é exatamente o desenho que já existe
entre `domain-api` (a porta de entrada de leitura/escrita do CQRS) e
`domain-worker` (o único escritor). A `finance-api` é a mesma ideia aplicada ao
bounded context financeiro — e a mesma disciplina deve valer:

- `finance-api` responde escrita com `202 Accepted` + `command_id`, publica o
  comando no RabbitMQ, e é o **único** componente com `DATABASE_URL`.
- `finance-whatsapp-worker` não tem banco, não importa driver de banco, e
  fala com a `finance-api` por HTTP + mensageria.

### 1.2. Decisões que ainda precisam de dono

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| D1 | Linguagem da `finance-api` | (a) Python 3.12 + FastAPI · (b) Go, espelhando `domain-api` | Ver §6.3 |
| D2 | Banco | (a) schema `finance` dentro do DB `domain` · (b) database próprio | (a) — (b) exige bootstrap em `persistence.yml` |
| D3 | Stack | (a) stack nova `finance` · (b) entrar no stack `domain` | (a) — ver §10 |
| D4 | Hostnames | nomes definitivos de API e webhook | §10.5 |
| D5 | Acesso | webhook do WhatsApp **público** (sem SSO); API com acesso | §10.5 |

---

## 2. Arquitetura do Sistema & Topologia de Comunicação

```
┌────────────────────────────────────────────────────────┐
│        Meta Cloud API (WhatsApp)  /  webhook gateway    │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS POST /webhook (assinatura)
                           ▼
┌────────────────────────────────────────────────────────┐
│            finance-whatsapp-worker                     │
│  ├─ NLU & Intent Parser                                │
│  ├─ Conversational State & Session Manager             │
│  ├─ Interactive UX Renderer (cards, emojis, menus)     │
│  └─ Chart Engine (PNG)                                 │
│                                                        │
│  sem banco · sem DATABASE_URL · sem driver de banco    │
└────────────┬─────────────────────────────┬─────────────┘
             │ 1. Commands                 │ 2. Queries
             │    (RabbitMQ, async)        │    (HTTP, sync)
             ▼                             ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│  RabbitMQ (stack           │ │  finance-api (HTTP)      │
│  persistence)              │ │  X-API-Key               │
└────────────┬──────────────┘ └────────────┬─────────────┘
             │ eventos de domínio           │
             ▼                              ▼
┌────────────────────────────────────────────────────────┐
│             finance-api (Domain API)                   │
│  Command Stack  → aggregates, invariantes, UoW, Outbox │
│  Read Stack      → projections, queries de dashboard   │
│  (único componente com DATABASE_URL)                   │
└────────────────────────────┬───────────────────────────┘
                             │
                             ▼
        PostgreSQL 17 (stack persistence, DB/schema do §8)
```

**Transporte — o que o repo já tem, sem inventar:**

- **Broker:** RabbitMQ do `stacks/persistence.yml` (usuário `domain`), na rede
  externa `apps`. Nada de subir um broker próprio.
- **Rede:** externa `apps` (`external: true`). Não criar rede nova.
- **Observabilidade:** `alloy:4318` já recebe OTLP; incluir
  `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_SERVICE_NAME` desde o primeiro deploy.

---

## 3. Bounded Contexts & DDD

### 3.1. Identity & Account Context
- **`User` (Aggregate Root)** — id, telefone WhatsApp (E.164), moeda,
  timezone, nível de detalhe dos alertas.
- **`Account` (Entity)** — corrente, carteira, poupança, investimento, cartão.
  Saldo e moeda.

### 3.2. Ledger & Transaction Context
- **`Transaction` (Aggregate Root)**
  - `TransactionId`: UUIDv7 (temporalmente ordenado).
  - `Money`: Value Object imutável (`amount: Decimal`, `currency: Currency`).
  - `TransactionType`: `INCOME | EXPENSE | TRANSFER`.
  - `Category`: Value Object.
  - `Source`: `TransactionSource(type: WHATSAPP_MANUAL | OPEN_FINANCE_SYNC, external_id: str | None)`.
  - `OccurredAt`: datetime tz-aware.

### 3.3. Budget & Goal Context
- **`Budget` (Aggregate Root)** — limite mensal por categoria, réguas de
  notificação 50/80/100%.
- **`FinancialGoal` (Aggregate Root)** — objetivo com previsão de alcance.

### 3.4. Invariantes que os testes precisam provar (§12.2)
1. `Money` nunca usa `float`; soma com `Decimal` exato.
2. Transferência é atômica: débito + crédito na mesma unidade de trabalho.
3. Nenhuma transação altera o saldo de conta de outro `User`.
4. `OccurredAt` é sempre tz-aware; armazenamento em UTC.
5. Réguas de `Budget` disparam **uma vez** por limiar por período.
6. Todo comando aplicado gera linha de auditoria (sucesso **ou** falha).

---

## 4. CQRS

### 4.1. Write Side — Commands (`finance-api`)
- `RegisterTransactionCommand`
- `CategorizeTransactionCommand`
- `SetCategoryBudgetCommand`
- `TransferBetweenAccountsCommand`
- `ReconcileOpenFinanceTransactionCommand` (Fase 2)

Contrato de escrita, igual ao padrão da casa: `POST` responde
`202 {"command_id": ..., "status": "accepted"}`, o comando vai para o broker, o
handler aplica e grava a auditoria. Só existe caminho síncrono (`/sync`, 200/422/504)
onde o chamador **realmente** não pode seguir sem confirmação — e o worker não
precisa: ele responde ao usuário de forma assíncrona. **Default: assíncrono.**

### 4.2. Read Side — Queries (`finance-api`)
- `GetDailySummaryQuery`
- `GetMonthlyDashboardQuery`
- `GetCategoryBreakdownQuery`
- `GetCashFlowHistoryQuery`

Leituras são `GET` simples com `X-API-Key`, servidas de projections.

### 4.3. Outbox & entrega
Publicação de evento de domínio via **Outbox** na mesma transação da escrita.
Entrega é at-least-once → todo consumidor precisa ser **idempotente** por
`command_id`/`event_id` (testado em §12.5).

---

## 5. Experiência do Usuário (WhatsApp) no Worker

### 5.1. Parsing flexível
- *"Gastei 45 no almoço hoje"* → despesa R$ 45,00, Alimentação.
- *"Recebi 3500 de freela"* → receita R$ 3.500,00, Renda Extra.
- *"Paguei 120 de luz no nubank"* → despesa R$ 120,00, conta Nubank.
- *"Como estão meus gastos este mês?"* → query de dashboard + resposta visual.

### 5.2. Dashboard visual
Card em texto (receitas/despesas/saldo, top categorias com barra, alertas) e
gráfico PNG quando o usuário pedir *gráfico*; *extrato* devolve a lista
detalhada. Os templates e o PNG entram em teste de golden file (§12.4).

---

## 6. Stack Tecnológica & Tipagem

### 6.1. O que o repositório usa hoje (fato)
- **Python:** 3.12 (`clubs-ingest`; `python-ci-cd.yml` usa `python-version: "3.12"`,
  imagem `python:3.12-slim`). É o que o CI sabe construir hoje.
- **Go:** 1.25 (`domain-api`, `domain-worker`).
- **DB:** PostgreSQL **17** (`postgres:17-alpine`, stack `persistence`), com
  uma única database `domain` e um usuário `domain` (`POSTGRES_USER`/`POSTGRES_DB`
  têm default `domain`).
- **Broker:** RabbitMQ (stack `persistence`).

### 6.2. Proposta para o `finance-whatsapp-worker`
- Python 3.12, `pyproject.toml` (hatchling), `pytest` + `pytest-bdd` +
  `testcontainers` + `docker` nos extras `dev` — idêntico a `clubs-ingest`.
- Pydantic v2 para contratos; nenhuma dependência de driver de banco.
- `httpx` para falar com a `finance-api`; `aio-pika` para o broker.
- Empacotamento: `packages = ["src/<pkg>"]`, entrypoint
  `python -m finance_whatsapp_worker.main`.

### 6.3. ⚠️ Decisão aberta (D1) — Python 3.14 vs 3.12, e Python vs Go
A versão anterior desta spec pedia **Python 3.14** e **FastAPI/SQLAlchemy**.
Nada disso existe no repo:
- o CI fixa **3.12** — pedir 3.14 significa subir uma imagem base nova sem
  relação com o que os outros apps testam;
- o CQRS de escrita/leitura já está implementado em **Go** (`domain-api`/
  `domain-worker`), e o financeiro é o mesmo desenho.

Opções honestas:
1. **Python 3.12 + FastAPI** para `finance-api` e worker — mais rápido de
   escrever, mas cria um segundo jeito de fazer CQRS no repo.
2. **Go** para `finance-api`, espelhando `domain-api` — consistência
   arquitetural, ao custo de reaproveitar o pacote de telemetria e reescrever
   os contratos em Go.
3. Python 3.14 — **não recomendado** sem antes subir isso em todo o CI.

**Recomendação:** (1) para começar (entrega mais rápida e o worker já é Python
de qualquer jeito), registrando explicitamente que o bounded context financeiro
tem sua própria `finance-api` em Python. Se a consistência com `domain-api`
pesar mais que a velocidade, escolher (2) antes do primeiro commit de código.

---

## 7. Estrutura no Monorepo (caminho real)

Nada de `finance-system/apps/...`: o repo é `modules/apps/<nome>/`, e o nome da
pasta **é** o nome da imagem e do container.

```
modules/
  apps/
    finance-api/                   # Domain API (CQRS write+read) — só ela vê o banco
      pyproject.toml
      Dockerfile
      src/finance_api/
        domain/                    # aggregates, entities, value objects, eventos
        application/               # command/query handlers, ports
        infrastructure/            # mapeamentos, repositórios, engine, broker
        presentation/              # rotas HTTP, schemas, DI
      tests/
        features/                  # cenários BDD
    finance-whatsapp-worker/       # worker conversacional — sem banco
      pyproject.toml
      Dockerfile
      src/finance_whatsapp_worker/
        nlu/                       # intent + extração (regras/LLM)
        rendering/                 # templates WhatsApp + gerador de PNG
        state/                     # sessão de conversa
        clients/                   # cliente HTTP da finance-api
        consumers/                 # consumidores do broker
        gateway/                   # integração Meta Cloud API
      tests/
        features/
stacks/
  finance.yml                      # NOVO — a stack do Dockhand (§10)
docs/
  finance-system-spec.md           # este documento
```

**Código compartilhado:** o repo **não tem** `packages/`. A convenção observada
é *vendorizar* (`clubs-ingest` embarca o cliente que usa dentro do próprio
pacote). Para contratos de evento compartilhados entre `finance-api` e worker,
a opção mais barata é gerar um módulo pequeno em `src/` de ambos a partir de
uma única fonte (schema versionado), em vez de subir um registry Python
privado — que não existe aqui.

**Dockerfile (padrão Python do repo):**

```dockerfile
# Contexto de build = RAIZ DO REPO (é o que o python-ci-cd.yml usa).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --create-home app
WORKDIR /app
COPY modules/apps/<nome> /tmp/app
RUN pip install --no-cache-dir /tmp/app && rm -rf /tmp/app
USER app
ENTRYPOINT ["python", "-m", "<pkg>.main"]
```

---

## 8. Modelo de Dados

### 8.1. Onde mora (D2)
`persistence.yml` cria **uma** database (`POSTGRES_DB=domain`) e um usuário
(`domain`). Duas saídas:

- **(a) schema `finance` dentro de `domain`** — zero mudança em
  `persistence.yml`; a `finance-api` usa `search_path=finance`. **Recomendado.**
- **(b) database própria** — exige um passo de bootstrap em `persistence.yml`
  (ex.: `finance-db-init`, no espírito do `evolution-db-init` do `compute.yml`).

### 8.2. Convenções
- Migrações **versionadas e idempotentes**, aplicadas no start da `finance-api`
  ou por job dedicado; em produção, expand-contract (ver §10.8 rollback).
- `audit_log` de comandos (sucesso **e** falha) — mesma ideia do `domain-api`:
  a linha de auditoria é a prova de "aplicado", não o publish no broker.
- Índices mínimos: `(user_id, occurred_at DESC)`, `(user_id, category, month)`,
  `command_id` único na auditoria.
- Dinheiro em `NUMERIC`; **nunca** `float`.

---

## 9. Observabilidade

- `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318` e
  `OTEL_SERVICE_NAME=finance-api` / `finance-whatsapp-worker`.
- Logs já fluem (o alloy faz scrape do stdout de todo container) — basta não
  escrever segredo no log (ver §11.2).
- Métricas de negócio sugeridas: comandos aceitos/rejeitados por tipo,
  latência da query de dashboard, idade da fila, contadores de réguas de budget.

---

## 10. Deploy — stack nova no Dockhand (com environments)

> Esta é a seção que faltava. O caminho **não** é `terraform apply` nem
> `-replace`: os apps deste repo rodam em **stacks git-backed do Dockhand**.
> O Terraform só cuida de Cloudflare + `host_baseline`.

### 10.1. Como o deploy realmente funciona

1. O workflow da linguagem (`python-ci-cd.yml`) constrói e publica
   `registry.giomartins.dev:5000/<app>:latest` (+ `:<sha>`).
2. O job `deploy` chama, por SSH loopback, o **webhook do git stack** no
   Dockhand:
   ```
   http://127.0.0.1:8093/api/git/stacks/<ID>/webhook?secret=$DOCKHAND_WEBHOOK_SECRET
   ```
   O mapa app→stack vive num `declare -A STACK=( ... )` no próprio workflow.
3. O Dockhand faz o pull da `:latest` e recria os containers daquele stack.

Como o mapa é explícito por id numérico, **um app sem entrada no mapa builda,
publica e não sobe** — falha silenciosa. É o primeiro item a conferir.

### 10.2. Arquivo `stacks/finance.yml` (novo)

Segue as convenções obrigatórias de `stacks/README.md`: `name:` = nome do stack
no Dockhand; rede externa `apps`; imagem do registry; **segredo nunca no git**,
só `${VAR}`.

```yaml
# finance.yml — bounded context financeiro. Depende de persistence.yml
# (postgres, rabbitmq) e do compute (alloy p/ OTLP), pela rede `apps`.
#
# Segredos (variáveis de stack no Dockhand — NÃO no git):
#   POSTGRES_PASSWORD   (a MESMA do persistence.yml)
#   RABBITMQ_PASSWORD   (a MESMA do persistence.yml)
#   FINANCE_API_KEYS        (lista key:label, um caller por serviço)
#   FINANCE_WORKER_API_KEY  (a key do worker, espelhada em FINANCE_API_KEYS)
#   WHATSAPP_VERIFY_TOKEN / WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID
name: finance

services:
  finance-api:
    image: registry.giomartins.dev:5000/finance-api:latest
    container_name: finance-api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-domain}:${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-domain}
      RABBITMQ_URL: amqp://${RABBITMQ_USER:-domain}:${RABBITMQ_PASSWORD:?defina RABBITMQ_PASSWORD}@rabbitmq:5672/
      HTTP_ADDR: ":8000"
      FINANCE_API_KEYS: ${FINANCE_API_KEYS:?defina FINANCE_API_KEYS}
      RATE_LIMIT_RPS: "5"
      RATE_LIMIT_BURST: "20"
      OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4318
      OTEL_SERVICE_NAME: finance-api
    ports:
      - "127.0.0.1:8018:8000"      # porta loopback nova — ver §10.5
    networks: [apps]

  finance-whatsapp-worker:
    image: registry.giomartins.dev:5000/finance-whatsapp-worker:latest
    container_name: finance-whatsapp-worker
    restart: unless-stopped
    environment:
      # SEM DATABASE_URL — regra de isolamento (§1.1)
      FINANCE_API_BASE_URL: http://finance-api:8000
      FINANCE_API_KEY: ${FINANCE_WORKER_API_KEY:?defina FINANCE_WORKER_API_KEY}
      RABBITMQ_URL: amqp://${RABBITMQ_USER:-domain}:${RABBITMQ_PASSWORD:?defina RABBITMQ_PASSWORD}@rabbitmq:5672/
      HTTP_ADDR: ":8080"
      WHATSAPP_VERIFY_TOKEN: ${WHATSAPP_VERIFY_TOKEN:?defina WHATSAPP_VERIFY_TOKEN}
      WHATSAPP_ACCESS_TOKEN: ${WHATSAPP_ACCESS_TOKEN:?defina WHATSAPP_ACCESS_TOKEN}
      WHATSAPP_PHONE_NUMBER_ID: ${WHATSAPP_PHONE_NUMBER_ID:?defina WHATSAPP_PHONE_NUMBER_ID}
      OTEL_EXPORTER_OTLP_ENDPOINT: http://alloy:4318
      OTEL_SERVICE_NAME: finance-whatsapp-worker
    ports:
      - "127.0.0.1:8019:8080"      # webhook do WhatsApp — ver §10.5
    networks: [apps]

networks:
  apps:
    external: true
    name: apps
```

### 10.3. Environments (variáveis de stack no Dockhand)

Criar a stack e cadastrar os **valores** no Dockhand (criptografados no DB dele;
`/opt/dockhand` + `.encryption_key` entram no backup). Reuso obrigatório das
senhas já existentes:

| Variável | Escopo | Valor |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | finance-api | a MESMA de `persistence.yml` |
| `RABBITMQ_PASSWORD` | ambos | a MESMA de `persistence.yml` |
| `POSTGRES_USER` / `POSTGRES_DB` | finance-api | defaults `domain` (só mudar com D2) |
| `FINANCE_API_KEYS` | finance-api | lista `key:label`, um caller por serviço |
| `FINANCE_WORKER_API_KEY` | worker | a key do worker, espelhada em `FINANCE_API_KEYS` |
| `WHATSAPP_VERIFY_TOKEN` | worker | token do webhook (Meta) |
| `WHATSAPP_ACCESS_TOKEN` | worker | token de envio (Meta Cloud API) |
| `WHATSAPP_PHONE_NUMBER_ID` | worker | id do número |

`DATABASE_URL`/`RABBITMQ_URL` **não** são variáveis de stack: são montadas no
compose a partir das senhas, como no `domain.yml`.

### 10.4. Passo a passo (o que fazer, na ordem)

1. Escrever `stacks/finance.yml` (§10.2) no branch e commitar.
2. No Dockhand: **Create stack** → git-backed, *context directory* `stacks`,
   compose file `finance.yml`, nome `finance`.
3. Cadastrar as variáveis de stack da tabela §10.3.
4. Ajustar o CI: `python-ci-cd.yml` — (a) adicionar
   `modules/apps/finance-api/**` e `modules/apps/finance-whatsapp-worker/**`
   ao filtro `paths:`; (b) adicionar as duas entradas ao
   `declare -A STACK=( ... )` do job `deploy`.
5. Descobrir o **id numérico** da stack nova (o próprio URL do webhook no
   Dockhand mostra: `/api/git/stacks/<ID>/webhook`) e colar no mapa do passo 4.
6. `python-ci-cd.yml` já usa contexto de build = raiz do repo; **não** alterar.
7. Primeiro deploy: rodar o workflow à mão
   (`gh workflow run python-ci-cd.yml -f app=finance-api`, idem worker).
   Dois motivos: (a) mudanças só em `.github/workflows/**` não disparam nada
   sozinhas; (b) o gatilho `push` é `branches: [main]` — enquanto o trabalho
   estiver em `feat/finance-whatsapp-system`, **nenhum push dispara o
   pipeline**, então o filtro `paths:` do passo 4 só passa a valer depois do
   merge.
8. Subir a stack no Dockhand (depois de `persistence`, `core`, `compute`).
9. Verificar (§10.6). Só então considerar o deploy feito.

> **Pitfall do contexto compartilhado** (`stacks/README.md`): com todos os
> arquivos em `stacks/`, a detecção de mudança é por diretório — um commit em
> qualquer arquivo pode redeployar todos os stacks apontados para `stacks/`.
> Se isso incomodar, ponha `finance.yml` na própria subpasta e aponte o context
> do stack para ela.

### 10.5. Ingress & Cloudflare Access (as três edições que importam)

`stacks/ingress/default.conf` é o nginx versionado (o TF não gera mais isso):
adicionar dois `server`, com a porta batendo com o `ports` do §10.2.

```nginx
server {
  listen 80;
  server_name finance.giomartins.dev;
  location / { proxy_pass http://127.0.0.1:8018; }
}

server {
  listen 80;
  server_name finance-webhook.giomartins.dev;
  location / { proxy_pass http://127.0.0.1:8019; }
}
```

Portas loopback **já usadas** (conferidas nas stacks): 5000 (registry — a
única publicada em todas as interfaces), 8000 (domain-api), 8007 (tela-api),
8017 (clubs-api), 8080 (evolution), 8092 (adminer), 8093 (dockhand),
8222 (vaultwarden), 8799 (omb/maus), 9000/9001 (minio — S3 API/console),
20128 (9router), 3000 (grafana), 4318 (alloy/OTLP), 15672 (rabbit — só
management). O `ingress` em si é nginx em `network_mode: host` escutando
**somente :80**, então não ocupa porta loopback. `8018`/`8019` estão livres.

No Terraform (que **segue** cuidando de DNS/Access), duas edições:

1. **`modules/infra/terraform/locals.tf`** — adicionar os **dois** hostnames a
   `local.services`, com a porta loopback do §10.2:

   ```hcl
   { hostname = "finance.giomartins.dev",         port = 8018 },
   { hostname = "finance-webhook.giomartins.dev", port = 8019 },
   ```

   É **daqui** que sai o A record: `main.tf` monta
   `hostnames = concat([for s in local.services : s.hostname], ...)` e
   `modules/cloud/cloudflare/dns.tf` faz `for_each = toset(var.hostnames)`.
   Sem esta entrada **não há DNS** — `excluded_hostnames` sozinho não cria
   registro nenhum.
2. **`modules/infra/terraform/variables.tf`** —
   **`finance-webhook.giomartins.dev` → adicionar a `excluded_hostnames`.**
   A Meta não consegue passar por um login Google; o webhook precisa ser
   público e se defender por assinatura (`X-Hub-Signature-256`) + verificação de
   origem. Comente o porquê na linha, como manda o padrão do repo.
- **`finance.giomartins.dev`** — decidir: se a API for só máquina-a-máquina
  (worker + Open Finance), o caminho normal é ficar **atrás** do Access e usar
  service token; se for consumida por SPA, precisa da decisão de auth própria.

### 10.6. Conferir que subiu de verdade

Não confiar no check verde — a `:latest` nunca muda de tag, então um deploy
"verde" pode ter recriado o container com a imagem velha.

```bash
# 1. o webhook do Dockhand respondeu sucesso?
#    (o workflow já falha se não vier "success":true)
# 2. o processo está no ar e saudável
curl -s https://finance.giomartins.dev/healthz
# 3. a imagem em execução é a que o CI acabou de publicar
ssh ubuntu@$VPS_HOST \
  'docker inspect -f "{{.Image}} {{.Config.Image}}" finance-api finance-whatsapp-worker'
# 4. o digest bate com o :<sha> recém-publicado
# 5. smoke real: um comando ponta a ponta pelo worker
```

### 10.7. Onde a stack entra na ordem de subida

`bootstrap → persistence → core → compute → observability → domain → clubs →
tela → finance → maus`. A `finance` depende de `persistence` (postgres,
rabbitmq), `core` (registry) e `compute`/`observability` (alloy p/ OTLP).

### 10.8. Rollback

- Imagens também são publicadas como `:<sha>` → redeploy do stack com a tag
  anterior é o rollback rápido.
- Migrações **expand-contract**: adicionar coluna/índice numa release, parar de
  usar na seguinte — nunca dropar no mesmo deploy que introduz a mudança.
- Rollback do stack no Dockhand (redeploy do commit anterior de `finance.yml`)
  só resolve compose, não schema: as duas coisas têm de ser compatíveis.

---

## 11. Pipeline (CI) — o que muda

`python-ci-cd.yml` já faz o essencial: descobre por `pyproject.toml`, instala
`[dev]` sem `|| true`, roda `pytest`, builda com contexto na raiz do repo,
publica `:latest` + `:<sha>` e chama o webhook do Dockhand.

Mudanças necessárias:

1. **Filtro `paths:`** — hoje só `modules/apps/clubs-ingest/**`; adicionar os
   dois apps do financeiro.
2. **`declare -A STACK=( ... )`** no job `deploy` — adicionar
   `[finance-api]=<id> [finance-whatsapp-worker]=<id>` (§10.4 passos 4–5).
3. Se a `finance-api` for **Go** (D1 = opção 2), o caminho é o
   `go-ci-cd.yml` e o mapa dele — o `finance-whatsapp-worker` continua Python.

### 11.1. Regra de não-pular
Os extras `dev` (`pytest-bdd`, `testcontainers`, `docker`) são o que faz os
cenários de integração rodarem de verdade. A instalação **não** leva `|| true`:
se falhar, o job tem de ficar vermelho — *um teste que se pula não existe*.

### 11.2. Segredos no CI
O repo busca credencial do registry no Vaultwarden via
`modules/infra/terraform/scripts/fetch_vault_secret.sh`, com máscara
`::add-mask::`. (Caminho com `modules/infra/...`: **não** existe `scripts/` na
raiz — conferido.) Novos segredos do
financeiro (tokens do WhatsApp) entram como **variáveis de stack no Dockhand**
(§10.3), não como GitHub Secret nem no compose.

---

## 12. Plano de Teste

Objetivo: provar que o sistema funciona ponta a ponta **e** que a regra de
isolamento do §1.1 é estrutural, não uma promessa.

### 12.1. Camadas e ferramenta

| Camada | O que prova | Ferramenta | Roda em |
| --- | --- | --- | --- |
| Unit (domínio) | invariantes §3.4, `Money`/`Decimal`, réguas de budget | `pytest`, `hypothesis` | todo push |
| Componente | handlers com portas falsas (sem broker/DB) | `pytest` | todo push |
| Contrato | worker↔api: schemas de request/response e de eventos batem com a fonte única | `pytest` + validação de schema | todo push |
| Integração | Postgres+RabbitMQ reais, outbox, idempotência, auditoria | `pytest-bdd` + `testcontainers` + `docker` | todo push |
| E2E (worker) | webhook → NLU → API → evento → resposta → PNG | `pytest` + broker/DB reais | nightly + manual |
| Isolamento | worker **não** abre conexão de banco | teste estático + teste de rede | todo push |
| Não-funcional | rate limit, fila, latência da query | `pytest` + métricas | nightly |

### 12.2. Casos obrigatórios (domínio)
- Soma de `Money` com `Decimal` exato; `float` proibido (falha se aparecer).
- Transferência atômica — falha no crédito reverte o débito.
- Saldo de um `User` imune a transação de outro.
- `OccurredAt` tz-aware; render no fuso do usuário, armazenamento em UTC.
- Régua de budget dispara **uma vez** por limiar por período.
- Comando rejeitado **ainda** grava auditoria com o motivo.

### 12.3. Casos de contrato (os de maior retorno)
- `POST` de comando responde `202 {command_id, status:"accepted"}`.
- `/sync` (se existir) devolve 200 aplicado / 422 rejeitado / 504 timeout — e o
  teste deixa explícito que **timeout ≠ não-escrito**.
- Evento publicado no broker tem `event_id`/`command_id` e schema versionado.
- `X-API-Key` inválida/ausente → 401; a key identifica o caller na auditoria.

### 12.4. Golden files (UX)
- Cards de WhatsApp: entrada fixa → saída de texto idêntica (emoji, barras,
  acentuação, quebras).
- Gráficos PNG: render determinístico com seed fixa; comparar dimensões e
  (não bytes) as séries desenhadas, para não quebrar a cada versão de fonte.
- Casos de borda: valor zero, valor negativo, mês sem dados, categoria vazia,
  mensagem ambígua ("gastei 45" sem contexto).

### 12.5. Idempotência e outbox
- Mesmo `command_id` entregue duas vezes ⇒ efeito único.
- Replay de evento não duplica transação nem alerta de budget.
- Broker fora do ar na hora do publish ⇒ comando continua na outbox e é
  publicado depois (sem perder a escrita).

### 12.6. Isolamento (§1.1) — como provar, não prometer
- **Estático:** `finance-whatsapp-worker` não pode ter dependência de driver de
  banco nem `DATABASE_URL` no compose (o teste lê `stacks/finance.yml`).
- **Dinâmico:** durante o E2E, o worker não abre socket para `postgres:5432`.
- **Grafo de imports:** nenhum import do worker alcança
  `infrastructure/postgres` da API.

### 12.7. Verificação de deploy (o teste que o check verde não faz)
- `curl https://finance.giomartins.dev/healthz` → 200.
- Digest da imagem em execução == o `:<sha>` publicado neste build.
- Webhook do Dockhand respondeu `"success":true` (o workflow já barra se não).
- Smoke pós-deploy: enviar um comando e assertar o efeito via query — se o
  digest não mudou, o smoke falha de propósito (é o sintoma da `:latest`).

### 12.8. E2E — cenários BDD (esqueleto)
```gherkin
Cenário: Despesa por mensagem gera transação e resposta visual
  Dado um usuário cadastrado com telefone "+55..."
  Quando ele envia "Gastei 45 no almoço hoje"
  Então uma transação EXPENSE de R$ 45,00 em Alimentação é registrada
  E ele recebe o resumo do dia com o valor atualizado

Cenário: Aviso de orçamento dispara uma única vez
  Dado um orçamento de Alimentação de R$ 100,00
  Quando o acumulado cruza 80%
  Então exatamente um alerta é enviado
  E um segundo gasto em Alimentação não repete o alerta

Cenário: Broker indisponível não perde a escrita
  Dado que o RabbitMQ está fora do ar
  Quando ele envia "Recebi 3500 de freela"
  Então o comando fica na outbox
  E após o broker voltar, a transação é aplicada uma única vez
```

### 12.9. Gates e critério de saída
- **Todo push:** unit + componente + contrato + isolamento.
- **Merge:** + integração (testcontainers) verde.
- **Nightly:** E2E + não-funcional.
- **Release (tudo verde, sem exceção):**
  1. suíte completa verde no CI;
  2. deploy aplicado e **verificado por digest** (§12.7);
  3. smoke ponta a ponta passando em produção;
  4. rollback ensaiado ao menos uma vez (§10.8);
  5. nenhum segredo no diff do compose.

---

## 13. Preparação para Open Finance (Fase 2)

1. O worker continua registrando transações manuais via WhatsApp, falando com a
   `finance-api`.
2. O conector Open Finance consome dados bancários e chama os endpoints/eventos
   da `finance-api` (mais um `X-API-Key` próprio em `FINANCE_API_KEYS`).
3. A `finance-api` roda a engine de conciliação/deduplicação
   (`TransactionFingerprint`) e notifica o worker por evento assíncrono, que
   avisa o usuário no WhatsApp.

---

## 14. Riscos & questões abertas

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| App publicado sem entrada no mapa `STACK` | build verde, nada sobe | conferir §10.4-4/5; smoke por digest §12.7 |
| Contexto `stacks/` compartilhado | commit em um arquivo redeploya vários | subpasta própria se incomodar (§10.4) |
| `:latest` não muda | "deploy" que não muda nada | verificação por digest (§10.6) |
| D1 não decidida | retrabalho grande depois | decidir antes do primeiro commit de código |
| Webhook sem proteção | endpoint público | assinatura Meta + rate limit + verificação de origem |
| Migração incompatível com rollback | rollback quebra schema | expand-contract (§10.8) |

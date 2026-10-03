# 💳 WhatsApp Financial Dashboard & Engine — Technical Specification

## 1. Visão Geral do Sistema (System Overview)
Sistema de gestão financeira pessoal e empresarial completo com experiência conversacional rica via WhatsApp, projetado seguindo **Domain-Driven Design (DDD)**, **CQRS (Command Query Responsibility Segregation)** e **Event-Driven Architecture (EDA)** em **Python 3.14 (Hard Typed)** com **SQLAlchemy 2.0+ (Async / Typed Mappings)**.

### Princípio Fundamental de Arquitetura
> **Regra de Isolamento de Domínio:** O `finance-whatsapp-worker` **NUNCA** acessa a base de dados diretamente. Toda persistência, regras de negócio, invariantes de domínio e consultas passam estritamente pela **`finance-api` (Domain API)** através de APIs tipadas (REST/gRPC) e mensageria assíncrona (Event Bus).

---

## 2. Arquitetura do Sistema & Topologia de Comunicação

```
┌────────────────────────────────────────────────────────┐
│             WhatsApp Webhook / Gateway                 │
│              (Meta Cloud API / Baileys)                │
└──────────────────────────┬─────────────────────────────┘
                           │ Webhook Event (Mensagem do Usuário)
                           ▼
┌────────────────────────────────────────────────────────┐
│            finance-whatsapp-worker                     │
│  ├─ NLU & Intent Parser (Comandos & Linguagem Natural) │
│  ├─ Conversational State & Session Manager             │
│  ├─ Interactive UX Renderer (Cards, Emojis, Menus)    │
│  └─ Dynamic Chart Engine (Matplotlib/Pillow -> PNG)   │
└────────────┬─────────────────────────────┬─────────────┘
             │ 1. Dispara Commands         │ 2. Executa Queries
             │    & Consome Eventos        │    (DTOs de Leitura)
             ▼                             ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│   Message Broker          │ │ HTTP / gRPC Client       │
│   (RabbitMQ / Redis)      │ │ (mTLS, Auth & Tracing)   │
└────────────┬──────────────┘ └────────────┬─────────────┘
             │ Async Events / Commands     │ Sync Queries / Fast-path
             ▼                             ▼
┌────────────────────────────────────────────────────────┐
│             finance-api (Domain API)                   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Command Stack (Write Model)                      │  │
│  │  - Command Handlers & Domain Invariants          │  │
│  │  - DDD Aggregates (Account, Transaction, Budget) │  │
│  │  - Unit of Work & Outbox Pattern                 │  │
│  └──────────────────────────┬───────────────────────┘  │
│                             │ Emite Domain Events      │
│                             ▼                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Read Stack (Query Model - CQRS)                  │  │
│  │  - Projections & Materialized Views              │  │
│  │  - Fast Query Handlers (Dashboards, Extratos)    │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────┬───────────────────────────┘
                             │
                             │ Conexão Segura & Exclusiva
                             ▼
              PostgreSQL Database (Asyncpg)
```

---

## 3. Bounded Contexts & DDD (Domain-Driven Design)

### 3.1. Contexto de Identidade & Contas (`Identity & Account Context`)
* **`User` (Aggregate Root)**: Identificação única, telefone WhatsApp (E.164), preferências de moeda, timezone e nível de detalhamento de alertas.
* **`Account` (Entity)**: Conta corrente, carteira física, poupança, conta de investimento ou cartão de crédito. Possui controle de saldo e moeda.

### 3.2. Contexto de Ledger & Transações (`Ledger & Transaction Context`)
* **`Transaction` (Aggregate Root)**:
  * `TransactionId`: UUIDv7 tipado e sequencial temporalmente.
  * `Money`: Value Object imutável (`amount: Decimal`, `currency: Currency`).
  * `TransactionType`: Enum (`INCOME`, `EXPENSE`, `TRANSFER`).
  * `Category`: Value Object de categoria (Alimentação, Transporte, Lazer, Saúde, Moradia, etc.).
  * `Source`: Value Object `TransactionSource(type: WHATSAPP_MANUAL | OPEN_FINANCE_SYNC, external_id: str | None)`.
  * `OccurredAt`: Datetime consciente de fuso horário.

### 3.3. Contexto de Planejamento & Orçamentos (`Budget & Goal Context`)
* **`Budget` (Aggregate Root)**: Metas mensais de limite por categoria com réguas de notificação (50%, 80%, 100%).
* **`FinancialGoal` (Aggregate Root)**: Objetivos financeiros de curto/médio prazo com cálculo de previsão de alcance.

---

## 4. CQRS (Command Query Responsibility Segregation)

### 4.1. Write Side — Commands executados na `finance-api`
* `RegisterTransactionCommand`: Criação de despesa ou receita validada com invariantes de saldo e categoria.
* `CategorizeTransactionCommand`: Reclassificação manual ou inteligente de transações.
* `SetCategoryBudgetCommand`: Configuração de orçamentos e limites por categoria.
* `TransferBetweenAccountsCommand`: Transferência atômica entre contas com lançamento de débito e crédito.
* `ReconcileOpenFinanceTransactionCommand`: Conciliação idempotente de dados bancários (Fase 2).

### 4.2. Read Side — Queries executadas na `finance-api`
* `GetDailySummaryQuery`: Resumo financeiro do dia formatado para consumo do worker.
* `GetMonthlyDashboardQuery`: Indicadores consolidados do mês (Total Receitas, Despesas, Economia, Top Categorias).
* `GetCategoryBreakdownQuery`: Dados agregados para montagem do gráfico de pizza/rosca.
* `GetCashFlowHistoryQuery`: Série temporal de fluxo de caixa para gráfico de barras.

---

## 5. Experiência do Usuário (UX WhatsApp) no Worker

O `finance-whatsapp-worker` é especializado em oferecer uma experiência conversacional fluida e moderna:

### 5.1. Parsing Flexível de Linguagem Natural
* *"Gastei 45 no almoço hoje"* ➔ Identifica Despesa R$ 45,00 em Alimentação.
* *"Recebi 3500 de freela"* ➔ Identifica Receita R$ 3.500,00 em Renda Extra.
* *"Paguei 120 de luz no nubank"* ➔ Despesa R$ 120,00 na conta Nubank.
* *"Como estão meus gastos este mês?"* ➔ Solicita a query de dashboard e gera a resposta visual.

### 5.2. Dashboard Visual Rico com Gráficos e Emojis
1. **Cards Visuais em Texto:**
   ```text
   📊 *RESUMO MENSAL — OUTUBRO 2026*
   ──────────────────────────
   🟢 *Receitas:* R$ 8.500,00
   🔴 *Despesas:* R$ 4.230,00
   💰 *Saldo Líquido:* R$ 4.270,00 (50.2% poupado)

   🏆 *Top Categorias:*
   1. 🍔 Alimentação: R$ 1.450,00 [████████░░] 34%
   2. 🏠 Moradia:     R$ 1.200,00 [██████░░░░] 28%
   3. 🚗 Transporte:  R$   580,00 [███░░░░░░░] 13%

   ⚠️ *Alertas:*
   • Alimentação atingiu 85% do limite orçado.
   ──────────────────────────
   Envie *gráfico* para visualização analítica ou *extrato* para lista detalhada.
   ```
2. **Gráfico Analítico em Alta Resolução:**
   * O worker consome a query da `finance-api` e renderiza um gráfico elegante (PNG) com paleta moderna e envia diretamente no chat.

---

## 6. Stack Tecnológica & Tipagem Estrita (Hard Typed)

* **Linguagem**: Python 3.14 (annotations deferidas, type parameters PEP 695).
* **Tipagem**: Mypy strict / Pyright estrito, sem uso de `Any`.
* **Domain & Data Modeling**: Pydantic v2 + Dataclasses (`slots=True, frozen=True`).
* **Database & ORM**: SQLAlchemy 2.0+ Async (`Mapped[...]`, `mapped_column`), `asyncpg`, PostgreSQL 16.
* **Comunicação entre Serviços**:
  * **Síncrona/Queries**: HTTP REST / gRPC client assíncrono (`httpx.AsyncClient`).
  * **Assíncrona/Events**: RabbitMQ (AMQP via `aio-pika`) ou Redis Streams.
* **Framework Web**: FastAPI para a `finance-api` e endpoint de webhook no worker.

---

## 7. Estrutura do Monorepo

```
gio-random-projects/
└── finance-system/
    ├── apps/
    │   ├── finance-api/               # Domain API (Regras de Domínio, CQRS, Banco de Dados)
    │   │   ├── src/
    │   │   │   ├── domain/            # Aggregates, Entities, Value Objects, Domain Events
    │   │   │   ├── application/       # Command & Query Handlers, Application Services
    │   │   │   ├── infrastructure/    # SQLAlchemy Mappings, Repositories Impl, DB Engine
    │   │   │   └── presentation/      # FastAPI Routers, Schemas, Dependency Injection
    │   │   ├── tests/
    │   │   ├── Dockerfile
    │   │   └── pyproject.toml
    │   │
    │   └── finance-whatsapp-worker/   # Conversational Worker (NLU, Charts, WhatsApp Gateway)
    │       ├── src/
    │       │   ├── nlu/               # Intent parsing & regex/LLM extractors
    │       │   ├── rendering/         # WhatsApp text templates & Chart generators (PNG)
    │       │   ├── state/             # Conversation session management
    │       │   ├── clients/           # HTTP/gRPC client para comunicação com a finance-api
    │       │   ├── consumers/         # Message broker consumers (Eventos de domínio)
    │       │   └── gateway/           # WhatsApp Provider integration (Meta Cloud API)
    │       ├── tests/
    │       ├── Dockerfile
    │       └── pyproject.toml
    │
    ├── packages/
    │   ├── finance-core/              # Value Objects e contratos de eventos compartilhados
    │   └── finance-messaging/         # Protocolos e schemas de mensagens de mensageria
    │
    ├── docker-compose.yml             # PostgreSQL, RabbitMQ, finance-api, finance-whatsapp-worker
    └── docs/
        └── finance-system-spec.md     # Especificação técnica atualizada
```

---

## 8. Preparação para Open Finance (Fase 2)
1. O worker continuará registrando transações manuais via WhatsApp comunicando-se com a `finance-api`.
2. O futuro conector Open Finance consumirá transações bancárias e chamará os endpoints/eventos da `finance-api`.
3. A `finance-api` executará a engine de conciliação e deduplicação (`TransactionFingerprint`), notificando o worker via evento assíncrono para informar o usuário no WhatsApp sobre confirmações automáticas.

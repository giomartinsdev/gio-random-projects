# 📊 WhatsApp Financial Dashboard & Engine — Technical Specification

## 1. Visão Geral do Sistema (System Overview)
Sistema de gestão financeira pessoal e empresarial completo com experiência conversacional rica via WhatsApp, projetado seguindo **Domain-Driven Design (DDD)**, **CQRS (Command Query Responsibility Segregation)** e **Event-Driven Architecture (EDA)** em **Python 3.14 (Hard Typed)** com **SQLAlchemy 2.0+ (Async / Typed Mappings)**.

O sistema opera em duas aplicações principais desacopladas:
1. **`finance-api`**: Provedor central de dados, API REST/GraphQL de consulta e mutação analítica, CQRS Read Models, autenticação e suporte para futura ingestão assíncrona de Open Finance.
2. **`finance-whatsapp-worker`**: Worker assíncrono orientado a eventos para processamento de mensagens, NLU/parsing de linguagem natural, geração de gráficos visuais (painéis UX no WhatsApp), gestão de contexto conversacional e orquestração de comandos.

---

## 2. Arquitetura & Padrões de Projeto (DDD & CQRS)

```
                       ┌───────────────────────────────┐
                       │   WhatsApp Webhook / Gateway  │
                       │   (Meta Cloud API / Baileys)  │
                       └───────────────┬───────────────┘
                                       │ Webhook Event
                                       ▼
                       ┌───────────────────────────────┐
                       │    finance-whatsapp-worker    │
                       │ ├─ NLU & Intent Parser        │
                       │ ├─ Session / Context Manager  │
                       │ ├─ Command Dispatcher         │
                       │ └─ UX Renderer (Text+Charts)  │
                       └───────┬───────────────┬───────┘
                               │               │
                     Dispatches│               │Publishes UI Events
                      Commands │               │
                               ▼               ▼
 ┌───────────────────────────────────────────────────────────┐
 │               Message Broker (RabbitMQ / Redis)           │
 └─────────────────────────────┬─────────────────────────────┘
                               │
                               │ Consumes Commands/Events
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │                        finance-api                        │
 │ ┌───────────────────────────────────────────────────────┐ │
 │ │                   Command Stack (Write)               │ │
 │ │  Aggregates (Account, Transaction, Category, Budget)  │ │
 │ │  Domain Services & Invariants                         │ │
 │ │  Event Store / Outbox Pattern                         │ │
 │ └───────────────────────────┬───────────────────────────┘ │
 │                             │ Emits Domain Events         │
 │                             ▼                             │
 │ ┌───────────────────────────────────────────────────────┐ │
 │ │                    Read Stack (Query)                 │ │
 │ │  Projections & Read Models (Balances, Dashboards)     │ │
 │ │  Materialized Aggregations & Monthly Summaries        │ │
 │ └───────────────────────────────────────────────────────┘ │
 └─────────────────────────────┬─────────────────────────────┘
                               │
                               ▼
               PostgreSQL Database (Transactional & Read Views)
```

### 2.1. Bounded Contexts & DDD Aggregate Roots
* **Contexto de Contas e Usuários (Identity & Account Context)**:
  * `User`: Identificador único, número WhatsApp (E.164), preferências de moeda e fuso horário.
  * `Account`: Conta bancária/carteira (Saldo atual, moeda, tipo: Corrente, Poupança, Cartão, Investimento).
* **Contexto de Transações (Ledger & Transaction Context)**:
  * `Transaction` (Aggregate Root):
    * `TransactionId`: UUIDv7 tipado.
    * `Amount`: Value Object `Money(amount: Decimal, currency: Currency)`.
    * `Type`: `INCOME`, `EXPENSE`, `TRANSFER`.
    * `Status`: `PENDING`, `COMPLETED`, `CANCELLED`.
    * `Category`: Categoria (Alimentação, Transporte, Lazer, etc.) com categorização automática inteligente.
    * `Origin`: `WHATSAPP_MANUAL`, `OPEN_FINANCE_SYNC` (preparado para fase 2).
    * `OccurredAt`: Timestamp com timezone consciente.
* **Contexto de Orçamentos e Metas (Budget & Goal Context)**:
  * `Budget`: Limites mensais por categoria com alertas de consumo (50%, 80%, 100%).
  * `FinancialGoal`: Metas de economia com acompanhamento de progresso.
* **Contexto de Relatórios e Insights (Analytics & Dashboard Context)**:
  * Read models otimizados para rápida renderização de resumos diários, semanais e mensais.

### 2.2. CQRS (Command Query Responsibility Segregation)
* **Write Side (Commands)**:
  * `RegisterTransactionCommand`
  * `CategorizeTransactionCommand`
  * `SetCategoryBudgetCommand`
  * `TransferBetweenAccountsCommand`
  * `ReconcileTransactionCommand` (futura conciliação Open Finance)
* **Read Side (Queries)**:
  * `GetDailySummaryQuery`
  * `GetMonthlyDashboardQuery`
  * `GetCategoryExpensesQuery`
  * `GetCashFlowForecastQuery`

### 2.3. Event-Driven Messaging (Domain Events)
* `TransactionCreatedEvent`
* `TransactionCategorizedEvent`
* `BudgetThresholdExceededEvent`
* `DailySummaryRequestedEvent`
* `OpenFinanceTransactionIngestedEvent` (preparado)

---

## 3. Experiência do Usuário (UX WhatsApp)

### 3.1. Entradas Conversacionais Flexíveis
O worker interpreta comandos estruturados e linguagem natural:
* *"Gastei 45 no almoço hoje"* ➔ Transação de Despesa `R$ 45,00` em `Alimentação`.
* *"Recebi 3500 de freela"* ➔ Transação de Receita `R$ 3.500,00` em `Renda Extra`.
* *"Paguei 120 de luz no cartão nubank"* ➔ Despesa `R$ 120,00` em `Contas/Moradia` na conta `Nubank`.
* *"Quanto gastei esse mês?"* ➔ Dispara query e renderiza dashboard.

### 3.2. Dashboards e Retorno Visual Rico
1. **Resumo Visual em Imagem (Automated Chart Rendering)**:
   * Geração de gráficos de pizza (distribuição por categoria) e barras (fluxo de caixa diário/mensal) gerados dinamicamente via `matplotlib`/`seaborn` ou `Pillow` em alta resolução e enviados como imagem no WhatsApp.
2. **Mensagem Formatada com Emojis & Progress Bars**:
   ```text
   📊 *RESUMO MENSAL — OUTUBRO 2026*
   ───────────────────────────
   🟢 *Receitas:* R$ 8.500,00
   🔴 *Despesas:* R$ 4.230,00
   💰 *Saldo Atual:* R$ 4.270,00 (Economia de 50.2%)

   🏷️ *Top Categorias:*
   1. 🍔 Alimentação: R$ 1.450,00 [████████░░] 34%
   2. 🏠 Moradia:     R$ 1.200,00 [██████░░░░] 28%
   3. 🚗 Transporte:  R$   580,00 [███░░░░░░░] 13%

   ⚠️ *Alertas de Orçamento:*
   - Alimentação atingiu 85% do limite definido!
   ───────────────────────────
   Digite *extrato* para ver as últimas transações ou *grafico* para imagem analítica.
   ```
3. **Botoes de Ação Rápida e Menus Interativos**:
   * Suporte a botões de confirmação rápida (ex: *"Confirmar: R$ 45 em Alimentação? [Sim] [Mudar Categoria]"*).

---

## 4. Stack Tecnológica & Tipagem Estrita (Hard Typed)

* **Linguagem**: Python 3.14 (utilizando novos recursos de performance, deferred annotation evaluation e type parameters).
* **Dataclasses & Models**: `pydantic` v2.x para validação de borda e `dataclasses` com `@dataclass(slots=True, frozen=True)` para domain entities e value objects.
* **ORM & Database**: `SQLAlchemy 2.0+` com `AsyncEngine`, `Mapped[...]`, `mapped_column`, `asyncpg` e PostgreSQL 16+.
* **Migrações**: `Alembic`.
* **Framework Web (API)**: `FastAPI` (Async, tipagem estrita com OpenAPI v3).
* **Fila / Broker**: `RabbitMQ` / `Redis Streams` com worker `Celery` / `FastStream` ou `asyncio` consumers dedicados.
* **Renderização Gráfica**: `matplotlib` / `Pillow` exportando buffers PNG para envio via WhatsApp Media API.
* **Testes**: `pytest`, `pytest-asyncio`, `factory_boy`, `testcontainers`.

---

## 5. Estrutura do Repositório (Monorepo Layout)

```
gio-random-projects/
└── finance-system/
    ├── apps/
    │   ├── finance-api/
    │   │   ├── src/
    │   │   │   ├── domain/             # Aggregates, Entities, Value Objects, Events, Repositories Interfaces
    │   │   │   ├── application/        # Commands, Queries, Handlers, DTOs, Event Listeners
    │   │   │   ├── infrastructure/     # SQLAlchemy Mappings, Repositories Impl, Database Engine, Outbox
    │   │   │   └── presentation/       # FastAPI Routes, Middlewares, Dependency Injection
    │   │   ├── tests/
    │   │   ├── Dockerfile
    │   │   └── pyproject.toml
    │   │
    │   └── finance-whatsapp-worker/
    │       ├── src/
    │       │   ├── nlu/                # Intent parsing, Regex/LLM extractors, Fallbacks
    │       │   ├── rendering/          # WhatsApp message templates, Chart generators (PNG)
    │       │   ├── state/              # Session context, Conversation state machine
    │       │   ├── consumers/          # Event & Task queue consumers
    │       │   └── gateway/            # WhatsApp Provider client (Meta Cloud API / Webhook receiver)
    │       ├── tests/
    │       ├── Dockerfile
    │       └── pyproject.toml
    │
    ├── packages/
    │   ├── finance-core/               # Shared Value Objects, Base Domain Events, Currency types
    │   └── finance-messaging/          # Broker schemas, Protocol Buffers/JSON event contracts
    │
    ├── docker-compose.yml              # Local development stack (Postgres, RabbitMQ, API, Worker)
    └── docs/
        └── finance-system-spec.md      # Este documento de especificação detalhada
```

---

## 6. Preparação para Open Finance (Fase 2)
1. **Modelagem de Origem de Dados Extensível**: O Aggregate `Transaction` possui `source: TransactionSource(type: WHATSAPP | OPEN_FINANCE, external_id: str | None)`.
2. **Idempotência e Deduplicação**: Pipeline com `TransactionFingerprint` (hash de data, valor, descrição e conta) para evitar duplicação entre lançamentos manuais prévios e sincronização bancária.
3. **Engine de Conciliação**: Notificação automática via WhatsApp quando uma transação Open Finance for associada a um gasto já registrado no chat.

---

## 7. Próximos Passos
1. [x] Criação de branch (`feat/finance-whatsapp-system`)
2. [x] Especificação técnica da arquitetura DDD/CQRS e UX WhatsApp
3. [ ] Abertura do Pull Request para revisão do usuário
4. [ ] Implementação do Core Domain, `finance-api` e `finance-whatsapp-worker`
5. [ ] Subida e testes em ambiente containerizado


-- domain's shared Postgres schema. Both domain-api and domain-worker embed an
-- identical copy and apply it on boot, so a from-scratch bring-up converges on
-- one source of truth. Only the entities the current products still use live
-- here: audit_log (the row /sync polls to prove a write landed), the
-- finance_* projections, the outbox and the per-command audit trail. Os
-- agregados de clubs e prospecta saíram com os apps que os consumiam; as
-- tabelas deles continuam no banco de uma instalação que já existia, mas não
-- são mais criadas nem lidas.

-- One row per command domain-worker processed, whether it succeeded or
-- not — "who tried to do what" matters as much as "what changed".
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY,
    command_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    action TEXT NOT NULL,
    payload JSONB,
    success BOOLEAN NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);

-- domain-api's POST /sync polls audit_log by command_id until the
-- worker's row for that command lands (see its sync handler) — every
-- poll is this exact lookup, and the table grows unbounded, so it
-- needs an index of its own rather than a seq scan per tick.
CREATE INDEX IF NOT EXISTS idx_audit_log_command_id ON audit_log (command_id);

-- Tables of the retired products (blog/bookclub/classroom: posts, rooms,
-- messages; scrapers: raw_deals; cch; financas: contas/transacoes/ativos;
-- apostas; dashboards; leads). Dropped on boot so a deployment that predates
-- their removal converges to the schema the current code expects. IF EXISTS
-- makes the drop a no-op on a fresh database; children are listed before the
-- parents they reference so the drop order is valid.
DROP TABLE IF EXISTS
    ativo_movimentos,
    ativos,
    transacoes,
    contas,
    apostas,
    dashboard_layouts,
    leads,
    raw_deals,
    cch_custom_decks,
    cch_rooms,
    messages,
    rooms,
    post_revisions,
    posts,
    users;

-- ===========================================================================
-- Financeiro (docs/finance-system-spec.md)
--
-- Bounded context financeiro, acumulado via domain-api/domain-worker (a
-- finance-api é ACL e NÃO tem banco; o worker conversacional consome eventos e
-- fala com a finance-api). Tabelas prefixadas `finance_` no mesmo database
-- `domain` — mesma decisão do clubs_*: nada de um database próprio, que exigiria
-- bootstrap no persistence.yml (§8.1). Quem escreve é SEMPRE o domain-worker.
--
-- Dinheiro é NUMERIC(14,2): nunca float (§3.4 nº1). O app usa Money em centavos
-- (inteiro) e serializa para NUMERIC exato; a leitura devolve texto para não
-- passar por float no driver.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS finance_transactions (
    id            UUID PRIMARY KEY,
    user_id       TEXT NOT NULL,
    account_id    TEXT NOT NULL DEFAULT '',
    type          TEXT NOT NULL,                 -- INCOME | EXPENSE | TRANSFER
    amount        NUMERIC(14,2) NOT NULL,        -- nunca float (§3.4)
    currency      TEXT NOT NULL DEFAULT 'BRL',
    category      TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'WHATSAPP_MANUAL',
    occurred_at   TIMESTAMPTZ NOT NULL,          -- sempre UTC
    -- Para uma transferência, o par débito/crédito compartilha command_id e o
    -- sinal do amount distingue os lados (débito negativo, crédito positivo).
    command_id    UUID,
    transfer_id   UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O painel lê por usuário e ordena por data descendente; o extrato por
-- categoria e mês. Os dois índices que a spec §8.2 exige.
CREATE INDEX IF NOT EXISTS idx_finance_transactions_user_time
    ON finance_transactions (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_user_category_month
    ON finance_transactions (user_id, category, occurred_at DESC);
-- Idempotência por comando: reinserir o mesmo command_id é no-op. Índice único
-- parcial: só vale quando há command_id (o id da transação já é único).
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_transactions_command
    ON finance_transactions (command_id) WHERE command_id IS NOT NULL;

-- Open Finance: a transação importada do banco carrega o id dela no provedor.
-- O índice único parcial por (source, external_id) é o que faz reprocessar o
-- extrato inteiro não duplicar — a mesma disciplina do command_id. Expand:
-- colunas adicionadas via ALTER para não quebrar o CREATE de bases existentes.
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS of_account_id UUID;
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS counterparty TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS external_category TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_transactions ADD COLUMN IF NOT EXISTS inactive BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_transactions_external
    ON finance_transactions (source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_budgets (
    id          UUID PRIMARY KEY,
    user_id     TEXT NOT NULL,
    category    TEXT NOT NULL,
    limit_amount NUMERIC(14,2) NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'BRL',
    period      TEXT NOT NULL,                  -- YYYY-MM
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_budgets_user_category_period
    ON finance_budgets (user_id, category, period);

-- Régua de orçamento disparada: UMA linha por (budget_id, threshold, period).
-- O índice único é o que faz "dispara uma vez por limiar" ser garantido pelo
-- banco (§3.4 nº5), não por sorte de timing.
CREATE TABLE IF NOT EXISTS finance_budget_thresholds (
    budget_id  UUID NOT NULL,
    threshold  INTEGER NOT NULL,                -- 50 | 80 | 100
    period     TEXT NOT NULL,
    spent_amount NUMERIC(14,2) NOT NULL,
    limit_amount NUMERIC(14,2) NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'BRL',
    fired_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_budget_thresholds
    ON finance_budget_thresholds (budget_id, threshold, period);

-- ---------------------------------------------------------------------------
-- Open Finance (docs/openfinance-spec.md)
--
-- O consentimento (a "conexão" com o banco) e as contas importadas via Polp.
-- A ACL cria o consentimento no provedor, mas quem persiste é o domain-worker
-- (o único escritor); o conector de sync também publica comandos. Dinheiro é
-- NUMERIC(14,2), como o resto.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_of_consents (
    id                  UUID PRIMARY KEY,
    polp_consent_id     TEXT NOT NULL UNIQUE,   -- id no provedor (Polp/Celcoin)
    user_id             TEXT NOT NULL,          -- telefone, o mesmo do ledger
    institution_id      TEXT NOT NULL,          -- id Polp da instituição
    institution_name    TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL,          -- AWAITING_AUTHORIZATION|AUTHORISED|REJECTED|EXPIRED
    execution_status    TEXT NOT NULL DEFAULT '', -- AWAITING_RESOURCES|SUCCESS|PARTIAL_SUCCESS
    products            TEXT[] NOT NULL DEFAULT '{}',
    url_to_authenticate TEXT NOT NULL DEFAULT '',
    url_expires_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_of_consents_user ON finance_of_consents (user_id);
-- No máximo UMA conexão ativa (AUTHORISED) por (usuário, banco): reconectar o
-- mesmo banco não empilha consentimentos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_of_consents_active
    ON finance_of_consents (user_id, institution_id) WHERE status = 'AUTHORISED';

CREATE TABLE IF NOT EXISTS finance_of_accounts (
    id                UUID PRIMARY KEY,
    polp_account_id   TEXT NOT NULL UNIQUE,     -- id da conta no provedor
    polp_consent_id   TEXT NOT NULL,            -- consentimento do provedor
    user_id           TEXT NOT NULL,
    name              TEXT NOT NULL DEFAULT '',
    type              TEXT NOT NULL DEFAULT '',
    currency          TEXT NOT NULL DEFAULT 'BRL',
    balance_amount    NUMERIC(14,2),
    balance_updated_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_of_accounts_user ON finance_of_accounts (user_id);

-- Notificações: regras que a pessoa cadastra (ex.: "avise quando Alimentação
-- passar de R$ 300", "avise ao receber"). O worker conversacional decide o
-- disparo; aqui mora a regra.
CREATE TABLE IF NOT EXISTS finance_notifications (
    id          UUID PRIMARY KEY,
    user_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,              -- category_threshold | any_transaction | large_transaction
    category    TEXT NOT NULL DEFAULT '',
    threshold   NUMERIC(14,2),
    channel     TEXT NOT NULL DEFAULT 'WHATSAPP',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_notifications_user ON finance_notifications (user_id);

-- ===========================================================================
-- Fim do Open Finance
-- ===========================================================================

-- ===========================================================================
-- Outbox (docs/finance-system-spec.md §4.3/§12.5)
--
-- Um evento de domínio é gravado AQUI como pendente antes da tentativa de
-- publish. Se o broker estiver fora do ar na hora, a linha continua pendente e
-- o relay a publica quando ele voltar — sem perder uma escrita já aplicada. A
-- entrega é at-least-once; o consumidor é idempotente por event_id (o `id`).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS outbox (
    id           UUID PRIMARY KEY,
    event_name   TEXT NOT NULL,
    payload      JSONB NOT NULL,          -- o envelope {event_name, occurred_at, payload}
    occurred_at  TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,             -- NULL = ainda pendente
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O relay lê só o que está pendente, mais antigo primeiro.
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox (created_at ASC) WHERE published_at IS NULL;

-- ===========================================================================
-- Fim do Outbox
-- ===========================================================================

CREATE TABLE IF NOT EXISTS finance_investments (
    id              UUID PRIMARY KEY,
    user_id         TEXT NOT NULL,
    polp_consent_id TEXT NOT NULL DEFAULT '',
    polp_invest_id  TEXT NOT NULL,
    institution_name TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT 'OUTRO',
    name            TEXT NOT NULL DEFAULT '',
    currency        TEXT NOT NULL DEFAULT 'BRL',
    invested_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    gross_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
    yield_percent   TEXT NOT NULL DEFAULT '0',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_investments_user
    ON finance_investments (user_id, gross_amount DESC);
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS income_tax NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS iof NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS quantity TEXT NOT NULL DEFAULT '0';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS purchase_unit_price NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS indexer TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS indexer_rate TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS yield_label TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS due_date TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS isin_code TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS ticker TEXT NOT NULL DEFAULT '';
ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS family TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_investments_external
    ON finance_investments (polp_invest_id);

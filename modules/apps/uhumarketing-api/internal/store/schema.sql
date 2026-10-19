-- Schema do uhumarketing-api. O serviço é dono destas tabelas (diferente do
-- domain-api, que só lê o que o worker escreve), então o DDL vive junto do
-- código que o usa e é aplicado no boot — idempotente, como no resto do repo.
--
-- Decisões que importam:
--   · consentimento é LINHA (contact_consents), não um booleano: data, origem e
--     texto aceito são o que a Meta e a LGPD pedem numa auditoria;
--   · sends tem UNIQUE (campaign_id, contact_id) — o banco garante que ninguém
--     recebe a mesma campanha duas vezes, não o código;
--   · status de template nunca é escrito pelo cliente: só pela submissão e
--     pelo webhook;
--   · métricas (de template e de campanha) são DERIVADAS de sends numa query,
--     não contadores que só sobem: um envio que falha depois de "entregue"
--     precisa sair da coluna certa;
--   · ids internos são texto com prefixo (tpl_, cmp_, snd_) para a URL ficar
--     legível e o front não precisar saber que é UUID.

CREATE TABLE IF NOT EXISTS workspaces (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    segment         TEXT NOT NULL DEFAULT '',
    site            TEXT NOT NULL DEFAULT '',
    timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    plan            TEXT NOT NULL DEFAULT 'starter',
    whatsapp_number TEXT NOT NULL DEFAULT '',
    email_sender    TEXT NOT NULL DEFAULT '',
    -- Vazio = número ainda não conectado. "green" numa conta sem número seria
    -- uma qualidade que a Meta nunca atribuiu.
    quality         TEXT NOT NULL DEFAULT '',
    messaging_limit TEXT NOT NULL DEFAULT '',
    opt_in_policy   TEXT NOT NULL DEFAULT '',
    quiet_start     INT  NOT NULL DEFAULT 21,
    quiet_end       INT  NOT NULL DEFAULT 8,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS templates (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    channel          TEXT NOT NULL DEFAULT 'whatsapp',
    category         TEXT NOT NULL,
    language         TEXT NOT NULL DEFAULT 'pt_BR',
    status           TEXT NOT NULL DEFAULT 'draft',
    header_kind      TEXT NOT NULL DEFAULT 'none',
    header_text      TEXT NOT NULL DEFAULT '',
    header_media     TEXT NOT NULL DEFAULT '',
    body             TEXT NOT NULL,
    footer           TEXT NOT NULL DEFAULT '',
    buttons          JSONB NOT NULL DEFAULT '[]'::jsonb,
    variables        JSONB NOT NULL DEFAULT '[]'::jsonb,
    external_id      TEXT NOT NULL DEFAULT '',
    quality          INT  NOT NULL DEFAULT 0,
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS templates_workspace ON templates (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS templates_external ON templates (external_id) WHERE external_id <> '';

CREATE TABLE IF NOT EXISTS contacts (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    phone            TEXT NOT NULL,
    email            TEXT NOT NULL DEFAULT '',
    city             TEXT NOT NULL DEFAULT '',
    uf               TEXT NOT NULL DEFAULT '',
    tags             JSONB NOT NULL DEFAULT '[]'::jsonb,
    source           TEXT NOT NULL DEFAULT 'manual',
    plan             TEXT NOT NULL DEFAULT '',
    -- Derivado de contact_consents (granted_at IS NOT NULL AND revoked_at IS NULL).
    -- Guardado aqui para a consulta de audiência não fazer join em toda leitura.
    opt_in           BOOLEAN NOT NULL DEFAULT false,
    opt_in_source    TEXT NOT NULL DEFAULT '',
    opt_in_at        TIMESTAMPTZ,
    opt_out_at       TIMESTAMPTZ,
    last_purchase_at TIMESTAMPTZ,
    total_spent      NUMERIC(12,2) NOT NULL DEFAULT 0,
    orders           INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, phone)
);

CREATE INDEX IF NOT EXISTS contacts_workspace ON contacts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contacts_city ON contacts (workspace_id, city);

-- Histórico append-only: revogar não apaga a prova de que houve consentimento.
CREATE TABLE IF NOT EXISTS contact_consents (
    id          BIGSERIAL PRIMARY KEY,
    contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    source      TEXT NOT NULL,
    -- Texto exato que a pessoa aceitou. É o que se mostra numa auditoria.
    policy_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS contact_consents_contact ON contact_consents (contact_id);

CREATE TABLE IF NOT EXISTS segments (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL DEFAULT 'dynamic',
    combinator   TEXT NOT NULL DEFAULT 'and',
    -- Regras de descobrimento do editor (campo/operador/valor). Avaliadas em Go
    -- por domain.MatchContact enquanto a base é pequena.
    rules        JSONB NOT NULL DEFAULT '[]'::jsonb,
    source       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    objective         TEXT NOT NULL DEFAULT 'conversao',
    status            TEXT NOT NULL DEFAULT 'draft',
    channel           TEXT NOT NULL DEFAULT 'whatsapp',
    template_id       TEXT NOT NULL REFERENCES templates(id),
    segment_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
    flow_id           TEXT NOT NULL DEFAULT '',
    schedule          JSONB NOT NULL DEFAULT '{}'::jsonb,
    offer             JSONB NOT NULL DEFAULT '{}'::jsonb,
    requires_approval BOOLEAN NOT NULL DEFAULT true,
    audience_count    INT NOT NULL DEFAULT 0,
    skipped_count     INT NOT NULL DEFAULT 0,
    notes             TEXT NOT NULL DEFAULT '',
    last_run_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flows (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'draft',
    nodes        JSONB NOT NULL DEFAULT '[]'::jsonb,
    edges        JSONB NOT NULL DEFAULT '[]'::jsonb,
    campaign_id  TEXT NOT NULL DEFAULT '',
    runs_total   INT NOT NULL DEFAULT 0,
    runs_success INT NOT NULL DEFAULT 0,
    runs_failed  INT NOT NULL DEFAULT 0,
    last_run_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sends (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id    TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    destination   TEXT NOT NULL,
    template_name TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued',
    coupon_code   TEXT NOT NULL DEFAULT '',
    external_id   TEXT NOT NULL DEFAULT '',
    error         TEXT NOT NULL DEFAULT '',
    cost          NUMERIC(10,4) NOT NULL DEFAULT 0,
    -- Envio de teste: sai na hora, sem esperar a janela da campanha. É a única
    -- mensagem que o operador pede explicitamente "agora" — deixá-la na fila
    -- até a próxima janela comercial transformaria o teste em espera.
    is_test       BOOLEAN NOT NULL DEFAULT false,
    attempts      INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, contact_id)
);

-- Instalação existente: a coluna nasceu depois da tabela.
ALTER TABLE sends ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sends_queue ON sends (status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS sends_campaign ON sends (campaign_id, status);
CREATE INDEX IF NOT EXISTS sends_external ON sends (external_id) WHERE external_id <> '';

CREATE TABLE IF NOT EXISTS activity (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    title        TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '',
    ref_id       TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_workspace ON activity (workspace_id, created_at DESC);

-- Idempotência de webhook: a Meta reentrega o mesmo evento quando não recebe
-- 200 rápido. Guardar a chave evita contar duas vezes a mesma entrega.
CREATE TABLE IF NOT EXISTS webhook_events (
    key         TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- contas
--
-- Um usuário pertence a UM workspace (a POC é uma conta por negócio). O
-- workspace é criado junto com o cadastro e nasce vazio: nenhuma conta herda
-- template, contato ou campanha de demonstração.
--
-- Sessão é linha, não JWT: guardar só o SHA-256 do token permite revogar no
-- logout sem lista de bloqueio e faz um dump do banco não virar um punhado de
-- sessões prontas para usar.

CREATE TABLE IF NOT EXISTS workspaces_meta (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    company       TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- E-mail é único sem diferenciar maiúsculas: "Marina@x.com" e "marina@x.com"
-- são a mesma pessoa tentando entrar duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_workspace ON users (workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

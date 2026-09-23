CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kept identical to domain-worker's copy of this table -- domain-api
-- only ever reads it, domain-worker is the only writer. author_id is
-- an opaque identifier from whatever identity system the calling
-- client uses (post-api's Better Auth user id today), not a
-- foreign key to the `users` table above.
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    body_markdown TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    cover_image_url TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'article',
    status TEXT NOT NULL DEFAULT 'draft',
    source TEXT NOT NULL DEFAULT 'native',
    source_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_posts_status_published_at ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts (author_id);

-- Kept identical to domain-worker's copy -- see its comment. NULL
-- means "not deleted". domain-api's own post_repository.go filters
-- every read on `AND deleted_at IS NULL`.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Kept identical to domain-worker's copy -- domain-api never writes
-- to this table (domain-worker is the only INSERTer), but embeds the
-- same schema.sql so both converge on one shared migration source.
CREATE TABLE IF NOT EXISTS post_revisions (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    cover_image_url TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_revisions_post_id ON post_revisions (post_id, archived_at DESC);

-- Kept identical to domain-worker's copy -- host_id/document_id are
-- opaque identifiers, same reasoning as posts.author_id.
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY,
    host_id TEXT NOT NULL,
    title TEXT NOT NULL,
    document_id TEXT NOT NULL,
    current_page INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS above is a no-op against an
-- already-existing table -- see domain-worker's identical comment.
-- 'closed' is what "Encerrar sala" sets now instead of physically
-- deleting the row.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

-- Kept identical to domain-worker's copy -- partitions the shared
-- table between bookclub-api ("book") and classroom-api ("class").
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'book';

CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON rooms (host_id);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    body TEXT NOT NULL,
    requested_page INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_id_created_at ON messages (room_id, created_at);

-- Mirror of domain-worker's raw_deals DDL (byte-identical, index name
-- included) — domain-api only READS this table (deal_repository.go,
-- behind /deals), but its Migrate runs on boot like everything else
-- here, and a from-scratch bring-up of just this API must not 500 its
-- first /deals read because the worker never booted. domain-worker
-- owns the table's writes.
CREATE TABLE IF NOT EXISTS raw_deals (
    source           text        NOT NULL,
    source_deal_id   text        NOT NULL,
    title            text        NOT NULL,
    url              text        NOT NULL,
    store            text,
    price_cents      integer,
    old_price_cents  integer,
    posted_at        timestamptz,
    scraped_at       timestamptz NOT NULL,
    payload          jsonb       NOT NULL,
    PRIMARY KEY (source, source_deal_id)
);

CREATE INDEX IF NOT EXISTS raw_deals_posted_at_idx ON raw_deals (posted_at DESC NULLS LAST);

-- Gestão financeira modular (specs/002) -- domain-api only reads these
-- four aggregates; domain-worker (separate module) is the sole writer,
-- carrying a byte-identical copy of this DDL.
CREATE TABLE IF NOT EXISTS contas (
    id UUID PRIMARY KEY,
    usuario_email TEXT NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('corrente','investimento')),
    status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','arquivada')),
    criado_em TIMESTAMPTZ NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contas_usuario_email ON contas(usuario_email);

CREATE TABLE IF NOT EXISTS transacoes (
    id UUID PRIMARY KEY,
    usuario_email TEXT NOT NULL,
    conta_id UUID NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
    valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
    data DATE NOT NULL,
    categoria TEXT NOT NULL,
    descricao TEXT,
    anexo_imagem TEXT,
    criado_em TIMESTAMPTZ NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transacoes_usuario_conta ON transacoes(usuario_email, conta_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes(data);

CREATE TABLE IF NOT EXISTS ativos (
    id UUID PRIMARY KEY,
    usuario_email TEXT NOT NULL,
    conta_id UUID NOT NULL,
    ticker TEXT NOT NULL,
    quantidade_atual NUMERIC(18,6) NOT NULL DEFAULT 0,
    custo_medio NUMERIC(14,4) NOT NULL DEFAULT 0,
    ultima_cotacao NUMERIC(14,4),
    ultima_cotacao_em TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','encerrada')),
    criado_em TIMESTAMPTZ NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ativos_usuario_conta ON ativos(usuario_email, conta_id);

CREATE TABLE IF NOT EXISTS ativo_movimentos (
    id UUID PRIMARY KEY,
    ativo_id UUID NOT NULL REFERENCES ativos(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('compra','venda','provento')),
    quantidade NUMERIC(18,6),
    preco_unitario NUMERIC(14,4),
    valor_provento NUMERIC(14,2),
    data DATE NOT NULL,
    resultado_realizado NUMERIC(14,2),
    criado_em TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ativo_movimentos_ativo ON ativo_movimentos(ativo_id);

CREATE TABLE IF NOT EXISTS dashboard_layouts (
    usuario_email TEXT PRIMARY KEY,
    blocos JSONB NOT NULL DEFAULT '[]',
    atualizado_em TIMESTAMPTZ NOT NULL
);

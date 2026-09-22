CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- author_id is an opaque identifier from whatever identity system the
-- calling client uses (post-api's Better Auth user id today) — not
-- a foreign key to the `users` table above, a different aggregate
-- entirely with no relation to this one.
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

-- Soft-delete only -- a "deleted" post is never physically removed,
-- just excluded from every read path (see post_repository.go's
-- `AND deleted_at IS NULL`). NULL means "not deleted", same
-- convention as posts.published_at meaning "not published".
ALTER TABLE posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- One row per pre-edit snapshot, written just before an UPDATE
-- overwrites the live posts row (post_repository.go's Update, inside
-- the same transaction as the UPDATE) -- so a post's content is never
-- destructively overwritten without the previous value surviving
-- here first. Append-only: nothing in this codebase ever UPDATEs or
-- DELETEs a post_revisions row.
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

-- host_id and document_id are opaque identifiers, same reasoning as
-- posts.author_id -- document_id points at a PDF blob bookclub-api
-- owns (this aggregate has no idea what a PDF is).
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
-- already-existing table -- rooms existed (without this column)
-- before Room grew a pause/resume status, so this ALTER is what
-- actually applies it to a deployment upgrading from that point.
--
-- 'closed' (domainroom.StatusClosed) is what "Encerrar sala" sets now
-- instead of physically deleting the row -- a closed room is never
-- removed from `rooms` or its `messages`, only excluded from being
-- joinable/playable, same soft-delete convention as posts.deleted_at.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

-- Partitions this one shared table between callers -- bookclub-api
-- ("book") and classroom-api ("class") both create/list rooms through
-- the exact same generic aggregate, and without this column every
-- room ever created (all bookclub-api's, before classroom-api
-- existed) would show up in classroom-api's "Aulas" list too, and
-- vice versa going forward. Default 'book' is exactly correct for
-- every pre-existing row.
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

-- Stage table for scraped offers — the Deal aggregate's storage. The
-- python scrapers created and owned this table first (same DDL, via
-- deals_common.db); domain-worker now owns it: they hand rows over
-- through domain-api's deal.upsert instead of touching Postgres
-- directly anymore. This CREATE TABLE IF NOT EXISTS is a no-op against
-- the table they already made and keeps a from-scratch bring-up
-- working without them.
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

-- Name kept identical to the index the python scrapers created (it
-- already exists in production; IF NOT EXISTS only works because it
-- matches).
CREATE INDEX IF NOT EXISTS raw_deals_posted_at_idx ON raw_deals (posted_at DESC NULLS LAST);

-- cch.giomartins.dev's persistent half, reached through domain-api
-- instead of the two JSON files on its container volume where it used
-- to live (cch-api/internal/rooms/store.go + internal/customdecks).
-- Storage-shaped on purpose: the caller owns the real invariants
-- (scrypt hashing, card bounds, field caps) and validated everything
-- before sending — these tables only have to hold complete records.
-- cch_rooms is the room registry: code, creation timestamp, the scrypt
-- salt+hash pair that IS the room password, and the HMAC key that
-- keeps resume tokens verifiable across a restart.
CREATE TABLE IF NOT EXISTS cch_rooms (
    id         text        PRIMARY KEY,
    created_at timestamptz NOT NULL,
    salt       bytea       NOT NULL,
    hash       bytea       NOT NULL,
    resume_key bytea       NOT NULL
);

-- cch_custom_decks is the Forja's marketplace: decks forged with AI or
-- by hand, published, then playable in any room like a built-in deck.
-- ids carry the caller's "cx" prefix; plays is cosmetic bookkeeping.
CREATE TABLE IF NOT EXISTS cch_custom_decks (
    id          text        PRIMARY KEY,
    name        text        NOT NULL,
    emoji       text        NOT NULL DEFAULT '',
    description text        NOT NULL DEFAULT '',
    parent_id   text        NOT NULL DEFAULT '',
    author      text        NOT NULL DEFAULT '',
    whites      text[]      NOT NULL,
    blacks      text[]      NOT NULL,
    created_at  timestamptz NOT NULL,
    plays       integer     NOT NULL DEFAULT 0
);

-- specs/002-gestao-financeira-modular: 4 new write aggregates for the
-- financial-management feature. usuario_email is opaque here beyond
-- "not empty" (see domain/conta etc) -- it's the e-mail carried in the
-- Cloudflare Access JWT, used only to partition data between people,
-- same role host_id plays for rooms above.
CREATE TABLE IF NOT EXISTS contas (
    id UUID PRIMARY KEY,
    usuario_email TEXT NOT NULL,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('corrente','investimento','aposta')),
    status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','arquivada')),
    criado_em TIMESTAMPTZ NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL
);

-- "aposta" (betting-house wallet) is a tipo added after this table
-- already existed in production -- CREATE TABLE IF NOT EXISTS above is
-- a no-op against it, so the CHECK constraint needs widening
-- explicitly, same treatment as rooms'/posts' ALTER TABLE below.
-- contas_tipo_check is Postgres's default auto-generated name for an
-- inline column CHECK (<table>_<column>_check).
ALTER TABLE contas DROP CONSTRAINT IF EXISTS contas_tipo_check;
ALTER TABLE contas ADD CONSTRAINT contas_tipo_check CHECK (tipo IN ('corrente','investimento','aposta'));

CREATE INDEX IF NOT EXISTS idx_contas_usuario_email ON contas(usuario_email);

-- conta_id is an opaque foreign key from this table's perspective (no
-- FK constraint) -- the application layer, not Postgres, checks that
-- the conta exists and belongs to the same usuario_email before
-- inserting a transacao against it.
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

-- One ativos row per position (a ticker held inside one investimento
-- conta); ativo_movimentos is its append-only ledger of
-- compra/venda/provento entries -- quantidade_atual/custo_medio on the
-- parent row are a cache of "replay every movimento", updated in the
-- same transaction as each insert (see ativo_repository.go) rather
-- than recomputed on every read.
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

-- One row per aposta -- a single event with its own lifecycle
-- (pendente -> green/red/cancelada), not an accumulating position like
-- Ativo. conta_id points at a conta with tipo 'aposta' (a betting-house
-- wallet), opaque FK like every other conta_id in this schema.
CREATE TABLE IF NOT EXISTS apostas (
    id UUID PRIMARY KEY,
    usuario_email TEXT NOT NULL,
    conta_id UUID NOT NULL,
    descricao TEXT NOT NULL,
    valor_apostado NUMERIC(14,2) NOT NULL CHECK (valor_apostado > 0),
    odd NUMERIC(10,3),
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','green','red','cancelada')),
    retorno_obtido NUMERIC(14,2),
    data_aposta DATE NOT NULL,
    data_resultado DATE,
    criado_em TIMESTAMPTZ NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apostas_usuario_conta ON apostas(usuario_email, conta_id);

-- One row per usuario -- dashboard-api's frontend saves its whole
-- "blocos" array wholesale on every layout edit, so a plain upsertable
-- singleton keyed by usuario_email is all this needs, same
-- storage-shaped treatment as cch_custom_decks.
CREATE TABLE IF NOT EXISTS dashboard_layouts (
    usuario_email TEXT PRIMARY KEY,
    blocos JSONB NOT NULL DEFAULT '[]',
    atualizado_em TIMESTAMPTZ NOT NULL
);

-- E-mails capturados na landing page pública do financas-frontend,
-- antes de qualquer autenticação -- unique em email (não usuario_email)
-- porque quem envia ainda não é uma pessoa usuária, e um duplo submit
-- (retry de rede, duplo clique) não deve virar dois leads.
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    criado_em TIMESTAMPTZ NOT NULL
);

-- ===========================================================================
-- FC Clubs Hub (specs/003-fc-clubs-hub)
--
-- Dados públicos de Pro Clubs (EA FC 27), acumulados pelo clubs-ingest.
-- A origem só entrega estado atual + ~10 partidas por tipo: tudo que é
-- "ao longo do tempo" (nível, divisão, recordes, evolução de jogador)
-- nasce dos snapshots abaixo. club_id é sempre TEXT porque a origem manda
-- o id como string e alterna parâmetros singulares/plurais.
-- ===========================================================================

-- Um clube. acompanhado=false é o estado de qualquer clube descoberto por
-- busca: só temos os totais gerais dele (clubs_totais). Vira true quando
-- o ciclo de ingestão traz elenco e partidas.
CREATE TABLE IF NOT EXISTS clubs (
    club_id         TEXT PRIMARY KEY,
    nome            TEXT NOT NULL,
    sigla           TEXT NOT NULL DEFAULT '',
    estadio         TEXT NOT NULL DEFAULT '',
    regiao_id       TEXT NOT NULL DEFAULT '',
    time_id         TEXT NOT NULL DEFAULT '',
    escudo_asset_id TEXT NOT NULL DEFAULT '',
    cor_1           INTEGER NOT NULL DEFAULT 0,
    cor_2           INTEGER NOT NULL DEFAULT 0,
    cor_3           INTEGER NOT NULL DEFAULT 0,
    cor_4           INTEGER NOT NULL DEFAULT 0,
    acompanhado     BOOLEAN NOT NULL DEFAULT false,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clubs_acompanhado ON clubs(acompanhado);

-- Totais gerais que a origem devolve mesmo para clube não acompanhado.
-- Separado de clubs porque existe justamente para quem nunca terá elenco.
CREATE TABLE IF NOT EXISTS clubs_totais (
    club_id          TEXT PRIMARY KEY,
    jogos            INTEGER NOT NULL DEFAULT 0,
    vitorias         INTEGER NOT NULL DEFAULT 0,
    empates          INTEGER NOT NULL DEFAULT 0,
    derrotas         INTEGER NOT NULL DEFAULT 0,
    gols             INTEGER NOT NULL DEFAULT 0,
    gols_sofridos    INTEGER NOT NULL DEFAULT 0,
    jogos_sem_sofrer INTEGER NOT NULL DEFAULT 0,
    pontos           INTEGER NOT NULL DEFAULT 0,
    divisao_atual    INTEGER NOT NULL DEFAULT 0,
    melhor_divisao   INTEGER NOT NULL DEFAULT 0,
    nivel            INTEGER NOT NULL DEFAULT 0,
    promocoes        INTEGER NOT NULL DEFAULT 0,
    rebaixamentos    INTEGER NOT NULL DEFAULT 0,
    lido_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma partida, vista UMA ÚNICA VEZ mesmo quando os dois clubes jogaram
-- entre si. match_id unique é o que garante isso: a segunda vez é update.
-- resultado_* já vem normalizado do ingest (a origem usa 5 códigos
-- numéricos para 3 resultados e amistoso não traz marcação nenhuma).
CREATE TABLE IF NOT EXISTS clubs_matches (
    id                            UUID PRIMARY KEY,
    match_id                      TEXT NOT NULL UNIQUE,
    timestamp                     TIMESTAMPTZ NOT NULL,
    tipo                          TEXT NOT NULL CHECK (tipo IN ('liga','amistoso','playoff')),
    rodada_playoff                TEXT NOT NULL DEFAULT '',
    clube_casa_id                 TEXT NOT NULL,
    clube_fora_id                 TEXT NOT NULL,
    gols_casa                     INTEGER NOT NULL DEFAULT 0,
    gols_fora                     INTEGER NOT NULL DEFAULT 0,
    houve_desistencia             BOOLEAN NOT NULL DEFAULT false,
    vencedor_por_desistencia_id   TEXT NOT NULL DEFAULT '',
    resultado_casa                TEXT NOT NULL CHECK (resultado_casa IN ('vitoria','empate','derrota')),
    lances                        JSONB NOT NULL DEFAULT '[]',
    criado_em                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clubs_matches_casa ON clubs_matches(clube_casa_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clubs_matches_fora ON clubs_matches(clube_fora_id, timestamp DESC);

-- Atuação de um jogador numa partida. Uma linha por jogador por partida,
-- dos DOIS times -- é daqui que sai o índice cross-club que a origem não
-- oferece. defesas_por_tipo só existe para goleiro (jsonb evita 6 colunas
-- vazias para todo mundo).
CREATE TABLE IF NOT EXISTS clubs_match_players (
    id                  UUID PRIMARY KEY,
    partida_id          UUID NOT NULL REFERENCES clubs_matches(id) ON DELETE CASCADE,
    club_id             TEXT NOT NULL,
    player_id           TEXT NOT NULL,
    gamertag            TEXT NOT NULL,
    posicao             TEXT NOT NULL CHECK (posicao IN ('goleiro','defensor','meio','atacante')),
    nota                NUMERIC(4,2) NOT NULL DEFAULT 0,
    gols                INTEGER NOT NULL DEFAULT 0,
    assistencias        INTEGER NOT NULL DEFAULT 0,
    chutes              INTEGER NOT NULL DEFAULT 0,
    passes_certos       INTEGER NOT NULL DEFAULT 0,
    passes_tentados     INTEGER NOT NULL DEFAULT 0,
    desarmes_certos     INTEGER NOT NULL DEFAULT 0,
    desarmes_tentados   INTEGER NOT NULL DEFAULT 0,
    defesas             INTEGER NOT NULL DEFAULT 0,
    defesas_por_tipo    JSONB,
    segundos_jogados    INTEGER NOT NULL DEFAULT 0,
    melhor_em_campo     BOOLEAN NOT NULL DEFAULT false,
    cartao_vermelho     BOOLEAN NOT NULL DEFAULT false,
    jogo_sem_sofrer_gol BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (partida_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_clubs_match_players_partida ON clubs_match_players(partida_id, club_id);
CREATE INDEX IF NOT EXISTS idx_clubs_match_players_player ON clubs_match_players(player_id);

-- Leitura de nível/divisão num instante. APPEND-ONLY: é o único dado que
-- torna a evolução possível, já que a origem não guarda histórico.
CREATE TABLE IF NOT EXISTS clubs_snapshots (
    id             UUID PRIMARY KEY,
    club_id        TEXT NOT NULL,
    lido_em        TIMESTAMPTZ NOT NULL,
    nivel          INTEGER NOT NULL DEFAULT 0,
    divisao        INTEGER NOT NULL DEFAULT 0,
    jogos          INTEGER NOT NULL DEFAULT 0,
    vitorias       INTEGER NOT NULL DEFAULT 0,
    empates        INTEGER NOT NULL DEFAULT 0,
    derrotas       INTEGER NOT NULL DEFAULT 0,
    gols           INTEGER NOT NULL DEFAULT 0,
    gols_sofridos  INTEGER NOT NULL DEFAULT 0,
    tamanho_elenco INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_clubs_snapshots_club ON clubs_snapshots(club_id, lido_em DESC);

-- Evento datado de subida/queda, derivado do diff entre dois snapshots.
-- para < de = promoção.
CREATE TABLE IF NOT EXISTS clubs_division_changes (
    id           UUID PRIMARY KEY,
    club_id      TEXT NOT NULL,
    detectado_em TIMESTAMPTZ NOT NULL,
    de           INTEGER NOT NULL,
    para         INTEGER NOT NULL,
    tipo         TEXT NOT NULL CHECK (tipo IN ('promocao','rebaixamento'))
);

CREATE INDEX IF NOT EXISTS idx_clubs_division_changes_club ON clubs_division_changes(club_id, detectado_em DESC);

-- Feed da home: derivado pelo próprio ingest dos fatos que acabou de
-- gravar (resultado novo, recorde batido, mudança de divisão). Não é
-- curado à mão e não tem endpoint de escrita pública.
CREATE TABLE IF NOT EXISTS clubs_announcements (
    id            UUID PRIMARY KEY,
    tipo          TEXT NOT NULL CHECK (tipo IN ('resultado','ranking','jogador','novidade')),
    titulo        TEXT NOT NULL,
    texto         TEXT NOT NULL DEFAULT '',
    referencia_id TEXT NOT NULL DEFAULT '',
    icone         TEXT NOT NULL DEFAULT '',
    gerado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clubs_announcements_gerado ON clubs_announcements(gerado_em DESC);

-- Preferências por pessoa: watchlist, pro reivindicado e avisos. É a
-- ÚNICA parte particionada por usuario_email -- o resto do schema de
-- clubs é dado público. Toda leitura filtra por esse campo.
CREATE TABLE IF NOT EXISTS clubs_preferences (
    usuario_email      TEXT PRIMARY KEY,
    canal              TEXT NOT NULL DEFAULT '',
    resumo_periodico   BOOLEAN NOT NULL DEFAULT true,
    recordes_e_divisoes BOOLEAN NOT NULL DEFAULT true,
    resultado_partidas BOOLEAN NOT NULL DEFAULT true,
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs_watchlist (
    usuario_email   TEXT NOT NULL,
    club_id         TEXT NOT NULL,
    seguindo_desde  TIMESTAMPTZ NOT NULL DEFAULT now(),
    origem          TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('proprio','rival','rival_de_rival','manual')),
    PRIMARY KEY (usuario_email, club_id)
);

CREATE INDEX IF NOT EXISTS idx_clubs_watchlist_usuario ON clubs_watchlist(usuario_email);

CREATE TABLE IF NOT EXISTS clubs_claimed_pros (
    usuario_email  TEXT PRIMARY KEY,
    club_id        TEXT NOT NULL,
    player_id      TEXT NOT NULL,
    verificado     BOOLEAN NOT NULL DEFAULT false,
    reivindicado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clubs_claimed_pros_player ON clubs_claimed_pros(player_id);

-- Estado da última sincronização de uma pessoa, para a SPA desenhar o
-- progresso por nível sem bloquear a navegação.
CREATE TABLE IF NOT EXISTS clubs_sync_runs (
    usuario_email TEXT PRIMARY KEY,
    rodando       BOOLEAN NOT NULL DEFAULT false,
    nivel         INTEGER NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL DEFAULT 0,
    concluidos    INTEGER NOT NULL DEFAULT 0,
    atual         TEXT NOT NULL DEFAULT '',
    novos         JSONB NOT NULL DEFAULT '[]',
    iniciado_em   TIMESTAMPTZ,
    concluido_em  TIMESTAMPTZ
);


-- domain's shared Postgres schema. Both domain-api and domain-worker embed an
-- identical copy and apply it on boot, so a from-scratch bring-up converges on
-- one source of truth. Only the entities the current products still use live
-- here: audit_log (the row /sync polls to prove a write landed) and the
-- clubs_* tables. The retired products' tables are dropped by the block below,
-- so an existing deployment converges too.

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
    name            TEXT NOT NULL,
    tag           TEXT NOT NULL DEFAULT '',
    stadium         TEXT NOT NULL DEFAULT '',
    region_id       TEXT NOT NULL DEFAULT '',
    team_id         TEXT NOT NULL DEFAULT '',
    crest_asset_id TEXT NOT NULL DEFAULT '',
    color_1           INTEGER NOT NULL DEFAULT 0,
    color_2           INTEGER NOT NULL DEFAULT 0,
    color_3           INTEGER NOT NULL DEFAULT 0,
    color_4           INTEGER NOT NULL DEFAULT 0,
    tracked     BOOLEAN NOT NULL DEFAULT false,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clubs_acompanhado ON clubs(tracked);

-- Totais gerais que a origem devolve mesmo para clube não acompanhado.
-- Separado de clubs porque existe justamente para quem nunca terá elenco.
CREATE TABLE IF NOT EXISTS clubs_totais (
    club_id          TEXT PRIMARY KEY,
    played            INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    draws          INTEGER NOT NULL DEFAULT 0,
    losses         INTEGER NOT NULL DEFAULT 0,
    goals             INTEGER NOT NULL DEFAULT 0,
    goals_conceded    INTEGER NOT NULL DEFAULT 0,
    clean_sheets INTEGER NOT NULL DEFAULT 0,
    points           INTEGER NOT NULL DEFAULT 0,
    division    INTEGER NOT NULL DEFAULT 0,
    best_division   INTEGER NOT NULL DEFAULT 0,
    skill_rating            INTEGER NOT NULL DEFAULT 0,
    promotions        INTEGER NOT NULL DEFAULT 0,
    relegations    INTEGER NOT NULL DEFAULT 0,
    read_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma partida, vista UMA ÚNICA VEZ mesmo quando os dois clubes jogaram
-- entre si. match_id unique é o que garante isso: a segunda vez é update.
-- resultado_* já vem normalizado do ingest (a origem usa 5 códigos
-- numéricos para 3 resultados e amistoso não traz marcação nenhuma).
CREATE TABLE IF NOT EXISTS clubs_matches (
    id                            UUID PRIMARY KEY,
    match_id                      TEXT NOT NULL UNIQUE,
    timestamp                     TIMESTAMPTZ NOT NULL,
    kind                          TEXT NOT NULL CHECK (kind IN ('league','friendly','playoff')),
    playoff_round                TEXT NOT NULL DEFAULT '',
    home_club_id                 TEXT NOT NULL,
    away_club_id                 TEXT NOT NULL,
    home_goals                     INTEGER NOT NULL DEFAULT 0,
    away_goals                     INTEGER NOT NULL DEFAULT 0,
    decided_by_forfeit             BOOLEAN NOT NULL DEFAULT false,
    forfeit_winner_id   TEXT NOT NULL DEFAULT '',
    home_result                TEXT NOT NULL CHECK (home_result IN ('win','draw','loss')),
    events                        JSONB NOT NULL DEFAULT '[]',
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clubs_matches_casa ON clubs_matches(home_club_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_clubs_matches_fora ON clubs_matches(away_club_id, timestamp DESC);

-- Atuação de um jogador numa partida. Uma linha por jogador por partida,
-- dos DOIS times -- é daqui que sai o índice cross-club que a origem não
-- oferece. defesas_por_tipo só existe para goleiro (jsonb evita 6 colunas
-- vazias para todo mundo).
CREATE TABLE IF NOT EXISTS clubs_match_players (
    id                  UUID PRIMARY KEY,
    match_id_uuid          UUID NOT NULL REFERENCES clubs_matches(id) ON DELETE CASCADE,
    club_id             TEXT NOT NULL,
    player_id           TEXT NOT NULL,
    gamertag            TEXT NOT NULL,
    position             TEXT NOT NULL CHECK (position IN ('goalkeeper','defender','midfielder','forward')),
    rating                NUMERIC(4,2) NOT NULL DEFAULT 0,
    goals                INTEGER NOT NULL DEFAULT 0,
    assists        INTEGER NOT NULL DEFAULT 0,
    shots              INTEGER NOT NULL DEFAULT 0,
    passes_made       INTEGER NOT NULL DEFAULT 0,
    passes_attempted     INTEGER NOT NULL DEFAULT 0,
    tackles_made     INTEGER NOT NULL DEFAULT 0,
    tackles_attempted   INTEGER NOT NULL DEFAULT 0,
    saves             INTEGER NOT NULL DEFAULT 0,
    saves_by_type    JSONB,
    seconds_played    INTEGER NOT NULL DEFAULT 0,
    man_of_the_match     BOOLEAN NOT NULL DEFAULT false,
    red_card     BOOLEAN NOT NULL DEFAULT false,
    clean_sheet BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (match_id_uuid, player_id)
);

CREATE INDEX IF NOT EXISTS idx_clubs_match_players_partida ON clubs_match_players(match_id_uuid, club_id);
CREATE INDEX IF NOT EXISTS idx_clubs_match_players_player ON clubs_match_players(player_id);

-- Totais de CARREIRA de um jogador num clube, do `members/career/stats` da
-- fonte -- o acumulado histórico, não a temporada corrente. O endpoint nunca
-- era chamado; com ele o perfil de um jogador ganha os números de carreira.
--
-- A chave é (club_id, gamertag): este endpoint NÃO traz playerId, então o
-- gamertag é o único elo. Quem lê casa com a linha de partida pelo nome.
CREATE TABLE IF NOT EXISTS clubs_player_career (
    club_id      TEXT NOT NULL,
    gamertag     TEXT NOT NULL,
    played        INTEGER NOT NULL DEFAULT 0,
    goals         INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    man_of_the_match INTEGER NOT NULL DEFAULT 0,
    rating         NUMERIC(4,2) NOT NULL DEFAULT 0,
    position      TEXT NOT NULL DEFAULT '',
    read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (club_id, gamertag)
);

-- Leitura de nível/divisão num instante. APPEND-ONLY: é o único dado que
-- torna a evolução possível, já que a origem não guarda histórico.
CREATE TABLE IF NOT EXISTS clubs_snapshots (
    id             UUID PRIMARY KEY,
    club_id        TEXT NOT NULL,
    read_at        TIMESTAMPTZ NOT NULL,
    skill_rating          INTEGER NOT NULL DEFAULT 0,
    division_at_read        INTEGER NOT NULL DEFAULT 0,
    played          INTEGER NOT NULL DEFAULT 0,
    wins       INTEGER NOT NULL DEFAULT 0,
    draws        INTEGER NOT NULL DEFAULT 0,
    losses       INTEGER NOT NULL DEFAULT 0,
    goals           INTEGER NOT NULL DEFAULT 0,
    goals_conceded  INTEGER NOT NULL DEFAULT 0,
    squad_size INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_clubs_snapshots_club ON clubs_snapshots(club_id, read_at DESC);

-- Evento datado de subida/queda, derivado do diff entre dois snapshots.
-- para < de = promoção.
CREATE TABLE IF NOT EXISTS clubs_division_changes (
    id           UUID PRIMARY KEY,
    club_id      TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    previous_division           INTEGER NOT NULL,
    new_division         INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('promotion','relegation'))
);

CREATE INDEX IF NOT EXISTS idx_clubs_division_changes_club ON clubs_division_changes(club_id, detected_at DESC);

-- Feed da home: derivado pelo próprio ingest dos fatos que acabou de
-- gravar (resultado novo, recorde batido, mudança de divisão). Não é
-- curado à mão e não tem endpoint de escrita pública.
CREATE TABLE IF NOT EXISTS clubs_announcements (
    id            UUID PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('resultado','ranking','jogador','novidade')),
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    reference_id TEXT NOT NULL DEFAULT '',
    icon         TEXT NOT NULL DEFAULT '',
    -- Os FATOS do aviso (resultado, gols, tipo de partida...), para a
    -- interface montar a frase no idioma escolhido. O `title` acima é o
    -- fallback de quem lê o dado cru; a frase pronta saía no idioma do worker
    -- e por isso o feed misturava "Vitória por" com "Loss por".
    data         JSONB NOT NULL DEFAULT '{}',
    generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ
);

-- `CREATE TABLE IF NOT EXISTS` é no-op numa tabela que já existe: a coluna
-- nova precisa do ALTER para chegar a um banco em produção.
ALTER TABLE clubs_announcements ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_clubs_announcements_gerado ON clubs_announcements(generated_at DESC);

-- Preferências por pessoa: watchlist, pro reivindicado e avisos. É a
-- ÚNICA parte particionada por usuario_email -- o resto do schema de
-- clubs é dado público. Toda leitura filtra por esse campo.
CREATE TABLE IF NOT EXISTS clubs_preferences (
    user_email      TEXT PRIMARY KEY,
    channel              TEXT NOT NULL DEFAULT '',
    weekly_digest   BOOLEAN NOT NULL DEFAULT true,
    records_and_divisions BOOLEAN NOT NULL DEFAULT true,
    match_results BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs_watchlist (
    user_email   TEXT NOT NULL,
    club_id         TEXT NOT NULL,
    tracked_since  TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('own','rival','rival_of_rival','manual')),
    PRIMARY KEY (user_email, club_id)
);

CREATE INDEX IF NOT EXISTS idx_clubs_watchlist_usuario ON clubs_watchlist(user_email);

CREATE TABLE IF NOT EXISTS clubs_claimed_pros (
    user_email  TEXT PRIMARY KEY,
    club_id        TEXT NOT NULL,
    player_id      TEXT NOT NULL,
    verified     BOOLEAN NOT NULL DEFAULT false,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clubs_claimed_pros_player ON clubs_claimed_pros(player_id);

-- Um pro pertence a UMA pessoa: a gamertag é a identidade dela no jogo, e
-- duas contas reivindicando o mesmo pro deixaria o selo de verificado mentindo
-- para uma delas. É este índice que dá sentido ao "já resgatado" da tela de
-- resgate -- sem ele o botão bloquearia por engano ou não bloquearia nada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_clubs_claimed_pros_player ON clubs_claimed_pros(player_id);

-- Estado da última sincronização de uma pessoa, para a SPA desenhar o
-- progresso por nível sem bloquear a navegação.
CREATE TABLE IF NOT EXISTS clubs_sync_runs (
    user_email TEXT PRIMARY KEY,
    running       BOOLEAN NOT NULL DEFAULT false,
    skill_rating         INTEGER NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL DEFAULT 0,
    completed    INTEGER NOT NULL DEFAULT 0,
    current         TEXT NOT NULL DEFAULT '',
    new_items         JSONB NOT NULL DEFAULT '[]',
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ
);

-- ===========================================================================
-- Fila de sync sob demanda (clubs_fetch_runs).
--
-- A SPA grava um pedido aqui; o worker de ingestão polla, busca da fonte,
-- grava pela domain-api e fecha o pedido. A SPA lê o estado para desenhar o
-- progresso.
--
-- O ALVO é genérico (`alvo`: clube | jogador): a pessoa quer forçar a
-- atualização daquilo que está olhando, e não há motivo para uma fila por tipo
-- de entidade. Começou só com clube (a tela de resgate); agora aceita um
-- player_id também.
--
-- Para jogador a fonte não tem endpoint próprio -- o dado dele É derivado das
-- partidas dos clubes onde jogou. Então syncar jogador é atualizar as partidas
-- desses clubes; o perfil se recalcula sozinho na leitura.
--
-- A chave é (alvo, alvo_id): pedir o mesmo duas vezes não duplica trabalho.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS clubs_fetch_runs (
    target          TEXT NOT NULL DEFAULT 'clube',
    target_id       TEXT NOT NULL,
    label        TEXT NOT NULL DEFAULT '',
    running       BOOLEAN NOT NULL DEFAULT false,
    players     INTEGER NOT NULL DEFAULT 0,
    matches      INTEGER NOT NULL DEFAULT 0,
    clubs        INTEGER NOT NULL DEFAULT 0,
    error          TEXT NOT NULL DEFAULT '',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    PRIMARY KEY (target, target_id)
);

CREATE INDEX IF NOT EXISTS idx_clubs_fetch_runs_pendentes ON clubs_fetch_runs(running, requested_at);

-- ===========================================================================
-- Fila de busca ao vivo na fonte (clubs_search_runs).
--
-- A busca de clubes do hub é LOCAL: ela procura no que o hub já viu. Isso é
-- rápido e é o certo para o diretório, mas cria um ovo-e-a-galinha na tela de
-- resgate: quem chega com um clube que o hub nunca viu procura por ele, não
-- acha, e conclui que a tela está quebrada -- sem ter como saber que o clube
-- simplesmente não está na base ainda.
--
-- Esta fila é a saída: quando a busca local não devolve nada útil, a SPA grava
-- o termo aqui, o worker de ingestão consulta a fonte (é ele que fala com o
-- CDN) e grava os clubes encontrados na base. A SPA polla o estado e mostra o
-- resultado quando chega. A chave é o TERMO normalizado, então buscar duas
-- vezes a mesma coisa não duplica trabalho.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS clubs_search_runs (
    termo         TEXT PRIMARY KEY,
    running       BOOLEAN NOT NULL DEFAULT false,
    found   INTEGER NOT NULL DEFAULT 0,
    error          TEXT NOT NULL DEFAULT '',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clubs_search_runs_pendentes ON clubs_search_runs(running, requested_at);

-- ===========================================================================
-- Estado do worker de ingestão (clubs-ingest).
--
-- O worker é Python e NÃO serve HTTP (é um poller, sem porta e sem host), então
-- não há /healthz para consultar. Sem isto, quando ele falha em produção não há
-- como saber por quê: o log fica no container, atrás do SSH.
--
-- Uma linha só, atualizada a cada ciclo. É o que permite diagnosticar de fora
-- -- inclusive o cenário do ADR#4, em que o CDN da fonte bloqueia o IP do
-- datacenter e nenhuma consulta passa.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS clubs_ingest_estado (
    id                INTEGER PRIMARY KEY DEFAULT 1,
    last_cycle_at   TIMESTAMPTZ,
    cycles           INTEGER NOT NULL DEFAULT 0,
    clubs_ok         INTEGER NOT NULL DEFAULT 0,
    clubs_failed     INTEGER NOT NULL DEFAULT 0,
    new_matches    INTEGER NOT NULL DEFAULT 0,
    snapshots         INTEGER NOT NULL DEFAULT 0,
    bootstrapped   BOOLEAN NOT NULL DEFAULT false,
    last_error       TEXT NOT NULL DEFAULT '',
    last_error_at    TIMESTAMPTZ,
    -- Se a fonte (EA/CDN) está conversável AGORA. Distinto de last_error: um
    -- erro pode ser de um clube só; source_available=false é a fonte inteira
    -- recusando (403 do CDN, rede). É o que a interface lê para dizer "estamos
    -- com problemas para falar com a fornecedora dos dados" em vez de mostrar
    -- o vazio como resposta.
    source_available BOOLEAN NOT NULL DEFAULT true,
    source_error     TEXT NOT NULL DEFAULT '',
    CONSTRAINT clubs_ingest_estado_single CHECK (id = 1)
);

-- Bancos criados antes da coluna de saúde da fonte.
ALTER TABLE clubs_ingest_estado ADD COLUMN IF NOT EXISTS source_available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE clubs_ingest_estado ADD COLUMN IF NOT EXISTS source_error TEXT NOT NULL DEFAULT '';

-- ===========================================================================
-- Perfil público (opt-in).
--
-- O padrão do hub é dado pessoal isolado: FR-025/SC-005 proíbem que o dado de
-- uma pessoa apareça para outra. Um perfil público só existe se a PESSOA
-- marcar -- por isso a coluna nasce false, e a leitura pública consulta
-- `WHERE publico = true`. Sem isso, "perfil público" violaria a spec.
--
-- O que um perfil público mostra: o pro reivindicado (que já é público -- o
-- selo de verificado aparece para qualquer um no perfil do jogador) e os clubes
-- que a pessoa segue. NUNCA o e-mail: a chave é o e-mail (interno), mas a
-- resposta usa um identificador opaco e o gamertag.
-- ===========================================================================

ALTER TABLE clubs_preferences ADD COLUMN IF NOT EXISTS publico BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clubs_preferences ADD COLUMN IF NOT EXISTS public_handle TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_clubs_preferences_handle
    ON clubs_preferences (lower(public_handle)) WHERE public_handle <> '';

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

-- ===========================================================================
-- Prospecta (specs/004-prospecta) — Company + ICP. Bloco idêntico ao do
-- domain-worker (as duas cópias do schema convergem no boot). Ver a nota de
-- RLS/pgvector lá; o embedding fica JSONB porque o Postgres do repo não tem
-- pgvector.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS prospecta_company (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    name         TEXT NOT NULL,
    site         TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    command_id   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospecta_company_tenant ON prospecta_company (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_company_tenant_site
    ON prospecta_company (tenant_id, site) WHERE site <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_company_command
    ON prospecta_company (command_id) WHERE command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prospecta_icp (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    company_id   UUID NOT NULL REFERENCES prospecta_company(id) ON DELETE CASCADE,
    definition   TEXT NOT NULL,
    signals      TEXT[] NOT NULL DEFAULT '{}',
    embedding    JSONB,
    command_id   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospecta_icp_company ON prospecta_icp (company_id);
CREATE INDEX IF NOT EXISTS idx_prospecta_icp_tenant ON prospecta_icp (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_icp_command
    ON prospecta_icp (command_id) WHERE command_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Agregados restantes do Prospecta (specs/004-prospecta, US2/US3): Campaign,
-- Lead, Message, Conversation, AgentRun e a auditoria própria.
--
-- Mesmas regras do bloco Company/ICP: multi-tenant por tenant_id com RLS
-- (SET LOCAL app.current_tenant na transação), command_id único parcial para a
-- idempotência de reentrega, e embedding em JSONB (sem pgvector neste Postgres).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS prospecta_campaign (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    company_id      UUID NOT NULL,
    icp_id          UUID,
    name            TEXT NOT NULL,
    channels        TEXT[] NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','running','paused','done')),
    approval_policy TEXT NOT NULL DEFAULT 'human',
    command_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecta_campaign_tenant_status ON prospecta_campaign (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_prospecta_campaign_company ON prospecta_campaign (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_campaign_command
    ON prospecta_campaign (command_id) WHERE command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prospecta_lead (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    campaign_id  UUID NOT NULL,
    company_name TEXT NOT NULL,
    domain       TEXT NOT NULL,
    segment      TEXT NOT NULL DEFAULT '',
    channel      TEXT NOT NULL DEFAULT '',
    fit          INTEGER NOT NULL DEFAULT 0 CHECK (fit BETWEEN 0 AND 100),
    status       TEXT NOT NULL DEFAULT 'discovered'
                 CHECK (status IN ('discovered','enriched','qualified','contacted','replied','meeting')),
    source_url   TEXT NOT NULL DEFAULT '',
    enriched     JSONB,
    command_id   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Dedup: o mesmo prospect achado duas vezes é UM lead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_lead_dedup
    ON prospecta_lead (tenant_id, domain, company_name);
CREATE INDEX IF NOT EXISTS idx_prospecta_lead_campaign_status ON prospecta_lead (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_prospecta_lead_tenant_fit ON prospecta_lead (tenant_id, fit DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_lead_command
    ON prospecta_lead (command_id) WHERE command_id IS NOT NULL;
-- O telefone do lead vive em enriched->>'phone' (E.164 sem +). A resposta do
-- WhatsApp não traz tenant, então a leitura by-phone é CROSS-TENANT de propósito
-- e casa por este valor normalizado.
CREATE INDEX IF NOT EXISTS idx_prospecta_lead_phone
    ON prospecta_lead ((enriched->>'phone')) WHERE enriched->>'phone' IS NOT NULL;

CREATE TABLE IF NOT EXISTS prospecta_message (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    lead_id     UUID NOT NULL,
    channel     TEXT NOT NULL DEFAULT '',
    direction   TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('out','in')),
    content     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'drafted'
                CHECK (status IN ('drafted','approved','sent','failed','blocked')),
    external_id TEXT NOT NULL DEFAULT '',
    sent_at     TIMESTAMPTZ,
    command_id  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecta_message_lead ON prospecta_message (lead_id);
CREATE INDEX IF NOT EXISTS idx_prospecta_message_tenant_status ON prospecta_message (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_message_command
    ON prospecta_message (command_id) WHERE command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prospecta_conversation (
    id         UUID PRIMARY KEY,
    tenant_id  UUID NOT NULL,
    lead_id    UUID NOT NULL,
    thread_key TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','waiting','closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- A chave da idempotência do ReceiveReply.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_conversation_thread
    ON prospecta_conversation (tenant_id, thread_key);

CREATE TABLE IF NOT EXISTS prospecta_agent_run (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    campaign_id UUID NOT NULL,
    agent       TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','done','failed')),
    metrics     JSONB NOT NULL DEFAULT '{}',
    command_id  UUID,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_prospecta_agent_run_campaign_state ON prospecta_agent_run (campaign_id, state);
CREATE INDEX IF NOT EXISTS idx_prospecta_agent_run_tenant_started ON prospecta_agent_run (tenant_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_agent_run_command
    ON prospecta_agent_run (command_id) WHERE command_id IS NOT NULL;

-- Auditoria própria do Prospecta (data-model §8): payload JÁ passado por PII
-- scrubbing no handler antes de chegar aqui.
CREATE TABLE IF NOT EXISTS prospecta_audit_log (
    id         UUID PRIMARY KEY,
    tenant_id  UUID NOT NULL,
    command    TEXT NOT NULL,
    status     TEXT NOT NULL,
    payload    JSONB,
    error      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecta_audit_tenant_created ON prospecta_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospecta_audit_command_status ON prospecta_audit_log (command, status);

-- Autenticação (e-mail+senha). Diferente das demais tabelas prospecta_*, o
-- e-mail é ÚNICO GLOBALMENTE (índice em lower(email)): é a identidade do login.
-- Por isso a leitura GET /users/by-email/{email} roda com BYPASS de tenant — o
-- login acha o usuário antes de saber o tenant, e o domain-api NÃO exige
-- tenant_id nela. O RLS por tenant_id continua valendo para todo o resto.
--
-- password_hash guarda o bcrypt JÁ pronto: o worker nunca vê a senha em claro
-- nem faz hashing.
CREATE TABLE IF NOT EXISTS prospecta_user (
    id            UUID PRIMARY KEY,
    tenant_id     UUID NOT NULL,
    company_id    UUID,
    name          TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT '',
    command_id    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_user_email ON prospecta_user (lower(email));
CREATE INDEX IF NOT EXISTS idx_prospecta_user_tenant ON prospecta_user (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_user_command
    ON prospecta_user (command_id) WHERE command_id IS NOT NULL;

-- Guardrail LGPD: um lead que pediu para não ser contatado. O núcleo agêntico
-- consulta esta tabela ANTES de todo envio. A chave natural (tenant_id, lead_id)
-- é única: o mesmo pedido duas vezes é UMA linha (idempotente).
CREATE TABLE IF NOT EXISTS prospecta_opt_out (
    id         UUID PRIMARY KEY,
    tenant_id  UUID NOT NULL,
    lead_id    UUID NOT NULL,
    reason     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecta_opt_out_tenant ON prospecta_opt_out (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospecta_opt_out_tenant_lead
    ON prospecta_opt_out (tenant_id, lead_id);

-- RLS por tenant_id. current_setting('app.current_tenant', true) é NULL quando
-- a sessão não o fixou: o cast ''::uuid falha alto (erro) em vez de comparar
-- NULL e vazar a linha. ENABLE + FORCE para a policy valer também para o owner.
ALTER TABLE prospecta_company ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_company FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_company_tenant ON prospecta_company;
CREATE POLICY prospecta_company_tenant ON prospecta_company
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_icp ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_icp FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_icp_tenant ON prospecta_icp;
CREATE POLICY prospecta_icp_tenant ON prospecta_icp
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_campaign FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_campaign_tenant ON prospecta_campaign;
CREATE POLICY prospecta_campaign_tenant ON prospecta_campaign
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_lead FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_lead_tenant ON prospecta_lead;
CREATE POLICY prospecta_lead_tenant ON prospecta_lead
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_message_tenant ON prospecta_message;
CREATE POLICY prospecta_message_tenant ON prospecta_message
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_conversation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_conversation_tenant ON prospecta_conversation;
CREATE POLICY prospecta_conversation_tenant ON prospecta_conversation
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_agent_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_agent_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_agent_run_tenant ON prospecta_agent_run;
CREATE POLICY prospecta_agent_run_tenant ON prospecta_agent_run
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_audit_log_tenant ON prospecta_audit_log;
CREATE POLICY prospecta_audit_log_tenant ON prospecta_audit_log
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- prospecta_user tem RLS por tenant_id como as demais. A exceção documentada é
-- a leitura by-email (login), que lê com bypass de tenant de propósito: o e-mail
-- é único global e o login não conhece o tenant ainda.
ALTER TABLE prospecta_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_user FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_user_tenant ON prospecta_user;
CREATE POLICY prospecta_user_tenant ON prospecta_user
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE prospecta_opt_out ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecta_opt_out FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecta_opt_out_tenant ON prospecta_opt_out;
CREATE POLICY prospecta_opt_out_tenant ON prospecta_opt_out
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

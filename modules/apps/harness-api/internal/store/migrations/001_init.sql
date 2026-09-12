-- Initial schema for the harness: three tables, nothing else.
--
-- sessoes: one implementation handoff session. Length limits (titulo,
-- objetivo, markdown fields, pr_link) are enforced by the API layer, not
-- here -- SQLite CHECKs can't do byte counts cleanly and the contract
-- wants 422 bodies with per-field details anyway.
CREATE TABLE IF NOT EXISTS sessoes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo             TEXT NOT NULL,
    objetivo           TEXT NOT NULL,
    repo               TEXT,
    contexto_md        TEXT,
    proximos_passos_md TEXT,
    status             TEXT NOT NULL DEFAULT 'em_andamento'
                       CHECK (status IN ('em_andamento', 'entregue', 'arquivada')),
    criador_email      TEXT NOT NULL,
    dono_atual_email   TEXT NOT NULL,
    pr_link            TEXT,
    origem_id          INTEGER REFERENCES sessoes(id),
    criado_em          INTEGER NOT NULL,
    atualizado_em      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessoes_status ON sessoes (status);
CREATE INDEX IF NOT EXISTS idx_sessoes_dono_atual ON sessoes (dono_atual_email);
CREATE INDEX IF NOT EXISTS idx_sessoes_origem ON sessoes (origem_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_atualizado_em ON sessoes (atualizado_em DESC);

-- Append-only timeline: INSERT only, the API never UPDATEs or DELETEs a
-- row here. Dropping a session takes its events with it (ON DELETE
-- CASCADE). payload is a small JSON blob whose shape depends on tipo.
CREATE TABLE IF NOT EXISTS eventos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sessao_id   INTEGER NOT NULL REFERENCES sessoes(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL
                CHECK (tipo IN ('criacao', 'retomada', 'atualizacao_contexto', 'extensao_criada', 'status_mudou')),
    autor_email TEXT NOT NULL,
    payload     TEXT,
    criado_em   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_sessao_criado_em ON eventos (sessao_id, criado_em ASC);

-- Identity cache derived from the Access JWT (research D7): the API
-- upserts the caller on every authenticated request so list/timeline
-- responses can show real names for other people's actions.
CREATE TABLE IF NOT EXISTS usuarios (
    email         TEXT PRIMARY KEY,
    nome          TEXT NOT NULL,
    ultima_visita INTEGER NOT NULL
);
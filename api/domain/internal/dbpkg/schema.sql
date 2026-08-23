CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per command processed by domain-worker, whether it succeeded
-- or not (see internal/audit — failures are audited too, not just
-- successful writes, since "who tried to do what" matters as much as
-- "what changed").
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

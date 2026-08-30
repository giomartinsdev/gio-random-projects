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

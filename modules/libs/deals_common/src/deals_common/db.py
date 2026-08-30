"""raw_deals persistence.

Stage table for every source. Idempotent by (source, source_deal_id):
re-polling the same page rewrites the same rows with fresh scraped_at
and updated columns, and upsert_deals reports which rows were NEW so
the workers announce only genuinely fresh deals.

The shared Postgres hosts whole app databases already, so raw_deals
lives there too -- one table, zero new infrastructure. Workers
self-migrate with CREATE TABLE IF NOT EXISTS: a table this young
doesn't justify a migrate sidecar yet; if the schema ever grows real
structure, that's the moment for a proper drizzle/alembic-style
sidecar like the TS apps have.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import psycopg

from .model import RawDeal

log = logging.getLogger(__name__)

_SCHEMA = """
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
"""

_UPSERT = """
INSERT INTO raw_deals
    (source, source_deal_id, title, url, store, price_cents, old_price_cents,
     posted_at, scraped_at, payload)
VALUES
    (%(source)s, %(source_deal_id)s, %(title)s, %(url)s, %(store)s, %(price_cents)s,
     %(old_price_cents)s, %(posted_at)s, %(scraped_at)s, %(payload)s)
ON CONFLICT (source, source_deal_id) DO UPDATE SET
    title = EXCLUDED.title,
    url = EXCLUDED.url,
    store = EXCLUDED.store,
    price_cents = EXCLUDED.price_cents,
    old_price_cents = EXCLUDED.old_price_cents,
    scraped_at = EXCLUDED.scraped_at,
    payload = EXCLUDED.payload
-- xmax flips to a new write-tuple id only on INSERT, so a row updated
-- by a re-poll of the same deal never reports itself as fresh news.
RETURNING source_deal_id, (xmax = 0) AS inserted
"""


def ensure_schema(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        conn.execute(_SCHEMA)
        conn.commit()


def upsert_deals(database_url: str, deals: list[RawDeal]) -> list[RawDeal]:
    """Persist deals; returns the ones that were newly inserted."""
    if not deals:
        return []

    inserted: list[RawDeal] = []
    with psycopg.connect(database_url) as conn:
        for deal in deals:
            row = conn.execute(
                _UPSERT,
                {
                    "source": deal.source,
                    "source_deal_id": deal.source_deal_id,
                    "title": deal.title,
                    "url": deal.url,
                    "store": deal.store,
                    "price_cents": deal.price_cents,
                    "old_price_cents": deal.old_price_cents,
                    "posted_at": deal.posted_at,
                    "scraped_at": deal.scraped_at,
                    "payload": json.dumps(deal.payload),
                },
            ).fetchone()
            if row is not None and row[1]:
                inserted.append(deal)
        conn.commit()

    log.info("upserted %d deals (%d new) from %s", len(deals), len(inserted), deals[0].source)
    return inserted


def utcnow() -> datetime:
    return datetime.now(tz=UTC)
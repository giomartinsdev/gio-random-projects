"""Append-only audit log: one row per domain event actually dispatched.

Not a domain entity — this is infrastructure, so it lives here rather
than under app/domain/. Still picked up by SQLModel.metadata the same
way (table=True), since service/dispatcher.py imports this module
unconditionally, and that import chain runs before
infrastructure/db.py's create_db_and_tables() call regardless of
whether app/domain/ discovery would have also found it.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class DomainEventRecord(SQLModel, table=True):
    __tablename__ = "domain_event_store"

    id: int | None = Field(default=None, primary_key=True)
    event_type: str
    entity_type: str
    payload: str
    result: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

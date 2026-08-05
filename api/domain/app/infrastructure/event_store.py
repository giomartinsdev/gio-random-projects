"""Append-only audit log: one row per domain event actually dispatched.

Not a domain entity — this is infrastructure, so it lives here rather
than under app/domain/. Still picked up by SQLModel.metadata the same
way (table=True), since service/dispatcher.py imports this module
unconditionally, and that import chain runs before
infrastructure/db.py's create_db_and_tables() call regardless of
whether app/domain/ discovery would have also found it.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


class DomainEventRecord(SQLModel, table=True):
    # SQLAlchemy's own stubs declare __tablename__ as a `declared_attr`
    # descriptor; a plain string is the standard/idiomatic SQLModel
    # pattern and works fine at runtime, but doesn't match that stub.
    __tablename__ = "domain_event_store"  # pyright: ignore[reportAssignmentType]

    id: int | None = Field(default=None, primary_key=True)
    event_type: str
    entity_type: str
    payload: str
    result: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

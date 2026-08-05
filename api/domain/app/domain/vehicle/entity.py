from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — SQLModel resolves field annotations at class-creation time, not just for static typing
)

from sqlmodel import Field

from app.domain.base import Entity


class Vehicle(Entity, table=True):
    """Registry of every distinct vehicle ever seen — one row per
    vehicle, created once and only ever touched again to bump
    `last_seen_at`. Bounded by fleet size (thousands of buses), not by
    how many times it's been polled — unlike an append-only position
    log would be.
    """

    # Overrides Entity's autoincrement int id with a natural string key
    # (SPPO's "ordem" / BRT's "codigo") — confirmed by testing that
    # SQLModel/SQLAlchemy handle this override correctly at runtime;
    # pyright's LSP-invariance check doesn't reflect a real risk here,
    # since nothing treats a Vehicle polymorphically as a plain Entity.
    id: str = Field(primary_key=True)  # pyright: ignore[reportIncompatibleVariableOverride, reportGeneralTypeIssues]
    mode: str
    first_seen_at: datetime
    last_seen_at: datetime

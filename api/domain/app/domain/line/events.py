"""Every event for the Line domain. See app/domain/stop/events.py's
module docstring for why only a bulk upsert and a plain list exist.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.domain.base import DomainEvent, ListAll
from app.domain.line.entity import Line

if TYPE_CHECKING:
    from sqlmodel import Session

_CHUNK_SIZE = 5000


class LineInput(BaseModel):
    """One line — shape produced by flows/gtfs_importer's transform stage."""

    id: str
    code: str
    name: str
    mode: str


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class UpsertLines(DomainEvent[Line]):
    """Bulk upserts lines by their GTFS route_id — same chunked
    ON CONFLICT shape as UpsertStops (see app/domain/stop/events.py)."""

    lines: list[LineInput]

    def handle(self, session: Session) -> int:
        if not self.lines:
            return 0

        bind = session.get_bind()
        insert = pg_insert if bind.dialect.name == "postgresql" else sqlite_insert

        by_id = {line.id: line for line in self.lines}
        lines = list(by_id.values())

        for batch in _chunks(lines, _CHUNK_SIZE):
            rows: list[dict[str, Any]] = [line.model_dump() for line in batch]
            stmt = insert(Line).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "code": stmt.excluded.code,
                    "name": stmt.excluded.name,
                    "mode": stmt.excluded.mode,
                },
            )
            session.exec(stmt)

        session.commit()
        return len(lines)


class ListLines(ListAll[Line]):
    """Every line, unfiltered."""

"""Generic, policy-free primitives for RouteStop — same stance as
app/domain/vehicle_position/history_events.py's own module docstring:
which line_ids to replace, and with what rows, is entirely the caller's
decision (flows/gtfs_importer passes every line_id from the feed it just
parsed). The domain's job is limited to what these two events say on the
tin — replace a given set of lines' stop sequences, list a given set of
lines' stop sequences — with no opinion on why.
"""

# RouteStop's class-level attributes (.line_id, .direction_id, ...) don't
# expose SQLAlchemy's InstrumentedAttribute interface to pyright the way
# raw declarative classes do — same gap history_events.py already
# documents and silences the same way. reportCallIssue/reportArgumentType
# are the same root cause surfacing on select()/order_by() specifically:
# pyright sees plain `int`/`str` attributes instead of ColumnElement.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportAttributeAccessIssue=false, reportCallIssue=false, reportArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any, ClassVar

from pydantic import BaseModel
from sqlalchemy import delete, insert
from sqlmodel import select

from app.domain.base import DomainEvent, ListAll
from app.domain.line.route_stop_entity import RouteStop

if TYPE_CHECKING:
    from sqlmodel import Session

# Postgres caps a single query at 65535 bind parameters — RouteStop's 4
# columns/row means >16383 rows would blow that limit outright, and a
# real city-wide GTFS import is 40k+ rows (confirmed live: an unchunked
# insert here crashed gtfs_importer's very first production run with
# "the number of query arguments" past that cap). Same chunking already
# applied to UpsertStops/UpsertLines/RecordVehiclePositions — just
# missing here until now.
_CHUNK_SIZE = 5000


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class RouteStopInput(BaseModel):
    """One stop-sequence row — shape produced by
    flows/gtfs_importer's transform stage."""

    line_id: str
    stop_id: str
    direction_id: int
    sequence: int


class ReplaceRouteStops(DomainEvent[RouteStop]):
    """Deletes every existing RouteStop row for the given line_ids, then
    inserts `stops` in their place — a delete-then-insert, not an
    upsert, since RouteStop has no natural key to conflict on (see the
    entity's own docstring). Passing every line_id from the current
    import (not just ones with stops in `stops`) is what correctly
    empties a line that lost its stop sequence entirely between
    reimports, rather than leaving its old rows stale."""

    line_ids: list[str]
    stops: list[RouteStopInput]

    def handle(self, session: Session) -> int:
        if self.line_ids:
            session.exec(delete(RouteStop).where(RouteStop.line_id.in_(self.line_ids)))
        if not self.stops:
            session.commit()
            return 0

        for batch in _chunks(self.stops, _CHUNK_SIZE):
            rows: list[dict[str, Any]] = [s.model_dump() for s in batch]
            session.exec(insert(RouteStop).values(rows))
        session.commit()
        return len(self.stops)


class ListRouteStops(ListAll[RouteStop]):
    """Every RouteStop row, unfiltered — a future trip-planner's own
    caching layer builds a stop→lines index from this rather than
    calling ListRouteStopsByLine once per candidate line it doesn't
    know about yet."""


class ListRouteStopsByLine(DomainEvent[RouteStop]):
    """Every RouteStop row for the given line_ids, ordered by direction
    then sequence — a mechanical filter+sort, not a business rule (same
    stance as GetById in app/domain/base.py), so a future trip-planner
    can fetch one line's stop sequence without pulling every line's
    mapping city-wide."""

    __http_method__: ClassVar[str] = "GET"

    line_ids: list[str]

    def handle(self, session: Session) -> list[RouteStop]:
        return list(
            session.exec(
                select(RouteStop)
                .where(RouteStop.line_id.in_(self.line_ids))
                .order_by(RouteStop.direction_id, RouteStop.sequence)
            ).all()
        )

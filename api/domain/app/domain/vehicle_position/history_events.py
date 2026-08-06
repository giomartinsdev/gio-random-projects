"""Generic, policy-free primitives for VehiclePositionHistory. No
pruning/archiving decision lives in the domain — that's a business rule,
not a persistence mechanic, so it belongs in flows/vehicle_position_archiver
instead: that flow decides which rows are old enough to archive, builds
the Parquet file, uploads it (via app/domain/object_storage's PutObject
event), and only then tells the domain which ids to delete. The domain's
job here is limited to what these two events say on the tin — list every
row, delete a given batch of ids — with no opinion on why.
"""

# SQLModel table classes don't expose class-level attribute access
# (`VehiclePositionHistory.id`) as a SQLAlchemy InstrumentedAttribute the
# way raw SQLAlchemy declarative classes do under pyright — it sees the
# plain Python field type (`int | None`) instead, so `.in_()` cascades to
# Unknown. Confirmed working at runtime — same relaxation this domain's
# other raw-SQL-adjacent event needed before this file's logic moved to
# flows/vehicle_position_archiver.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportAttributeAccessIssue=false, reportOptionalMemberAccess=false

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

from sqlalchemy import delete

from app.domain.base import DomainEvent, ListAll
from app.domain.vehicle_position.history_entity import VehiclePositionHistory

if TYPE_CHECKING:
    from sqlmodel import Session


class ListVehiclePositionHistory(ListAll[VehiclePositionHistory]):
    """Every VehiclePositionHistory row, unfiltered. The caller decides
    what (if anything) should be archived — the domain has no opinion."""


class DeleteVehiclePositionHistoryBatch(DomainEvent[VehiclePositionHistory]):
    """Deletes exactly the given ids. Purely mechanical — which ids to
    pass is entirely the caller's decision (see
    flows/vehicle_position_archiver's transform stage, which computes
    "older than the 10 most recent per vehicle" before calling this)."""

    __http_method__: ClassVar[str] = "DELETE"

    # Defaults to empty (not required) so calling with no `ids` at all is
    # a valid, explicit no-op rather than a 422 — mirrors handle()'s own
    # early return below.
    ids: list[int] = []  # noqa: RUF012 — a plain list default is fine here: Pydantic (unlike a dataclass) already deep-copies mutable defaults per instance

    def handle(self, session: Session) -> int:
        if not self.ids:
            return 0
        result = session.exec(
            delete(VehiclePositionHistory).where(VehiclePositionHistory.id.in_(self.ids))
        )
        session.commit()
        return result.rowcount

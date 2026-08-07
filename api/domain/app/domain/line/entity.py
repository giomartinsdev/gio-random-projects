from sqlmodel import Field

from app.domain.base import Entity


class Line(Entity, table=True):
    """One GTFS route (bus or BRT) — id is the feed's own route_id, same
    "re-import upserts, never duplicates" reasoning as Stop (see
    app/domain/stop/entity.py).
    """

    # See app/domain/vehicle/entity.py's Vehicle.id for why this
    # override (and the pyright ignore) is safe here.
    id: str = Field(primary_key=True)  # pyright: ignore[reportIncompatibleVariableOverride, reportGeneralTypeIssues]
    code: str
    name: str
    # "bus" | "brt" — see flows/gtfs_importer/etl/transform.py for how
    # this is inferred (Rio's own feed gives BRT no distinguishing
    # route_type of its own).
    mode: str

from sqlmodel import Field

from app.domain.base import Entity


class Stop(Entity, table=True):
    """One GTFS stop (bus or BRT) — id is the feed's own stop_id, not an
    autoincrement surrogate, so re-importing the same monthly GTFS feed
    (see flows/gtfs_importer) upserts the same row instead of
    duplicating it every run.
    """

    # See app/domain/vehicle/entity.py's Vehicle.id for why this
    # override (and the pyright ignore) is safe here.
    id: str = Field(primary_key=True)  # pyright: ignore[reportIncompatibleVariableOverride, reportGeneralTypeIssues]
    name: str
    latitude: float
    longitude: float
    # "bus" | "rail" — defaults to "bus" so every pre-existing row (and
    # every GTFS reimport, which never sends this field) keeps working
    # unchanged. See app/domain/line/entity.py's own mode field for the
    # same pattern on the Line side.
    mode: str = Field(default="bus")

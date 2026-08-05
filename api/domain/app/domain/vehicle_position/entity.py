from sqlmodel import Field

from app.domain.base import Document


class VehiclePosition(Document, table=True):
    """Each vehicle's LATEST known position — one row per vehicle,
    overwritten (not appended to) on every poll. Bounded by fleet size,
    not by how many times it's been polled — the entire point over an
    append-only history, since only the current picture is ever needed.
    See flows/bus_gps_poller for what actually lands in `data`
    (mode/line_code/vehicle_id/latitude/longitude/speed_kmh/color_hex).
    """

    # See app/domain/vehicle/entity.py's Vehicle.id for why this
    # override (and the pyright ignore) is safe here.
    id: str = Field(primary_key=True)  # pyright: ignore[reportIncompatibleVariableOverride, reportGeneralTypeIssues]

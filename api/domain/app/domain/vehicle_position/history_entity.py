from sqlmodel import Field

from app.domain.base import Document


class VehiclePositionHistory(Document, table=True):
    """Append-only position history — every poll adds a new row here
    (unlike VehiclePosition, which overwrites), keyed by autoincrement
    `id` from `Document`/`Entity` since there are many rows per
    vehicle. `vehicle_id` is its own indexed column (not buried inside
    `data`) so flows/vehicle_position_archiver's "rows beyond the 10
    most recent per vehicle" query (client-side — see history_events.py's
    module docstring for why that logic isn't here) can use it directly
    instead of unpacking JSONB for every row. Only ever holds the 10
    most recent rows per vehicle in steady state — older rows get
    archived to Parquet on MinIO and pruned by that flow, hourly."""

    vehicle_id: str = Field(index=True)

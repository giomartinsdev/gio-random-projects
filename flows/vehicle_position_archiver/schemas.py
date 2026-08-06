from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — Pydantic resolves field annotations at class-creation time, not just for static typing
)
from typing import Any

from pydantic import BaseModel


class VehiclePositionHistoryRow(BaseModel):
    """One VehiclePositionHistory row, as returned by the domain's
    ListVehiclePositionHistory event (see
    api/domain/app/domain/vehicle_position/history_events.py)."""

    id: int
    vehicle_id: str
    data: dict[str, Any]
    captured_at: datetime


class ArchivePlan(BaseModel):
    """What the transform stage decided: the rows old enough to archive,
    bundled as one Parquet file under `object_key`, plus exactly which
    ids to delete once that upload succeeds. `object_key` is None when
    no vehicle exceeded `keep_per_vehicle` this run — nothing to do."""

    object_key: str | None
    parquet_bytes: bytes
    archived_ids: list[int]

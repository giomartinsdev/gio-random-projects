"""Marker entity for MinIO/object-storage events. Object storage isn't a
database-backed aggregate — there's no `table=True` here — but every
DomainEvent still has to bind to a concrete Entity subclass (see
__init_subclass__ in app/domain/base.py), so this exists purely to give
CreateBucket/PutObject/GetObject/ListObjects/DeleteObject something to
parameterize DomainEvent[...] with, the same way
DeleteVehiclePositionHistoryBatch binds to VehiclePositionHistory even
though its own handle() isn't a plain single-row CRUD op either (see
app/domain/vehicle_position/history_events.py).
"""

from __future__ import annotations

from app.domain.base import Entity


class StorageObject(Entity):
    """Never instantiated as a row — see module docstring."""

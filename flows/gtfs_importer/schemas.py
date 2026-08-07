from __future__ import annotations

from pydantic import BaseModel


class StopCapture(BaseModel):
    """One stop — shape api/domain's UpsertStops event expects (see
    api/domain/app/domain/stop/events.py's StopInput)."""

    id: str
    name: str
    latitude: float
    longitude: float


class LineCapture(BaseModel):
    """One line — shape api/domain's UpsertLines event expects (see
    api/domain/app/domain/line/events.py's LineInput)."""

    id: str
    code: str
    name: str
    mode: str


class RouteStopCapture(BaseModel):
    """One stop-sequence row — shape api/domain's ReplaceRouteStops
    event expects (see
    api/domain/app/domain/line/route_stop_events.py's RouteStopInput)."""

    line_id: str
    stop_id: str
    direction_id: int
    sequence: int


class GtfsCapture(BaseModel):
    """Everything one GTFS import produces, already shaped for the three
    domain events the load stage calls."""

    stops: list[StopCapture]
    lines: list[LineCapture]
    route_stops: list[RouteStopCapture]

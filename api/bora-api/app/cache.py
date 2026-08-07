"""In-memory reference-data cache. Stop/Line/RouteStop only change when
flows/gtfs_importer reimports (monthly, see prefect.yaml) — refreshing
them from the domain on every request would be pure waste for data that
stale. Live vehicle positions are never held here; those come fresh from
DomainClient on every trip-planning call (see trip_planner.py) since
staleness there directly defeats the point.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.domain_client import DomainClient, LineRecord, RouteStopRecord, StopRecord


class ReferenceDataCache:
    def __init__(self, domain_client: DomainClient, ttl_seconds: float) -> None:
        self._domain_client = domain_client
        self._ttl_seconds = ttl_seconds
        self._stops: list[StopRecord] = []
        self._stops_by_id: dict[str, StopRecord] = {}
        self._lines_by_id: dict[str, LineRecord] = {}
        self._route_stops_by_stop: dict[str, list[RouteStopRecord]] = {}
        self._route_stops_by_line: dict[tuple[str, int], list[RouteStopRecord]] = {}
        self._refreshed_at: float | None = None

    def _ensure_fresh(self) -> None:
        if (
            self._refreshed_at is not None
            and time.monotonic() - self._refreshed_at < self._ttl_seconds
        ):
            return

        self._stops = self._domain_client.list_stops()
        self._stops_by_id = {stop.id: stop for stop in self._stops}
        self._lines_by_id = {line.id: line for line in self._domain_client.list_lines()}

        by_stop: dict[str, list[RouteStopRecord]] = defaultdict(list)
        by_line: dict[tuple[str, int], list[RouteStopRecord]] = defaultdict(list)
        for route_stop in self._domain_client.list_route_stops():
            by_stop[route_stop.stop_id].append(route_stop)
            by_line[(route_stop.line_id, route_stop.direction_id)].append(route_stop)
        self._route_stops_by_stop = dict(by_stop)
        # Sorted once here, not by every caller — TripPlanner's transfer
        # search walks a route's stops in sequence order many times per
        # request (once per candidate boarding point), so paying the sort
        # cost per-refresh instead of per-call matters once a real feed's
        # route lengths are in play.
        for route_stops in by_line.values():
            route_stops.sort(key=lambda route_stop: route_stop.sequence)
        self._route_stops_by_line = dict(by_line)

        self._refreshed_at = time.monotonic()

    def stops(self) -> list[StopRecord]:
        self._ensure_fresh()
        return self._stops

    def stop(self, stop_id: str) -> StopRecord | None:
        self._ensure_fresh()
        return self._stops_by_id.get(stop_id)

    def line(self, line_id: str) -> LineRecord | None:
        self._ensure_fresh()
        return self._lines_by_id.get(line_id)

    def route_stops_at_stop(self, stop_id: str) -> list[RouteStopRecord]:
        """Every line/direction/sequence combination serving this
        stop — the reverse of ListRouteStopsByLine's own "by line" index,
        built client-side from ListRouteStops' full dump since the
        domain has no "by stop" query of its own (mechanical filtering
        the domain doesn't offer is exactly what bora-api is for)."""
        self._ensure_fresh()
        return self._route_stops_by_stop.get(stop_id, [])

    def stops_on_route(self, line_id: str, direction_id: int) -> list[RouteStopRecord]:
        """A line/direction's full stop sequence, sorted — TripPlanner's
        transfer search uses this to walk forward from a boarding point
        (which later stops could I transfer at?) and backward from an
        alighting point (which earlier stops could board a bus that
        reaches here directly?)."""
        self._ensure_fresh()
        return self._route_stops_by_line.get((line_id, direction_id), [])

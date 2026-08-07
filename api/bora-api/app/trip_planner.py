"""The one piece of genuine business logic this system has: matching a
user's origin/destination to direct bus lines and estimating both walk
time and live bus ETA. This is the "trip-planner" from the architecture
debate — deliberately its own class, wrapped by main.py's endpoints,
not bolted onto the domain (which stays pure CRUD) or the gateway
(which stays a dumb proxy). Stateless: no database of its own, no
writes, ever.

v1 simplifications, made explicit rather than hidden:
- Direct lines only — no transfers. A destination with no direct line
  comes back as an empty list, not an error.
- ETA is straight-line distance from the closest same-line vehicle to
  the stop, divided by that vehicle's own current speed (floored) — not
  real map-matching against the line's actual shape. A vehicle driving
  away from the stop can misleadingly look "close." Good enough for "is
  a bus coming soon," not a promise of an exact arrival time.
- Trip duration is straight-line origin-to-destination distance divided
  by an assumed average city-bus speed, not the route's actual shape or
  GTFS scheduled times.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.geo import haversine_m

if TYPE_CHECKING:
    from app.cache import ReferenceDataCache
    from app.domain_client import DomainClient, LineRecord, StopRecord, VehiclePositionRecord


@dataclass
class NearbyStop:
    stop: StopRecord
    distance_m: float
    walk_seconds: float


@dataclass
class TripOption:
    line_id: str
    line_code: str
    line_name: str
    origin_stop_id: str
    origin_stop_name: str
    origin_latitude: float
    origin_longitude: float
    destination_stop_id: str
    destination_stop_name: str
    destination_latitude: float
    destination_longitude: float
    walk_seconds: float
    trip_seconds: float
    vehicle_id: str | None
    eta_seconds: float | None


@dataclass
class _DirectMatch:
    line_id: str
    origin: NearbyStop
    destination: NearbyStop


@dataclass
class LineVehicle:
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: float


class TripPlanner:
    def __init__(
        self,
        domain_client: DomainClient,
        cache: ReferenceDataCache,
        *,
        walking_speed_mps: float,
        min_bus_speed_kmh: float,
        average_bus_speed_kmh: float,
    ) -> None:
        self._domain_client = domain_client
        self._cache = cache
        self._walking_speed_mps = walking_speed_mps
        self._min_bus_speed_mps = min_bus_speed_kmh / 3.6
        self._average_bus_speed_mps = average_bus_speed_kmh / 3.6

    def nearby_stops(
        self, latitude: float, longitude: float, radius_m: float, limit: int
    ) -> list[NearbyStop]:
        in_range: list[NearbyStop] = []
        for stop in self._cache.stops():
            distance = haversine_m(latitude, longitude, stop.latitude, stop.longitude)
            if distance <= radius_m:
                in_range.append(
                    NearbyStop(
                        stop=stop,
                        distance_m=distance,
                        walk_seconds=distance / self._walking_speed_mps,
                    )
                )
        in_range.sort(key=lambda nearby: nearby.distance_m)
        return in_range[:limit]

    def trip_options(
        self,
        from_lat: float,
        from_lon: float,
        to_lat: float,
        to_lon: float,
        *,
        radius_m: float,
        stop_limit: int,
    ) -> list[TripOption]:
        origin_stops = self.nearby_stops(from_lat, from_lon, radius_m, stop_limit)
        dest_stops = self.nearby_stops(to_lat, to_lon, radius_m, stop_limit)
        if not origin_stops or not dest_stops:
            return []

        matches = self._best_match_per_line(self._match_direct_lines(origin_stops, dest_stops))
        if not matches:
            return []

        lines = {match.line_id: self._cache.line(match.line_id) for match in matches}
        line_codes = sorted({line.code for line in lines.values() if line is not None})
        positions_by_code = self._positions_by_line_code(line_codes)

        options: list[TripOption] = []
        for match in matches:
            line = lines[match.line_id]
            # A line matched via RouteStop but missing from the cache's
            # own Line lookup would mean a reference-data inconsistency
            # (a route-stop pointing at a line that no longer exists) —
            # skip rather than crash; not expected in practice since
            # ReplaceRouteStops/UpsertLines land together every import.
            if line is not None:
                options.append(self._build_option(match, line, positions_by_code))
        # Buses with a live ETA first (soonest first); lines with no
        # vehicle currently reporting sort last rather than being
        # dropped — a rider may still want to know "line 178 goes
        # there," just without a live countdown.
        options.sort(key=lambda option: (option.eta_seconds is None, option.eta_seconds or 0.0))
        return options

    def line_vehicles(self, line_code: str) -> list[LineVehicle]:
        """Every vehicle currently reporting on this line, for a rider
        who picked a TripOption and wants to see it moving on a map —
        the same live positions _closest_vehicle_eta already draws its
        ETA from, just returned whole instead of collapsed to one number."""
        return [
            LineVehicle(
                vehicle_id=position.id,
                latitude=position.data["latitude"],
                longitude=position.data["longitude"],
                speed_kmh=position.data.get("speed_kmh", 0.0),
            )
            for position in self._domain_client.list_vehicle_positions_by_lines([line_code])
        ]

    def _match_direct_lines(
        self, origin_stops: list[NearbyStop], dest_stops: list[NearbyStop]
    ) -> list[_DirectMatch]:
        matches: list[_DirectMatch] = []
        for origin in origin_stops:
            origin_route_stops = self._cache.route_stops_at_stop(origin.stop.id)
            for dest in dest_stops:
                dest_route_stops = self._cache.route_stops_at_stop(dest.stop.id)
                matches.extend(
                    _DirectMatch(line_id=o_rs.line_id, origin=origin, destination=dest)
                    for o_rs in origin_route_stops
                    for d_rs in dest_route_stops
                    if o_rs.line_id == d_rs.line_id
                    and o_rs.direction_id == d_rs.direction_id
                    and o_rs.sequence < d_rs.sequence
                )
        return matches

    @staticmethod
    def _best_match_per_line(matches: list[_DirectMatch]) -> list[_DirectMatch]:
        # One option per line, not one per (origin stop, destination
        # stop) pair — a rider only needs the closest boarding point for
        # each candidate line, not every combination that happens to work.
        best: dict[str, _DirectMatch] = {}
        for match in matches:
            current = best.get(match.line_id)
            if current is None or match.origin.distance_m < current.origin.distance_m:
                best[match.line_id] = match
        return list(best.values())

    def _positions_by_line_code(
        self, line_codes: list[str]
    ) -> dict[str, list[VehiclePositionRecord]]:
        by_code: dict[str, list[VehiclePositionRecord]] = defaultdict(list)
        for position in self._domain_client.list_vehicle_positions_by_lines(line_codes):
            code = position.data.get("line_code")
            if code:
                by_code[code].append(position)
        return dict(by_code)

    def _build_option(
        self,
        match: _DirectMatch,
        line: LineRecord,
        positions_by_code: dict[str, list[VehiclePositionRecord]],
    ) -> TripOption:
        vehicle_id, eta_seconds = self._closest_vehicle_eta(
            positions_by_code.get(line.code, []), match.origin.stop
        )
        trip_distance = haversine_m(
            match.origin.stop.latitude,
            match.origin.stop.longitude,
            match.destination.stop.latitude,
            match.destination.stop.longitude,
        )
        return TripOption(
            line_id=line.id,
            line_code=line.code,
            line_name=line.name,
            origin_stop_id=match.origin.stop.id,
            origin_stop_name=match.origin.stop.name,
            origin_latitude=match.origin.stop.latitude,
            origin_longitude=match.origin.stop.longitude,
            destination_stop_id=match.destination.stop.id,
            destination_stop_name=match.destination.stop.name,
            destination_latitude=match.destination.stop.latitude,
            destination_longitude=match.destination.stop.longitude,
            walk_seconds=match.origin.walk_seconds,
            trip_seconds=trip_distance / self._average_bus_speed_mps,
            vehicle_id=vehicle_id,
            eta_seconds=eta_seconds,
        )

    def _closest_vehicle_eta(
        self, positions: list[VehiclePositionRecord], stop: StopRecord
    ) -> tuple[str | None, float | None]:
        best_vehicle_id: str | None = None
        best_eta: float | None = None
        for position in positions:
            distance = haversine_m(
                stop.latitude, stop.longitude, position.data["latitude"], position.data["longitude"]
            )
            speed_mps = max(position.data.get("speed_kmh", 0.0) / 3.6, self._min_bus_speed_mps)
            eta = distance / speed_mps
            if best_eta is None or eta < best_eta:
                best_eta = eta
                best_vehicle_id = position.id
        return best_vehicle_id, best_eta

"""The one piece of genuine business logic this system has: matching a
user's origin/destination to direct bus lines and estimating both walk
time and live bus ETA. This is the "trip-planner" from the architecture
debate — deliberately its own class, wrapped by main.py's endpoints,
not bolted onto the domain (which stays pure CRUD) or the gateway
(which stays a dumb proxy). Stateless: no database of its own, no
writes, ever.

v1 simplifications, made explicit rather than hidden:
- Direct lines are tried first; if none exist, a single transfer is
  attempted (ride one line, get off at a stop a second line also
  serves, ride that to the destination) — never two transfers. A
  destination reachable only via 2+ transfers still comes back as an
  empty list, not an error.
- ETA is straight-line distance from the closest same-line vehicle to
  the stop, divided by that vehicle's own current speed (floored) — not
  real map-matching against the line's actual shape. A vehicle driving
  away from the stop can misleadingly look "close." Good enough for "is
  a bus coming soon," not a promise of an exact arrival time. For a
  transfer option this ETA is for the FIRST leg only — the rider has no
  bus to watch for the second leg until they're standing at the
  transfer stop.
- Trip duration is straight-line distance divided by an assumed average
  city-bus speed, not the route's actual shape or GTFS scheduled times.
  A transfer option sums both legs' straight-line distances plus a
  fixed buffer for stepping off one bus and waiting for the next.
- A vehicle's last known position is ignored once it's older than
  `max_position_age_seconds` — otherwise a bus whose route finished
  hours ago (confirmed live: line 2309 only runs mornings/late
  evenings, but its last position from that morning kept surfacing an
  ETA all afternoon) looks like it's still "5 minutes away" forever,
  since nothing else ever tells this system a line stopped running.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
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
    # Populated only for a transfer option — None on every direct match,
    # which is what DetailView (and this module's own callers) use to
    # tell the two apart rather than a separate boolean flag.
    transfer_stop_id: str | None = None
    transfer_stop_name: str | None = None
    transfer_latitude: float | None = None
    transfer_longitude: float | None = None
    transfer_line_id: str | None = None
    transfer_line_code: str | None = None
    transfer_line_name: str | None = None
    # First-leg-only travel time, so a caller can place "arrive at the
    # transfer stop" between "board" and "arrive at destination" — the
    # remainder of trip_seconds (minus the transfer buffer) is the
    # second leg.
    transfer_seconds: float | None = None


@dataclass
class _DirectMatch:
    line_id: str
    origin: NearbyStop
    destination: NearbyStop


@dataclass
class _DestReachable:
    """One line that rides straight through to `destination` if boarded
    at whatever stop this ends up keyed under in the dict
    _match_transfer_lines builds — the boarding stop itself is the dict
    key, not a field here, since that's how the forward search from the
    origin looks these up."""

    line_id: str
    destination: NearbyStop


@dataclass
class _TransferMatch:
    first_line_id: str
    origin: NearbyStop
    transfer_stop: StopRecord
    second_line_id: str
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
        transfer_buffer_seconds: float,
        max_position_age_seconds: float,
    ) -> None:
        self._domain_client = domain_client
        self._cache = cache
        self._walking_speed_mps = walking_speed_mps
        self._min_bus_speed_mps = min_bus_speed_kmh / 3.6
        self._average_bus_speed_mps = average_bus_speed_kmh / 3.6
        self._transfer_buffer_seconds = transfer_buffer_seconds
        self._max_position_age_seconds = max_position_age_seconds

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

        direct_matches = self._best_match_per_line(
            self._match_direct_lines(origin_stops, dest_stops)
        )
        if direct_matches:
            return self._build_direct_options(direct_matches)

        # Only searched when no direct line exists — a transfer search
        # costs more (it walks every candidate line's full stop
        # sequence, not just the origin/destination stops themselves),
        # and the common case in a dense area already has a direct
        # match, so paying that cost there would be pure waste.
        transfer_matches = self._best_transfer_per_line_pair(
            self._match_transfer_lines(origin_stops, dest_stops)
        )
        if not transfer_matches:
            return []
        return self._build_transfer_options(transfer_matches)

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
            if self._is_fresh(position)
        ]

    def _is_fresh(self, position: VehiclePositionRecord) -> bool:
        # The domain serializes captured_at as a naive datetime (no
        # offset in the wire format) that's UTC by convention — Pydantic
        # parses it straight through as naive, so comparing it against
        # datetime.now(UTC) directly raises TypeError (can't subtract
        # offset-naive and offset-aware datetimes). Confirmed live: this
        # crashed both /trip-options and /line-vehicles with a 500 the
        # moment a real (non-test-fixture) VehiclePositionRecord reached
        # this method.
        captured_at = position.captured_at
        if captured_at.tzinfo is None:
            captured_at = captured_at.replace(tzinfo=UTC)
        age = (datetime.now(UTC) - captured_at).total_seconds()
        return age <= self._max_position_age_seconds

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

    def _build_direct_options(self, matches: list[_DirectMatch]) -> list[TripOption]:
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
        self._sort_by_eta(options)
        return options

    def _match_transfer_lines(
        self, origin_stops: list[NearbyStop], dest_stops: list[NearbyStop]
    ) -> list[_TransferMatch]:
        # Expand backward from the destination first: for every line
        # that reaches a destination-adjacent stop, every earlier stop
        # on that same line/direction is somewhere a rider could board
        # to get there directly. Keyed by stop_id so the forward
        # expansion below is an O(1) lookup per candidate transfer stop
        # instead of re-scanning dest_stops for every one of them.
        dest_reachable: dict[str, list[_DestReachable]] = defaultdict(list)
        for dest in dest_stops:
            for arrival in self._cache.route_stops_at_stop(dest.stop.id):
                for boarding in self._cache.stops_on_route(arrival.line_id, arrival.direction_id):
                    if boarding.sequence < arrival.sequence:
                        dest_reachable[boarding.stop_id].append(
                            _DestReachable(line_id=arrival.line_id, destination=dest)
                        )

        matches: list[_TransferMatch] = []
        for origin in origin_stops:
            for departure in self._cache.route_stops_at_stop(origin.stop.id):
                route = self._cache.stops_on_route(departure.line_id, departure.direction_id)
                for candidate in route:
                    if candidate.sequence <= departure.sequence:
                        continue
                    reachable_from_here = dest_reachable.get(candidate.stop_id)
                    if not reachable_from_here:
                        continue
                    transfer_stop = self._cache.stop(candidate.stop_id)
                    if transfer_stop is None:
                        continue
                    matches.extend(
                        _TransferMatch(
                            first_line_id=departure.line_id,
                            origin=origin,
                            transfer_stop=transfer_stop,
                            second_line_id=reachable.line_id,
                            destination=reachable.destination,
                        )
                        for reachable in reachable_from_here
                        # Same line on both legs isn't a transfer — it's
                        # already covered (or not) by the direct search.
                        if reachable.line_id != departure.line_id
                    )
        return matches

    @staticmethod
    def _best_transfer_per_line_pair(matches: list[_TransferMatch]) -> list[_TransferMatch]:
        # One option per (first line, second line) pair, same reasoning
        # as _best_match_per_line: a rider needs the closest boarding
        # point for each viable line combination, not every transfer
        # stop where that combination happens to work.
        best: dict[tuple[str, str], _TransferMatch] = {}
        for match in matches:
            key = (match.first_line_id, match.second_line_id)
            current = best.get(key)
            if current is None or match.origin.distance_m < current.origin.distance_m:
                best[key] = match
        return list(best.values())

    def _build_transfer_options(self, matches: list[_TransferMatch]) -> list[TripOption]:
        first_lines = {
            match.first_line_id: self._cache.line(match.first_line_id) for match in matches
        }
        second_lines = {
            match.second_line_id: self._cache.line(match.second_line_id) for match in matches
        }
        first_codes = sorted({line.code for line in first_lines.values() if line is not None})
        # Only the first leg's live positions matter — see this module's
        # own docstring on why a transfer option's ETA only ever covers
        # the bus the rider boards first.
        positions_by_code = self._positions_by_line_code(first_codes)

        options: list[TripOption] = []
        for match in matches:
            first_line = first_lines[match.first_line_id]
            second_line = second_lines[match.second_line_id]
            if first_line is None or second_line is None:
                continue
            vehicle_id, eta_seconds = self._closest_vehicle_eta(
                positions_by_code.get(first_line.code, []), match.origin.stop
            )
            first_leg_seconds = (
                haversine_m(
                    match.origin.stop.latitude,
                    match.origin.stop.longitude,
                    match.transfer_stop.latitude,
                    match.transfer_stop.longitude,
                )
                / self._average_bus_speed_mps
            )
            second_leg_seconds = (
                haversine_m(
                    match.transfer_stop.latitude,
                    match.transfer_stop.longitude,
                    match.destination.stop.latitude,
                    match.destination.stop.longitude,
                )
                / self._average_bus_speed_mps
            )
            options.append(
                TripOption(
                    line_id=first_line.id,
                    line_code=first_line.code,
                    line_name=first_line.name,
                    origin_stop_id=match.origin.stop.id,
                    origin_stop_name=match.origin.stop.name,
                    origin_latitude=match.origin.stop.latitude,
                    origin_longitude=match.origin.stop.longitude,
                    destination_stop_id=match.destination.stop.id,
                    destination_stop_name=match.destination.stop.name,
                    destination_latitude=match.destination.stop.latitude,
                    destination_longitude=match.destination.stop.longitude,
                    walk_seconds=match.origin.walk_seconds,
                    trip_seconds=first_leg_seconds
                    + self._transfer_buffer_seconds
                    + second_leg_seconds,
                    vehicle_id=vehicle_id,
                    eta_seconds=eta_seconds,
                    transfer_stop_id=match.transfer_stop.id,
                    transfer_stop_name=match.transfer_stop.name,
                    transfer_latitude=match.transfer_stop.latitude,
                    transfer_longitude=match.transfer_stop.longitude,
                    transfer_line_id=second_line.id,
                    transfer_line_code=second_line.code,
                    transfer_line_name=second_line.name,
                    transfer_seconds=first_leg_seconds,
                )
            )
        self._sort_by_eta(options)
        return options

    @staticmethod
    def _sort_by_eta(options: list[TripOption]) -> None:
        # Buses with a live ETA first (soonest first); lines with no
        # vehicle currently reporting sort last rather than being
        # dropped — a rider may still want to know "line 178 goes
        # there," just without a live countdown.
        options.sort(key=lambda option: (option.eta_seconds is None, option.eta_seconds or 0.0))

    def _positions_by_line_code(
        self, line_codes: list[str]
    ) -> dict[str, list[VehiclePositionRecord]]:
        by_code: dict[str, list[VehiclePositionRecord]] = defaultdict(list)
        for position in self._domain_client.list_vehicle_positions_by_lines(line_codes):
            code = position.data.get("line_code")
            if code and self._is_fresh(position):
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

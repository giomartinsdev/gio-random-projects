from __future__ import annotations

import math
from typing import Any

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from app.domain_client import LineRecord, RouteStopRecord, StopRecord, VehiclePositionRecord
from app.trip_planner import LineVehicle, TripOption, TripPlanner

scenarios("../features/trip_planner.feature")

_EARTH_RADIUS_M = 6_371_000.0
_ORIGIN = (0.0, 0.0)
_DESTINATION = (10.0, 10.0)  # ~1500km from _ORIGIN — far past any radius used here, so
# "stops near the origin" and "stops near the destination" never mix.


def _north(base: tuple[float, float], meters: float) -> tuple[float, float]:
    """A point exactly `meters` due north of `base` — haversine_m between
    the two reproduces `meters` exactly on this spherical model, since a
    pure-latitude offset is a meridian arc (no curvature correction
    needed the way an east-west offset would)."""
    lat, lon = base
    return (lat + math.degrees(meters / _EARTH_RADIUS_M), lon)


class _FakeCache:
    def __init__(self) -> None:
        self.stops_by_id: dict[str, StopRecord] = {}
        self.lines_by_id: dict[str, LineRecord] = {}
        self.route_stops_by_stop: dict[str, list[RouteStopRecord]] = {}

    def stops(self) -> list[StopRecord]:
        return list(self.stops_by_id.values())

    def line(self, line_id: str) -> LineRecord | None:
        return self.lines_by_id.get(line_id)

    def route_stops_at_stop(self, stop_id: str) -> list[RouteStopRecord]:
        return self.route_stops_by_stop.get(stop_id, [])


class _FakeDomainClient:
    def __init__(self) -> None:
        self.positions_by_code: dict[str, list[VehiclePositionRecord]] = {}

    def list_vehicle_positions_by_lines(self, line_codes: list[str]) -> list[VehiclePositionRecord]:
        return [
            position for code in line_codes for position in self.positions_by_code.get(code, [])
        ]


@pytest.fixture()
def fake_cache() -> _FakeCache:
    return _FakeCache()


@pytest.fixture()
def fake_domain_client() -> _FakeDomainClient:
    return _FakeDomainClient()


@pytest.fixture()
def planner(fake_domain_client: _FakeDomainClient, fake_cache: _FakeCache) -> TripPlanner:
    return TripPlanner(
        fake_domain_client,  # pyright: ignore[reportArgumentType] — duck-types DomainClient's one method TripPlanner calls directly
        fake_cache,  # pyright: ignore[reportArgumentType] — duck-types ReferenceDataCache's read methods, no real caching/TTL involved
        walking_speed_mps=1.3,
        min_bus_speed_kmh=5.0,
        average_bus_speed_kmh=18.0,
    )


def _add_stop(fake_cache: _FakeCache, stop_id: str, point: tuple[float, float]) -> None:
    lat, lon = point
    fake_cache.stops_by_id[stop_id] = StopRecord(
        id=stop_id, name=stop_id, latitude=lat, longitude=lon
    )


@given("a fake domain client and cache")
def _given_fixtures(fake_domain_client: _FakeDomainClient, fake_cache: _FakeCache) -> None:
    pass


@given(
    parsers.parse(
        'stops "{s1}" {d1:d}m away, "{s2}" {d2:d}m away, and "{s3}" {d3:d}m away from the search point'
    )
)
def _given_three_stops_from_search_point(
    fake_cache: _FakeCache, s1: str, d1: int, s2: str, d2: int, s3: str, d3: int
) -> None:
    for stop_id, distance in ((s1, d1), (s2, d2), (s3, d3)):
        _add_stop(fake_cache, stop_id, _north(_ORIGIN, distance))


@given(parsers.parse('stops "{s1}" {d1:d}m away and "{s2}" {d2:d}m away from the search point'))
def _given_two_stops_from_search_point(
    fake_cache: _FakeCache, s1: str, d1: int, s2: str, d2: int
) -> None:
    for stop_id, distance in ((s1, d1), (s2, d2)):
        _add_stop(fake_cache, stop_id, _north(_ORIGIN, distance))


@given(
    parsers.parse(
        'stop "{s1}" is {d1:d}m from the origin and stop "{s2}" is {d2:d}m from the destination'
    )
)
def _given_origin_and_destination_stops(
    fake_cache: _FakeCache, s1: str, d1: int, s2: str, d2: int
) -> None:
    _add_stop(fake_cache, s1, _north(_ORIGIN, d1))
    _add_stop(fake_cache, s2, _north(_DESTINATION, d2))


@given(parsers.parse('stop "{stop_id}" is {distance:d}m from the origin'))
def _given_one_origin_stop(fake_cache: _FakeCache, stop_id: str, distance: int) -> None:
    _add_stop(fake_cache, stop_id, _north(_ORIGIN, distance))


@given("no stops are near the destination")
def _given_no_destination_stops() -> None:
    pass


@given(parsers.parse('line "{line_id}" serves "{s1}" then "{s2}" in that order'))
def _given_line_serves_two_stops(fake_cache: _FakeCache, line_id: str, s1: str, s2: str) -> None:
    if line_id not in fake_cache.lines_by_id:
        fake_cache.lines_by_id[line_id] = LineRecord(
            id=line_id, code=line_id, name=f"Line {line_id}", mode="bus"
        )
    for stop_id, sequence in ((s1, 0), (s2, 1)):
        fake_cache.route_stops_by_stop.setdefault(stop_id, []).append(
            RouteStopRecord(line_id=line_id, stop_id=stop_id, direction_id=0, sequence=sequence)
        )


@given(
    parsers.parse(
        'a vehicle on line "{line_id}" is {distance:d}m from "{stop_id}" traveling at {speed:d} km/h'
    )
)
def _given_vehicle_near_stop(
    fake_cache: _FakeCache,
    fake_domain_client: _FakeDomainClient,
    line_id: str,
    distance: int,
    stop_id: str,
    speed: int,
) -> None:
    stop = fake_cache.stops_by_id[stop_id]
    lat, lon = _north((stop.latitude, stop.longitude), distance)
    position = VehiclePositionRecord(
        id="B1",
        data={
            "mode": "sppo",
            "line_code": line_id,
            "vehicle_id": "B1",
            "latitude": lat,
            "longitude": lon,
            "speed_kmh": speed,
            "captured_at": "2026-08-06T13:00:00Z",
            "color_hex": None,
        },
        captured_at="2026-08-06T13:00:00Z",  # pyright: ignore[reportArgumentType] — Pydantic parses the ISO string into a datetime at validation time
    )
    fake_domain_client.positions_by_code.setdefault(line_id, []).append(position)


@given(
    parsers.parse(
        'another vehicle on line "{line_id}" is {distance:d}m from "{stop_id}" traveling at {speed:d} km/h'
    )
)
def _given_another_vehicle_near_stop(
    fake_cache: _FakeCache,
    fake_domain_client: _FakeDomainClient,
    line_id: str,
    distance: int,
    stop_id: str,
    speed: int,
) -> None:
    stop = fake_cache.stops_by_id[stop_id]
    lat, lon = _north((stop.latitude, stop.longitude), distance)
    position = VehiclePositionRecord(
        id="B2",
        data={
            "mode": "sppo",
            "line_code": line_id,
            "vehicle_id": "B2",
            "latitude": lat,
            "longitude": lon,
            "speed_kmh": speed,
            "captured_at": "2026-08-06T13:00:00Z",
            "color_hex": None,
        },
        captured_at="2026-08-06T13:00:00Z",  # pyright: ignore[reportArgumentType] — Pydantic parses the ISO string into a datetime at validation time
    )
    fake_domain_client.positions_by_code.setdefault(line_id, []).append(position)


@when(
    parsers.parse("nearby stops are searched with radius {radius:d}m and limit {limit:d}"),
    target_fixture="nearby_result",
)
def _when_nearby_stops_searched(planner: TripPlanner, radius: int, limit: int) -> Any:
    return planner.nearby_stops(*_ORIGIN, radius, limit)


@when("trip options are searched from the origin to the destination", target_fixture="trip_result")
def _when_trip_options_searched(planner: TripPlanner) -> list[TripOption]:
    return planner.trip_options(*_ORIGIN, *_DESTINATION, radius_m=5000.0, stop_limit=10)


@when(
    parsers.parse('line vehicles are searched for line "{line_id}"'),
    target_fixture="vehicle_result",
)
def _when_line_vehicles_searched(planner: TripPlanner, line_id: str) -> list[LineVehicle]:
    return planner.line_vehicles(line_id)


@then(parsers.parse('the nearby stops are "{s1}" then "{s2}"'))
def _then_nearby_two(nearby_result: Any, s1: str, s2: str) -> None:
    assert [nearby.stop.id for nearby in nearby_result] == [s1, s2]


@then(parsers.parse('the nearby stops are "{s1}"'))
def _then_nearby_one(nearby_result: Any, s1: str) -> None:
    assert [nearby.stop.id for nearby in nearby_result] == [s1]


@then(parsers.parse('a trip option for line "{line_id}" comes back'))
def _then_option_exists(trip_result: list[TripOption], line_id: str) -> None:
    assert any(option.line_id == line_id for option in trip_result)


@then(parsers.parse('its origin stop is "{origin_id}" and destination stop is "{dest_id}"'))
def _then_origin_and_destination(
    trip_result: list[TripOption], origin_id: str, dest_id: str
) -> None:
    option = trip_result[0]
    assert option.origin_stop_id == origin_id
    assert option.destination_stop_id == dest_id


@then("no trip options come back")
def _then_no_options(trip_result: list[TripOption]) -> None:
    assert trip_result == []


@then(parsers.parse('the line "{line_id}" option has an eta of about {seconds:d} seconds'))
def _then_eta_about(trip_result: list[TripOption], line_id: str, seconds: int) -> None:
    option = next(o for o in trip_result if o.line_id == line_id)
    assert option.eta_seconds is not None
    assert abs(option.eta_seconds - seconds) <= 5


@then(parsers.parse('the line "{line_id}" option has no eta'))
def _then_no_eta(trip_result: list[TripOption], line_id: str) -> None:
    option = next(o for o in trip_result if o.line_id == line_id)
    assert option.eta_seconds is None


@then(parsers.parse('exactly {count:d} trip option for line "{line_id}" comes back'))
def _then_exactly_n_options(trip_result: list[TripOption], count: int, line_id: str) -> None:
    matching = [o for o in trip_result if o.line_id == line_id]
    assert len(matching) == count


@then(parsers.parse('its origin stop is "{origin_id}"'))
def _then_origin_only(trip_result: list[TripOption], origin_id: str) -> None:
    option = trip_result[0]
    assert option.origin_stop_id == origin_id


@then(parsers.parse("{count:d} line vehicles come back"))
def _then_line_vehicle_count(vehicle_result: list[LineVehicle], count: int) -> None:
    assert len(vehicle_result) == count

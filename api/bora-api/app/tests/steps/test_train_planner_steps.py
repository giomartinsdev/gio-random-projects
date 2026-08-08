from __future__ import annotations

import math
from typing import TYPE_CHECKING

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from app.train_planner import TrainPlanner, TrainTrip
from app.train_stations import TrainStation
from app.trensrj_client import TrainPlanLeg, TrainPlanOption

if TYPE_CHECKING:
    from datetime import date

scenarios("../features/train_planner.feature")

_EARTH_RADIUS_M = 6_371_000.0
_ORIGIN = (0.0, 0.0)
_DESTINATION = (10.0, 10.0)  # ~1500km from _ORIGIN, same convention as trip_planner's own tests


def _north(base: tuple[float, float], meters: float) -> tuple[float, float]:
    lat, lon = base
    return (lat + math.degrees(meters / _EARTH_RADIUS_M), lon)


class _FakeTrensRjClient:
    def __init__(self) -> None:
        self.options_by_pair: dict[tuple[str, str], list[TrainPlanOption]] = {}
        self.last_call: tuple[str, str, date, str] | None = None

    def plan_trip(
        self, origin_id: str, destination_id: str, on_date: date, time: str
    ) -> list[TrainPlanOption]:
        self.last_call = (origin_id, destination_id, on_date, time)
        return self.options_by_pair.get((origin_id, destination_id), [])


@pytest.fixture()
def fake_client() -> _FakeTrensRjClient:
    return _FakeTrensRjClient()


@pytest.fixture()
def stations() -> list[TrainStation]:
    return []


@pytest.fixture()
def planner(fake_client: _FakeTrensRjClient, stations: list[TrainStation]) -> TrainPlanner:
    return TrainPlanner(
        fake_client,  # pyright: ignore[reportArgumentType] — duck-types TrensRjClient's one method TrainPlanner calls
        stations,
        walking_speed_mps=1.3,
        max_station_distance_m=2000.0,
    )


@given("a fake trensrj client and station list")
def _given_fixtures(fake_client: _FakeTrensRjClient, stations: list[TrainStation]) -> None:
    pass


@given(parsers.parse('station "{slug}" "{name}" is {distance:d}m from the origin'))
def _given_station_near_origin(
    stations: list[TrainStation], slug: str, name: str, distance: int
) -> None:
    lat, lon = _north(_ORIGIN, distance)
    stations.append(TrainStation(id=slug, name=name, slug=slug, latitude=lat, longitude=lon))


@given(parsers.parse('station "{slug}" "{name}" is {distance:d}m from the destination'))
def _given_station_near_destination(
    stations: list[TrainStation], slug: str, name: str, distance: int
) -> None:
    lat, lon = _north(_DESTINATION, distance)
    stations.append(TrainStation(id=slug, name=name, slug=slug, latitude=lat, longitude=lon))


@given(
    parsers.parse('trensrj returns {count:d} trip option between "{origin_slug}" and "{dest_slug}"')
)
def _given_trensrj_returns_options(
    fake_client: _FakeTrensRjClient, origin_slug: str, dest_slug: str, count: int
) -> None:
    option = TrainPlanOption(
        legs=[
            TrainPlanLeg(
                line_name="Ramal Teste",
                line_short_name="Teste",
                line_color="000000",
                from_station_name="A",
                to_station_name="B",
                departure_time="08:00",
                arrival_time="09:00",
                stops_count=5,
            )
        ],
        departure_time="08:00",
        arrival_time="09:00",
        total_duration_min=60,
        is_last_trip_of_day=False,
        warnings=[],
    )
    fake_client.options_by_pair[(origin_slug, dest_slug)] = [option for _ in range(count)]


@when("train options are searched from the origin to the destination", target_fixture="trip_result")
def _when_train_options_searched(planner: TrainPlanner) -> TrainTrip | None:
    return planner.trip_options(*_ORIGIN, *_DESTINATION)


@then("a train trip is found")
def _then_trip_found(trip_result: TrainTrip | None) -> None:
    assert trip_result is not None


@then("no train trip is found")
def _then_no_trip_found(trip_result: TrainTrip | None) -> None:
    assert trip_result is None


@then(
    parsers.parse('its origin station is "{origin_name}" and destination station is "{dest_name}"')
)
def _then_stations_match(trip_result: TrainTrip | None, origin_name: str, dest_name: str) -> None:
    assert trip_result is not None
    assert trip_result.origin.station.name == origin_name
    assert trip_result.destination.station.name == dest_name


@then(parsers.parse("{count:d} train option comes back"))
def _then_option_count(trip_result: TrainTrip | None, count: int) -> None:
    assert trip_result is not None
    assert len(trip_result.options) == count

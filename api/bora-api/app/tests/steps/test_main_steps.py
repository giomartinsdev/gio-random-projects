# httpx's TestClient.get()/.json() surfaces Unknown/Any through its own
# stubs regardless of caller code (same gap api/domain's step files
# document identically) — these steps assert against raw wire-level
# JSON responses, exactly the case where that's unavoidable.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when

from app.domain_client import StopRecord
from app.geocoding import GeocodeResult
from app.main import create_app, get_geocoder, get_train_planner, get_trip_planner
from app.train_planner import NearbyTrainStation, TrainTrip
from app.train_stations import TrainStation
from app.trensrj_client import TrainPlanLeg, TrainPlanOption
from app.trip_planner import LineVehicle, NearbyStop, TripOption

scenarios("../features/main.feature")


@pytest.fixture()
def fake_planner() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def fake_geocoder() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def fake_train_planner() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def client(
    fake_planner: MagicMock, fake_geocoder: MagicMock, fake_train_planner: MagicMock
) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_trip_planner] = lambda: fake_planner
    app.dependency_overrides[get_geocoder] = lambda: fake_geocoder
    app.dependency_overrides[get_train_planner] = lambda: fake_train_planner
    return TestClient(app)


@given("a bora-api test client with fake dependencies")
def _given_client(client: TestClient) -> TestClient:
    return client


@given(parsers.parse("the fake planner returns {count:d} nearby stop"))
def _given_planner_returns_nearby(fake_planner: MagicMock, count: int) -> None:
    stop = StopRecord(id="S1", name="Stop 1", latitude=-22.9, longitude=-43.2)
    fake_planner.nearby_stops.return_value = [
        NearbyStop(stop=stop, distance_m=100.0, walk_seconds=80.0) for _ in range(count)
    ]


@given(parsers.parse("the fake planner returns {count:d} trip option"))
def _given_planner_returns_trip_options(fake_planner: MagicMock, count: int) -> None:
    fake_planner.trip_options.return_value = [
        TripOption(
            line_id="L1",
            line_code="178",
            line_name="Linha 178",
            origin_stop_id="S1",
            origin_stop_name="Stop 1",
            origin_latitude=-22.9,
            origin_longitude=-43.2,
            destination_stop_id="S2",
            destination_stop_name="Stop 2",
            destination_latitude=-22.8,
            destination_longitude=-43.1,
            walk_seconds=80.0,
            trip_seconds=600.0,
            vehicle_id="B1",
            eta_seconds=120.0,
        )
        for _ in range(count)
    ]


@given(parsers.parse("the fake geocoder returns {count:d} result"))
def _given_geocoder_returns(fake_geocoder: MagicMock) -> None:
    fake_geocoder.search.return_value = [
        GeocodeResult(name="Copacabana, Rio de Janeiro", latitude=-22.9, longitude=-43.2)
    ]


@given(parsers.parse("the fake planner returns {count:d} line vehicle"))
def _given_planner_returns_line_vehicles(fake_planner: MagicMock, count: int) -> None:
    fake_planner.line_vehicles.return_value = [
        LineVehicle(vehicle_id="B1", latitude=-22.9, longitude=-43.2, speed_kmh=20.0)
        for _ in range(count)
    ]


@given("the fake train planner finds a trip")
def _given_train_planner_finds_trip(fake_train_planner: MagicMock) -> None:
    origin_station = TrainStation(
        id="central",
        name="Central do Brasil",
        slug="central-do-brasil",
        latitude=-22.9,
        longitude=-43.2,
    )
    destination_station = TrainStation(
        id="belford-roxo", name="Belford Roxo", slug="belford-roxo", latitude=-22.7, longitude=-43.4
    )
    fake_train_planner.trip_options.return_value = TrainTrip(
        origin=NearbyTrainStation(station=origin_station, distance_m=300.0, walk_seconds=230.0),
        destination=NearbyTrainStation(
            station=destination_station, distance_m=400.0, walk_seconds=310.0
        ),
        options=[
            TrainPlanOption(
                legs=[
                    TrainPlanLeg(
                        line_name="Ramal Belford Roxo",
                        line_short_name="Belford Roxo",
                        line_color="6B3FA0",
                        from_station_name="Central do Brasil",
                        to_station_name="Belford Roxo",
                        departure_time="08:54",
                        arrival_time="09:54",
                        stops_count=17,
                    )
                ],
                departure_time="08:54",
                arrival_time="09:54",
                total_duration_min=60,
                is_last_trip_of_day=False,
                warnings=[],
            )
        ],
    )


@given("the fake train planner finds no trip")
def _given_train_planner_finds_no_trip(fake_train_planner: MagicMock) -> None:
    fake_train_planner.trip_options.return_value = None


@when("GET /health is requested", target_fixture="response")
def _when_health_requested(client: TestClient) -> Any:
    return client.get("/health")


@when(
    parsers.parse("GET /nearby-stops is requested with lat {lat:g} and lon {lon:g}"),
    target_fixture="response",
)
def _when_nearby_stops_requested(client: TestClient, lat: float, lon: float) -> Any:
    return client.get("/nearby-stops", params={"lat": lat, "lon": lon})


@when("GET /nearby-stops is requested with no parameters", target_fixture="response")
def _when_nearby_stops_requested_no_params(client: TestClient) -> Any:
    return client.get("/nearby-stops")


@when(
    parsers.parse(
        "GET /trip-options is requested from {from_lat:g},{from_lon:g} to {to_lat:g},{to_lon:g}"
    ),
    target_fixture="response",
)
def _when_trip_options_requested(
    client: TestClient, from_lat: float, from_lon: float, to_lat: float, to_lon: float
) -> Any:
    return client.get(
        "/trip-options",
        params={"from_lat": from_lat, "from_lon": from_lon, "to_lat": to_lat, "to_lon": to_lon},
    )


@when(parsers.parse('GET /geocode is requested with q "{query}"'), target_fixture="response")
def _when_geocode_requested(client: TestClient, query: str) -> Any:
    return client.get("/geocode", params={"q": query})


@when(
    parsers.parse('GET /line-vehicles is requested with line_code "{line_code}"'),
    target_fixture="response",
)
def _when_line_vehicles_requested(client: TestClient, line_code: str) -> Any:
    return client.get("/line-vehicles", params={"line_code": line_code})


@when(
    parsers.parse(
        "GET /train-options is requested from {from_lat:g},{from_lon:g} to {to_lat:g},{to_lon:g}"
    ),
    target_fixture="response",
)
def _when_train_options_requested(
    client: TestClient, from_lat: float, from_lon: float, to_lat: float, to_lon: float
) -> Any:
    return client.get(
        "/train-options",
        params={"from_lat": from_lat, "from_lon": from_lon, "to_lat": to_lat, "to_lon": to_lon},
    )


@then(parsers.parse("the response status is {status:d}"))
def _then_response_status(response: Any, status: int) -> None:
    assert response.status_code == status


@then('the response body is {"status": "ok"}')
def _then_response_body_ok(response: Any) -> None:
    assert response.json() == {"status": "ok"}


@then("the response body is null")
def _then_response_body_null(response: Any) -> None:
    assert response.json() is None


@then(parsers.parse("the response has {count:d} nearby stop"))
def _then_response_nearby_count(response: Any, count: int) -> None:
    assert len(response.json()) == count


@then(parsers.parse("the response has {count:d} trip option"))
def _then_response_trip_option_count(response: Any, count: int) -> None:
    assert len(response.json()) == count


@then(parsers.parse("the response has {count:d} geocode result"))
def _then_response_geocode_count(response: Any, count: int) -> None:
    assert len(response.json()) == count


@then(parsers.parse("the response has {count:d} line vehicle"))
def _then_response_line_vehicle_count(response: Any, count: int) -> None:
    assert len(response.json()) == count


@then(parsers.parse("the response has {count:d} train option"))
def _then_response_train_option_count(response: Any, count: int) -> None:
    assert len(response.json()["options"]) == count

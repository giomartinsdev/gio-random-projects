from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.gtfs_importer.etl.transform import GtfsTransformer

if TYPE_CHECKING:
    from flows.gtfs_importer.schemas import GtfsCapture

scenarios("../features/transform.feature")


@pytest.fixture()
def tables() -> dict[str, list[dict[str, str]]]:
    return {"stops": [], "routes": [], "trips": [], "stop_times": []}


@given("1 stop row and 1 regular bus route row")
def _given_stop_and_bus_route(tables: dict[str, list[dict[str, str]]]) -> None:
    tables["stops"].append(
        {"stop_id": "S1", "stop_name": "Rua A", "stop_lat": "-22.9", "stop_lon": "-43.2"}
    )
    tables["routes"].append(
        {"route_id": "178", "route_short_name": "178", "route_long_name": "Linha 178"}
    )


@given(parsers.parse('1 route row with id "{route_id}"'))
def _given_route_with_id(tables: dict[str, list[dict[str, str]]], route_id: str) -> None:
    tables["routes"].append(
        {"route_id": route_id, "route_short_name": route_id, "route_long_name": route_id}
    )


@given(parsers.parse('1 stop row missing "{field}"'))
def _given_malformed_stop(tables: dict[str, list[dict[str, str]]], field: str) -> None:
    row = {"stop_id": "BAD", "stop_name": "Bad Stop", "stop_lat": "-22.9", "stop_lon": "-43.2"}
    del row[field]
    tables["stops"].append(row)


@given("1 well-formed stop row")
def _given_well_formed_stop(tables: dict[str, list[dict[str, str]]]) -> None:
    tables["stops"].append(
        {"stop_id": "S1", "stop_name": "Rua A", "stop_lat": "-22.9", "stop_lon": "-43.2"}
    )


@given(parsers.parse('route "{line_id}" has trip "{trip_id}" with {count:d} stops'))
def _given_trip_with_stops(
    tables: dict[str, list[dict[str, str]]], line_id: str, trip_id: str, count: int
) -> None:
    tables["trips"].append({"trip_id": trip_id, "route_id": line_id, "direction_id": "0"})
    prefix = "L" if trip_id == "long" else "S"
    tables["stop_times"].extend(
        {"trip_id": trip_id, "stop_id": f"{prefix}{i}", "stop_sequence": str(i)}
        for i in range(count)
    )


@when("the raw tables are transformed", target_fixture="capture")
def _when_transformed(tables: dict[str, list[dict[str, str]]]) -> GtfsCapture:
    return GtfsTransformer().transform(tables)


@then(parsers.parse("{stop_count:d} stop capture and {line_count:d} line capture come back"))
def _then_capture_counts(capture: GtfsCapture, stop_count: int, line_count: int) -> None:
    assert len(capture.stops) == stop_count
    assert len(capture.lines) == line_count


@then(parsers.parse("{count:d} stop capture comes back"))
def _then_stop_count(capture: GtfsCapture, count: int) -> None:
    assert len(capture.stops) == count


@then(parsers.parse('the line\'s mode is "{mode}"'))
def _then_line_mode(capture: GtfsCapture, mode: str) -> None:
    assert capture.lines[0].mode == mode


@then(
    parsers.parse(
        'line "{line_id}"\'s route-stops come from the "{trip_id}" trip\'s '
        "{count:d} stops in sequence order"
    )
)
def _then_route_stops_from_longest_trip(
    capture: GtfsCapture, line_id: str, trip_id: str, count: int
) -> None:
    route_stops = [rs for rs in capture.route_stops if rs.line_id == line_id]
    assert len(route_stops) == count
    prefix = "L" if trip_id == "long" else "S"
    assert [rs.stop_id for rs in route_stops] == [f"{prefix}{i}" for i in range(count)]
    assert [rs.sequence for rs in route_stops] == list(range(count))

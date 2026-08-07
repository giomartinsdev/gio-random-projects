from __future__ import annotations

import csv
import io
import zipfile
from typing import TYPE_CHECKING

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.gtfs_importer.etl.extract import GtfsExtractor

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/extract.feature")


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _build_zip(
    *,
    stops: list[dict[str, str]],
    routes: list[dict[str, str]],
    trips: list[dict[str, str]],
    stop_times: list[dict[str, str]],
    bom_on_stops: bool = False,
) -> bytes:
    def _csv_bytes(rows: list[dict[str, str]]) -> bytes:
        if not rows:
            return b""
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
        return buffer.getvalue().encode("utf-8")

    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w") as archive:
        stops_bytes = _csv_bytes(stops)
        if bom_on_stops:
            stops_bytes = b"\xef\xbb\xbf" + stops_bytes
        archive.writestr("stops.txt", stops_bytes)
        archive.writestr("routes.txt", _csv_bytes(routes))
        archive.writestr("trips.txt", _csv_bytes(trips))
        archive.writestr("stop_times.txt", _csv_bytes(stop_times))
    return archive_buffer.getvalue()


@pytest.fixture()
def zip_bytes() -> bytes:
    return _build_zip(
        stops=[{"stop_id": "S1", "stop_name": "Rua A", "stop_lat": "-22.9", "stop_lon": "-43.2"}],
        routes=[{"route_id": "178", "route_short_name": "178", "route_long_name": "Linha 178"}],
        trips=[{"trip_id": "T1", "route_id": "178", "direction_id": "0"}],
        stop_times=[{"trip_id": "T1", "stop_id": "S1", "stop_sequence": "1"}],
    )


@given("a fake GTFS feed endpoint")
def _given_fake_endpoint() -> None:
    pass


@given(
    parsers.parse(
        "the feed zip contains {stops:d} stops, {routes:d} route, "
        "{trips:d} trip, and {stop_times:d} stop_times rows"
    ),
    target_fixture="zip_bytes",
)
def _given_zip_contents(stops: int, routes: int, trips: int, stop_times: int) -> bytes:
    return _build_zip(
        stops=[
            {"stop_id": f"S{i}", "stop_name": f"Stop {i}", "stop_lat": "-22.9", "stop_lon": "-43.2"}
            for i in range(stops)
        ],
        routes=[
            {"route_id": f"R{i}", "route_short_name": f"R{i}", "route_long_name": f"Route {i}"}
            for i in range(routes)
        ],
        trips=[{"trip_id": f"T{i}", "route_id": "R0", "direction_id": "0"} for i in range(trips)],
        stop_times=[
            {"trip_id": "T0", "stop_id": "S0", "stop_sequence": str(i)} for i in range(stop_times)
        ],
    )


@given("the feed zip's stops.txt starts with a UTF-8 BOM", target_fixture="zip_bytes")
def _given_bom_stops() -> bytes:
    return _build_zip(
        stops=[{"stop_id": "S1", "stop_name": "Rua A", "stop_lat": "-22.9", "stop_lon": "-43.2"}],
        routes=[],
        trips=[],
        stop_times=[],
        bom_on_stops=True,
    )


@when("the GTFS feed is extracted", target_fixture="result")
def _when_extracted(zip_bytes: bytes) -> dict[str, list[dict[str, str]]]:
    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(200, content=zip_bytes)

    return GtfsExtractor(client=_fake_client(handler)).extract()


@then(
    parsers.parse(
        "the parsed tables have {stops:d} stops, {routes:d} route, "
        "{trips:d} trip, and {stop_times:d} stop_times rows"
    )
)
def _then_table_sizes(
    result: dict[str, list[dict[str, str]]], stops: int, routes: int, trips: int, stop_times: int
) -> None:
    assert len(result["stops"]) == stops
    assert len(result["routes"]) == routes
    assert len(result["trips"]) == trips
    assert len(result["stop_times"]) == stop_times


@then("the first stop's stop_id column is read correctly")
def _then_bom_column_correct(result: dict[str, list[dict[str, str]]]) -> None:
    assert result["stops"][0]["stop_id"] == "S1"

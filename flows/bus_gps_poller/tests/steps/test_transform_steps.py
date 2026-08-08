from __future__ import annotations

from typing import Any

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.bus_gps_poller.etl.transform import BusPositionTransformer

scenarios("../features/transform.feature")


@pytest.fixture()
def rows() -> list[dict[str, Any]]:
    return []


@given(parsers.parse('a well-formed SPPO row for vehicle "{vehicle_id}" on line "{line}"'))
def _given_well_formed_row(rows: list[dict[str, Any]], vehicle_id: str, line: str) -> None:
    rows.append(
        {
            "id_veiculo": vehicle_id,
            "servico": line,
            "latitude": -22.90434,
            "longitude": -43.2863,
            "velocidade": 0.0,
            "datetime": "2026-08-08T15:06:09Z",
        }
    )


@given(
    parsers.parse(
        'a well-formed SPPO row for vehicle "{vehicle_id}" on line "{line}" with no velocidade'
    )
)
def _given_row_without_velocidade(rows: list[dict[str, Any]], vehicle_id: str, line: str) -> None:
    rows.append(
        {
            "id_veiculo": vehicle_id,
            "servico": line,
            "latitude": -22.9,
            "longitude": -43.2,
            "datetime": "2026-08-08T15:06:09Z",
        }
    )


@given(parsers.parse('a malformed SPPO row missing "{field}"'))
def _given_malformed_row(rows: list[dict[str, Any]], field: str) -> None:
    row = {
        "id_veiculo": "999",
        "servico": "606",
        "latitude": -22.9,
        "longitude": -43.2,
        "velocidade": 10.0,
        "datetime": "2026-08-08T15:06:09Z",
    }
    del row[field]
    rows.append(row)


@when("the rows are transformed", target_fixture="captures")
def _when_transformed(rows: list[dict[str, Any]]) -> list[Any]:
    return BusPositionTransformer().transform(rows)


@then(parsers.parse("{count:d} capture comes back"))
@then(parsers.parse("{count:d} captures come back"))
def _then_capture_count(captures: list[Any], count: int) -> None:
    assert len(captures) == count


@then(parsers.parse('capture {index:d} has mode "{mode}", line "{line}", vehicle "{vehicle_id}"'))
def _then_capture_fields(
    captures: list[Any], index: int, mode: str, line: str, vehicle_id: str
) -> None:
    capture = captures[index]
    assert capture.mode == mode
    assert capture.line_code == line
    assert capture.vehicle_id == vehicle_id


@then(parsers.parse('capture {index:d} has vehicle "{vehicle_id}"'))
def _then_capture_vehicle(captures: list[Any], index: int, vehicle_id: str) -> None:
    assert captures[index].vehicle_id == vehicle_id


@then(parsers.parse("capture {index:d}'s latitude is {latitude:g}"))
def _then_capture_latitude(captures: list[Any], index: int, latitude: float) -> None:
    assert captures[index].latitude == latitude


@then(parsers.parse("capture {index:d}'s speed_kmh is {speed:g}"))
def _then_capture_speed(captures: list[Any], index: int, speed: float) -> None:
    assert captures[index].speed_kmh == speed

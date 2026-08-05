from __future__ import annotations

from datetime import UTC, datetime

from flows.bus_gps_poller.etl.transform import BusPositionTransformer


def test_transform_parses_a_well_formed_row() -> None:
    # Given one well-formed raw SPPO row (comma decimals, epoch-ms datahora)
    row = {
        "ordem": "B25611",
        "linha": "606",
        "latitude": "-22,90434",
        "longitude": "-43,2863",
        "velocidade": "0",
        "datahora": "1785121192000",
    }

    # When transforming
    result = BusPositionTransformer().transform([row])

    # Then it parses into a typed capture with dot decimals and a real datetime
    assert len(result) == 1
    capture = result[0]
    assert capture.mode == "sppo"
    assert capture.line_code == "606"
    assert capture.vehicle_id == "B25611"
    assert capture.latitude == -22.90434
    assert capture.longitude == -43.2863
    assert capture.speed_kmh == 0.0
    assert capture.captured_at == datetime.fromtimestamp(1785121192, tz=UTC)


def test_transform_skips_a_malformed_row_without_failing_the_batch() -> None:
    # Given one well-formed row and one missing its required "ordem" field
    good_row = {
        "ordem": "B1",
        "linha": "606",
        "latitude": "-22,9",
        "longitude": "-43,2",
        "velocidade": "10",
        "datahora": "1785121192000",
    }
    bad_row = {"linha": "606", "latitude": "-22,9", "longitude": "-43,2", "datahora": "x"}

    # When transforming both together
    result = BusPositionTransformer().transform([good_row, bad_row])

    # Then only the well-formed row survives
    assert len(result) == 1
    assert result[0].vehicle_id == "B1"


def test_transform_defaults_missing_velocidade_to_zero() -> None:
    # Given a row with no "velocidade" field at all
    row = {
        "ordem": "B1",
        "linha": "606",
        "latitude": "-22,9",
        "longitude": "-43,2",
        "datahora": "1785121192000",
    }

    # When transforming
    result = BusPositionTransformer().transform([row])

    # Then speed defaults to 0.0 rather than raising
    assert result[0].speed_kmh == 0.0

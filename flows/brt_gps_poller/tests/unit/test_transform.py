from __future__ import annotations

from datetime import UTC, datetime

from flows.brt_gps_poller.etl.transform import BrtPositionTransformer


def test_transform_parses_a_well_formed_row() -> None:
    # Given one well-formed raw BRT row (numeric lat/lon/velocidade, "codigo")
    row = {
        "codigo": "901008",
        "linha": "35",
        "latitude": -22.964872,
        "longitude": -43.390969,
        "velocidade": 12.5,
        "dataHora": "1785974352000",
    }

    # When transforming
    result = BrtPositionTransformer().transform([row])

    # Then it parses into a typed capture
    assert len(result) == 1
    capture = result[0]
    assert capture.mode == "brt"
    assert capture.line_code == "35"
    assert capture.vehicle_id == "901008"
    assert capture.latitude == -22.964872
    assert capture.longitude == -43.390969
    assert capture.speed_kmh == 12.5
    assert capture.captured_at == datetime.fromtimestamp(1785974352, tz=UTC)


def test_transform_skips_a_malformed_row_without_failing_the_batch() -> None:
    # Given one well-formed row and one missing its required "codigo" field
    good_row = {
        "codigo": "901008",
        "linha": "35",
        "latitude": -22.9,
        "longitude": -43.3,
        "velocidade": 10,
        "dataHora": "1785974352000",
    }
    bad_row = {"linha": "35", "latitude": -22.9, "longitude": -43.3, "dataHora": "x"}

    # When transforming both together
    result = BrtPositionTransformer().transform([good_row, bad_row])

    # Then only the well-formed row survives
    assert len(result) == 1
    assert result[0].vehicle_id == "901008"


def test_transform_defaults_missing_velocidade_to_zero() -> None:
    # Given a row with no "velocidade" field at all
    row = {
        "codigo": "901008",
        "linha": "35",
        "latitude": -22.9,
        "longitude": -43.3,
        "dataHora": "1785974352000",
    }

    # When transforming
    result = BrtPositionTransformer().transform([row])

    # Then speed defaults to 0.0 rather than raising
    assert result[0].speed_kmh == 0.0

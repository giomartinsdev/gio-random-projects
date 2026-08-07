from __future__ import annotations

from pytest_bdd import given, parsers, scenarios, then, when

from app.geo import haversine_m

scenarios("../features/geo.feature")


@given(parsers.parse("the point {lat:g},{lon:g}"), target_fixture="point_a")
def _given_point(lat: float, lon: float) -> tuple[float, float]:
    return (lat, lon)


@given(parsers.parse("Copacabana Beach at {lat:g},{lon:g}"), target_fixture="point_a")
def _given_copacabana(lat: float, lon: float) -> tuple[float, float]:
    return (lat, lon)


@given(parsers.parse("Christ the Redeemer at {lat:g},{lon:g}"), target_fixture="point_b")
def _given_christ(lat: float, lon: float) -> tuple[float, float]:
    return (lat, lon)


@when("the distance to itself is computed", target_fixture="distance")
def _when_distance_to_self(point_a: tuple[float, float]) -> float:
    lat, lon = point_a
    return haversine_m(lat, lon, lat, lon)


@when("the distance between them is computed", target_fixture="distance")
def _when_distance_between(point_a: tuple[float, float], point_b: tuple[float, float]) -> float:
    return haversine_m(*point_a, *point_b)


@then(parsers.parse("the distance is {meters:d} meters"))
def _then_distance_is(distance: float, meters: int) -> None:
    assert distance == meters


@then(parsers.parse("the distance is within {tolerance:d} meters of {expected:d} meters"))
def _then_distance_within(distance: float, tolerance: int, expected: int) -> None:
    assert abs(distance - expected) <= tolerance

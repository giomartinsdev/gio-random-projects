from __future__ import annotations

from typing import Any

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from app import cache as cache_module
from app.cache import ReferenceDataCache
from app.domain_client import LineRecord, RouteStopRecord, StopRecord

scenarios("../features/cache.feature")


class _FakeDomainClient:
    def __init__(self) -> None:
        self.stops: list[StopRecord] = []
        self.lines: list[LineRecord] = []
        self.route_stops: list[RouteStopRecord] = []
        self.call_count = 0

    def list_stops(self) -> list[StopRecord]:
        self.call_count += 1
        return self.stops

    def list_lines(self) -> list[LineRecord]:
        return self.lines

    def list_route_stops(self) -> list[RouteStopRecord]:
        return self.route_stops


@pytest.fixture()
def fake_clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [0.0]
    monkeypatch.setattr(cache_module.time, "monotonic", lambda: now[0])
    return now


@pytest.fixture()
def fake_domain_client() -> _FakeDomainClient:
    return _FakeDomainClient()


@pytest.fixture()
def reference_cache(fake_domain_client: _FakeDomainClient) -> ReferenceDataCache:
    return ReferenceDataCache(fake_domain_client, ttl_seconds=100.0)  # pyright: ignore[reportArgumentType] — _FakeDomainClient duck-types DomainClient's read methods, no real HTTP involved


@given("a fake domain client")
def _given_fake_domain_client(fake_clock: list[float]) -> None:
    pass


@given(parsers.parse("the domain has {count:d} stops"))
def _given_domain_has_stops(fake_domain_client: _FakeDomainClient, count: int) -> None:
    fake_domain_client.stops = [
        StopRecord(id=f"S{i}", name=f"Stop {i}", latitude=-22.9, longitude=-43.2)
        for i in range(count)
    ]


@given(parsers.parse('the domain has route-stops "{s1}" and "{s2}" for line "{line_id}"'))
def _given_domain_has_route_stops(
    fake_domain_client: _FakeDomainClient, s1: str, s2: str, line_id: str
) -> None:
    fake_domain_client.route_stops = [
        RouteStopRecord(line_id=line_id, stop_id=s1, direction_id=0, sequence=0),
        RouteStopRecord(line_id=line_id, stop_id=s2, direction_id=0, sequence=1),
    ]


@given(parsers.parse('the domain has {count:d} line with id "{line_id}"'))
def _given_domain_has_line(fake_domain_client: _FakeDomainClient, count: int, line_id: str) -> None:
    fake_domain_client.lines = [
        LineRecord(id=line_id, code=line_id, name=f"Line {line_id}", mode="bus")
    ] * count


@given("stops were already read from the cache")
def _given_stops_already_read(reference_cache: ReferenceDataCache) -> None:
    reference_cache.stops()


@given("the TTL has expired")
def _given_ttl_expired(fake_clock: list[float]) -> None:
    fake_clock[0] += 1000.0


@when("stops are read from the cache", target_fixture="result")
def _when_stops_read(reference_cache: ReferenceDataCache) -> Any:
    return reference_cache.stops()


@when("stops are read from the cache again", target_fixture="result")
def _when_stops_read_again(reference_cache: ReferenceDataCache) -> Any:
    return reference_cache.stops()


@when(
    parsers.parse('route-stops at stop "{stop_id}" are read from the cache'),
    target_fixture="result",
)
def _when_route_stops_at_stop_read(reference_cache: ReferenceDataCache, stop_id: str) -> Any:
    return reference_cache.route_stops_at_stop(stop_id)


@when(parsers.parse('line "{line_id}" is read from the cache'), target_fixture="result")
def _when_line_read(reference_cache: ReferenceDataCache, line_id: str) -> Any:
    return reference_cache.line(line_id)


@then(parsers.parse("the domain client was called {count:d} time"))
@then(parsers.parse("the domain client was called {count:d} times"))
def _then_call_count(fake_domain_client: _FakeDomainClient, count: int) -> None:
    assert fake_domain_client.call_count == count


@then(parsers.parse("{count:d} stops come back"))
def _then_stops_come_back(result: Any, count: int) -> None:
    assert len(result) == count


@then(parsers.parse('{count:d} route-stop comes back for stop "{stop_id}"'))
@then(parsers.parse('{count:d} route-stops come back for stop "{stop_id}"'))
def _then_route_stop_count(result: Any, count: int, stop_id: str) -> None:  # noqa: ARG001 — stop_id only disambiguates the Gherkin sentence, the count assertion is what matters
    assert len(result) == count


@then("the line comes back")
def _then_line_comes_back(result: Any) -> None:
    assert result is not None


@then("nothing comes back")
def _then_nothing_comes_back(result: Any) -> None:
    assert result is None

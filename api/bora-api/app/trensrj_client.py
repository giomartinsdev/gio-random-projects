"""Thin client over the SuperVia (Rio's urban rail operator) public API
at api.trensrj.com.br — same "loader"-style role as domain_client.py,
just for an external, third-party upstream instead of our own domain.
No API key: only /admin/* needs auth, and this client never touches
that surface.

Station coordinates aren't part of this API at all (confirmed live:
neither /stations/ nor /stations/{slug} carry latitude/longitude, only
a free-text address) — train_stations.py's static, pre-geocoded seed
file is what train_planner.py actually matches against by distance.
This client is purely a pass-through to trensrj's own trip planner,
which already does the line/transfer matching a rail network needs.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx
from pydantic import BaseModel

if TYPE_CHECKING:
    from datetime import date as date_

_BASE_URL = "https://api.trensrj.com.br"
_USER_AGENT = "bora-api (+https://github.com/giomartinsdev/gio-random-projects)"


class TrainPlanLeg(BaseModel):
    line_name: str
    line_short_name: str
    line_color: str
    from_station_name: str
    to_station_name: str
    departure_time: str
    arrival_time: str
    stops_count: int


class TrainPlanOption(BaseModel):
    legs: list[TrainPlanLeg]
    departure_time: str
    arrival_time: str
    total_duration_min: int
    is_last_trip_of_day: bool
    warnings: list[str]


class TrensRjClient:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=15.0, headers={"User-Agent": _USER_AGENT})

    def plan_trip(
        self, origin_id: str, destination_id: str, on_date: date_, time: str
    ) -> list[TrainPlanOption]:
        """`time` is "HH:MM", matching trensrj's own wire format exactly
        — parsing it into a real time object here would just have to be
        re-serialized right back before the request goes out."""
        response = self._client.post(
            f"{_BASE_URL}/trips/plan",
            json={
                "originId": origin_id,
                "destinationId": destination_id,
                "date": on_date.isoformat(),
                "time": time,
            },
        )
        response.raise_for_status()
        body: dict[str, Any] = response.json()
        return [_parse_option(option) for option in body.get("options", [])]


def _parse_option(option: dict[str, Any]) -> TrainPlanOption:
    return TrainPlanOption(
        legs=[
            TrainPlanLeg(
                line_name=leg["line"]["name"],
                line_short_name=leg["line"]["shortName"],
                line_color=leg["line"]["color"],
                from_station_name=leg["fromStation"]["name"],
                to_station_name=leg["toStation"]["name"],
                departure_time=leg["departureTime"],
                arrival_time=leg["arrivalTime"],
                stops_count=leg["stopsCount"],
            )
            for leg in option["legs"]
        ],
        departure_time=option["departureTime"],
        arrival_time=option["arrivalTime"],
        total_duration_min=option["totalDurationMin"],
        is_last_trip_of_day=option["isLastTripOfDay"],
        warnings=option.get("warnings", []),
    )

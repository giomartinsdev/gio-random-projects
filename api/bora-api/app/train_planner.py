"""Rail trip search — a v1 companion to trip_planner.py's bus search,
riding on trensrj's own already-built line/transfer planner
(trensrj_client.py) instead of reimplementing GTFS-style matching for
a mode this system holds no schedule data of its own for.

v1 simplifications:
- Stations are matched to the rider's origin/destination by
  straight-line distance from the pre-geocoded static list in
  train_stations.py — there's no live-GPS mode here, unlike buses.
  trensrj's own /trips/live endpoint is a natural fast-follow.
- Always plans for "right now" (today's date, current time in
  America/Sao_Paulo) — no way for a rider to ask "what if I leave at
  6pm" yet.
- Not integrated into TripPlanner's own direct/transfer bus search —
  trains surface as their own separate result, since unifying the two
  would need train stations to exist as real Stop rows the bus search
  can route through, and this system holds no coordinates for them
  outside this one static file.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from app.geo import haversine_m

if TYPE_CHECKING:
    from app.train_stations import TrainStation
    from app.trensrj_client import TrainPlanOption, TrensRjClient

_SAO_PAULO_TZ = ZoneInfo("America/Sao_Paulo")


@dataclass
class NearbyTrainStation:
    station: TrainStation
    distance_m: float
    walk_seconds: float


@dataclass
class TrainTrip:
    origin: NearbyTrainStation
    destination: NearbyTrainStation
    options: list[TrainPlanOption]


class TrainPlanner:
    def __init__(
        self,
        client: TrensRjClient,
        stations: list[TrainStation],
        *,
        walking_speed_mps: float,
        max_station_distance_m: float,
    ) -> None:
        self._client = client
        self._stations = stations
        self._walking_speed_mps = walking_speed_mps
        self._max_station_distance_m = max_station_distance_m

    def nearest_station(self, latitude: float, longitude: float) -> NearbyTrainStation | None:
        best: NearbyTrainStation | None = None
        for station in self._stations:
            distance = haversine_m(latitude, longitude, station.latitude, station.longitude)
            if distance > self._max_station_distance_m:
                continue
            if best is None or distance < best.distance_m:
                best = NearbyTrainStation(
                    station=station,
                    distance_m=distance,
                    walk_seconds=distance / self._walking_speed_mps,
                )
        return best

    def trip_options(
        self, from_lat: float, from_lon: float, to_lat: float, to_lon: float
    ) -> TrainTrip | None:
        origin = self.nearest_station(from_lat, from_lon)
        destination = self.nearest_station(to_lat, to_lon)
        # No nearby station on either end, or the same station on both
        # (rider's origin and destination round to one station) — a
        # real trip needs two distinct stations to plan between.
        if origin is None or destination is None or origin.station.id == destination.station.id:
            return None

        now = datetime.now(_SAO_PAULO_TZ)
        options = self._client.plan_trip(
            origin.station.id, destination.station.id, now.date(), now.strftime("%H:%M")
        )
        return TrainTrip(origin=origin, destination=destination, options=options)

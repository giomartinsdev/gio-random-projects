# FastAPI route handlers nested inside create_app() below are only ever
# invoked via the @app.get decorator, never referenced by name —
# invisible to reportUnusedFunction's static analysis. Same pattern as
# api/gateway/app/main.py's own health().
# pyright: reportUnusedFunction=false

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel

from app.cache import ReferenceDataCache
from app.config import settings
from app.domain_client import DomainClient
from app.geocoding import NominatimGeocoder
from app.train_planner import TrainPlanner
from app.train_stations import load_train_stations
from app.trensrj_client import TrensRjClient
from app.trip_planner import TripPlanner

# Module-level singletons — a fresh TripPlanner per request would mean a
# fresh (cache-less) ReferenceDataCache every time, defeating the whole
# point of caching Stop/Line/RouteStop across requests. Tests override
# these via app.dependency_overrides instead of touching this
# construction (see app/tests/steps/test_main_steps.py).
_domain_client = DomainClient(settings.gateway_url, settings.gateway_api_key)
_cache = ReferenceDataCache(_domain_client, settings.reference_data_ttl_seconds)
_planner = TripPlanner(
    _domain_client,
    _cache,
    walking_speed_mps=settings.walking_speed_mps,
    min_bus_speed_kmh=settings.min_bus_speed_kmh,
    average_bus_speed_kmh=settings.average_bus_speed_kmh,
    average_train_speed_kmh=settings.average_train_speed_kmh,
    transfer_buffer_seconds=settings.transfer_buffer_seconds,
    max_position_age_seconds=settings.max_position_age_seconds,
)
_geocoder = NominatimGeocoder()
_trensrj_client = TrensRjClient()
_train_planner = TrainPlanner(
    _trensrj_client,
    load_train_stations(),
    walking_speed_mps=settings.walking_speed_mps,
    max_station_distance_m=settings.max_train_station_distance_m,
)


def get_trip_planner() -> TripPlanner:
    return _planner


def get_geocoder() -> NominatimGeocoder:
    return _geocoder


def get_train_planner() -> TrainPlanner:
    return _train_planner


class NearbyStopResponse(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    distance_m: float
    walk_seconds: float


class TripOptionResponse(BaseModel):
    line_id: str
    line_code: str
    line_name: str
    origin_stop_id: str
    origin_stop_name: str
    origin_latitude: float
    origin_longitude: float
    destination_stop_id: str
    destination_stop_name: str
    destination_latitude: float
    destination_longitude: float
    walk_seconds: float
    trip_seconds: float
    vehicle_id: str | None
    eta_seconds: float | None
    mode: str = "bus"
    transfer_stop_id: str | None = None
    transfer_stop_name: str | None = None
    transfer_latitude: float | None = None
    transfer_longitude: float | None = None
    transfer_line_id: str | None = None
    transfer_line_code: str | None = None
    transfer_line_name: str | None = None
    transfer_mode: str | None = None
    transfer_seconds: float | None = None


class GeocodeResponse(BaseModel):
    name: str
    latitude: float
    longitude: float


class LineVehicleResponse(BaseModel):
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: float


class TrainLegResponse(BaseModel):
    line_name: str
    line_short_name: str
    line_color: str
    from_station_name: str
    to_station_name: str
    departure_time: str
    arrival_time: str
    stops_count: int


class TrainOptionResponse(BaseModel):
    legs: list[TrainLegResponse]
    departure_time: str
    arrival_time: str
    total_duration_min: int
    is_last_trip_of_day: bool
    warnings: list[str]


class TrainTripResponse(BaseModel):
    origin_station_name: str
    origin_walk_seconds: float
    destination_station_name: str
    destination_walk_seconds: float
    options: list[TrainOptionResponse]


def create_app() -> FastAPI:
    app = FastAPI(title="bora-api")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/nearby-stops")
    def nearby_stops(
        planner: Annotated[TripPlanner, Depends(get_trip_planner)],
        lat: float = Query(...),
        lon: float = Query(...),
        radius_m: float = Query(default=settings.default_radius_m, gt=0),
        limit: int = Query(default=settings.default_stop_limit, gt=0),
    ) -> list[NearbyStopResponse]:
        return [
            NearbyStopResponse(
                id=nearby.stop.id,
                name=nearby.stop.name,
                latitude=nearby.stop.latitude,
                longitude=nearby.stop.longitude,
                distance_m=nearby.distance_m,
                walk_seconds=nearby.walk_seconds,
            )
            for nearby in planner.nearby_stops(lat, lon, radius_m, limit)
        ]

    @app.get("/trip-options")
    def trip_options(
        planner: Annotated[TripPlanner, Depends(get_trip_planner)],
        from_lat: float = Query(...),
        from_lon: float = Query(...),
        to_lat: float = Query(...),
        to_lon: float = Query(...),
        radius_m: float = Query(default=settings.default_radius_m, gt=0),
        stop_limit: int = Query(default=settings.default_stop_limit, gt=0),
    ) -> list[TripOptionResponse]:
        options = planner.trip_options(
            from_lat, from_lon, to_lat, to_lon, radius_m=radius_m, stop_limit=stop_limit
        )
        return [
            TripOptionResponse(
                line_id=option.line_id,
                line_code=option.line_code,
                line_name=option.line_name,
                origin_stop_id=option.origin_stop_id,
                origin_stop_name=option.origin_stop_name,
                origin_latitude=option.origin_latitude,
                origin_longitude=option.origin_longitude,
                destination_stop_id=option.destination_stop_id,
                destination_stop_name=option.destination_stop_name,
                destination_latitude=option.destination_latitude,
                destination_longitude=option.destination_longitude,
                walk_seconds=option.walk_seconds,
                trip_seconds=option.trip_seconds,
                vehicle_id=option.vehicle_id,
                eta_seconds=option.eta_seconds,
                mode=option.mode,
                transfer_stop_id=option.transfer_stop_id,
                transfer_stop_name=option.transfer_stop_name,
                transfer_latitude=option.transfer_latitude,
                transfer_longitude=option.transfer_longitude,
                transfer_line_id=option.transfer_line_id,
                transfer_line_code=option.transfer_line_code,
                transfer_line_name=option.transfer_line_name,
                transfer_mode=option.transfer_mode,
                transfer_seconds=option.transfer_seconds,
            )
            for option in options
        ]

    @app.get("/line-vehicles")
    def line_vehicles(
        planner: Annotated[TripPlanner, Depends(get_trip_planner)],
        line_code: str = Query(..., min_length=1),
    ) -> list[LineVehicleResponse]:
        return [
            LineVehicleResponse(
                vehicle_id=vehicle.vehicle_id,
                latitude=vehicle.latitude,
                longitude=vehicle.longitude,
                speed_kmh=vehicle.speed_kmh,
            )
            for vehicle in planner.line_vehicles(line_code)
        ]

    @app.get("/train-options")
    def train_options(
        planner: Annotated[TrainPlanner, Depends(get_train_planner)],
        from_lat: float = Query(...),
        from_lon: float = Query(...),
        to_lat: float = Query(...),
        to_lon: float = Query(...),
    ) -> TrainTripResponse | None:
        trip = planner.trip_options(from_lat, from_lon, to_lat, to_lon)
        if trip is None:
            return None
        return TrainTripResponse(
            origin_station_name=trip.origin.station.name,
            origin_walk_seconds=trip.origin.walk_seconds,
            destination_station_name=trip.destination.station.name,
            destination_walk_seconds=trip.destination.walk_seconds,
            options=[
                TrainOptionResponse(
                    legs=[
                        TrainLegResponse(
                            line_name=leg.line_name,
                            line_short_name=leg.line_short_name,
                            line_color=leg.line_color,
                            from_station_name=leg.from_station_name,
                            to_station_name=leg.to_station_name,
                            departure_time=leg.departure_time,
                            arrival_time=leg.arrival_time,
                            stops_count=leg.stops_count,
                        )
                        for leg in option.legs
                    ],
                    departure_time=option.departure_time,
                    arrival_time=option.arrival_time,
                    total_duration_min=option.total_duration_min,
                    is_last_trip_of_day=option.is_last_trip_of_day,
                    warnings=option.warnings,
                )
                for option in trip.options
            ],
        )

    @app.get("/geocode")
    def geocode(
        geocoder: Annotated[NominatimGeocoder, Depends(get_geocoder)],
        q: str = Query(..., min_length=2),
        limit: int = Query(default=5, gt=0),
    ) -> list[GeocodeResponse]:
        return [
            GeocodeResponse(name=result.name, latitude=result.latitude, longitude=result.longitude)
            for result in geocoder.search(q, limit)
        ]

    return app


app = create_app()

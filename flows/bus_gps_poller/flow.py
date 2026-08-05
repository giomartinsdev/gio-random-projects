"""Orchestration only. Prefect's @task wraps each ETL class call so every
stage shows up as its own task run in the UI (retries, caching, logs) —
the classes themselves stay Prefect-agnostic and unit-testable on their own.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from prefect import flow, task

from flows.bus_gps_poller.etl.extract import SppoExtractor
from flows.bus_gps_poller.etl.load import GatewayBusPositionLoader
from flows.bus_gps_poller.etl.transform import BusPositionTransformer

if TYPE_CHECKING:
    from flows.bus_gps_poller.schemas import BusPositionCapture


@task(retries=3, retry_delay_seconds=10)
def extract(window_seconds: int) -> list[dict[str, Any]]:
    return SppoExtractor(window_seconds).extract()


@task
def transform(data: list[dict[str, Any]]) -> list[BusPositionCapture]:
    return BusPositionTransformer().transform(data)


@task(retries=2, retry_delay_seconds=10)
def load(data: list[BusPositionCapture], gateway_url: str, api_key: str) -> None:
    GatewayBusPositionLoader(gateway_url, api_key).load(data)


@flow(log_prints=True)
def bus_gps_poller(
    gateway_url: str = "https://gateway.giomartins.dev",
    api_key: str = "",
    window_seconds: int = 300,
) -> None:
    """Polls dados.mobilidade.rio/gps/sppo for the last `window_seconds`
    (default: last 5 minutes, matching the reference frontend's own
    query window) and upserts every parseable position as each
    vehicle's latest known position via one RecordVehiclePositions
    event — overwritten each poll, not appended, so the domain's
    vehicle/vehicle_position tables stay bounded by fleet size instead
    of growing forever. Scheduled every 5 minutes, business hours
    only — see prefect.yaml."""
    raw = extract(window_seconds)
    positions = transform(raw)
    load(positions, gateway_url, api_key)


if __name__ == "__main__":
    bus_gps_poller()

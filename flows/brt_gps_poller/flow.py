"""Orchestration only. Prefect's @task wraps each ETL class call so every
stage shows up as its own task run in the UI (retries, caching, logs) —
the classes themselves stay Prefect-agnostic and unit-testable on their own.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from prefect import flow, task

from flows.brt_gps_poller.etl.extract import BrtExtractor
from flows.brt_gps_poller.etl.load import GatewayBusPositionLoader
from flows.brt_gps_poller.etl.transform import BrtPositionTransformer

if TYPE_CHECKING:
    from flows.brt_gps_poller.schemas import BusPositionCapture


@task(retries=3, retry_delay_seconds=10)
def extract() -> list[dict[str, Any]]:
    return BrtExtractor().extract()


@task
def transform(data: list[dict[str, Any]]) -> list[BusPositionCapture]:
    return BrtPositionTransformer().transform(data)


@task(retries=2, retry_delay_seconds=10)
def load(data: list[BusPositionCapture], gateway_url: str, api_key: str) -> None:
    GatewayBusPositionLoader(gateway_url, api_key).load(data)


@flow(log_prints=True)
def brt_gps_poller(
    gateway_url: str = "https://gateway.giomartins.dev",
    api_key: str = "",
) -> None:
    """Polls dados.mobilidade.rio/gps/brt's live snapshot (no time
    window — unlike SPPO, BRT has no dataInicial/dataFinal, it's always
    "right now") and upserts every parseable position as each vehicle's
    latest known position via one RecordVehiclePositions event —
    overwritten each poll, not appended, so the domain's
    vehicle/vehicle_position tables stay bounded by fleet size instead
    of growing forever. Same tables as flows/bus_gps_poller (SPPO) — a
    separate flow/deployment since it's a separate feed with a
    different shape and no shared code between the two, but both write
    the same "latest known position" model. Scheduled every 5 minutes,
    business hours only — see prefect.yaml."""
    raw = extract()
    positions = transform(raw)
    load(positions, gateway_url, api_key)


if __name__ == "__main__":
    brt_gps_poller()

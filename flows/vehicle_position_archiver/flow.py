"""Same class-based, Prefect-agnostic ETL shape as flows/bus_gps_poller.
Unlike bus_gps_poller, the "business rule" this flow enforces — keep
only the `keep_per_vehicle` most recent VehiclePositionHistory rows per
vehicle — used to live server-side in api/domain. It moved here so the
domain stays a pure CRUD/storage layer with no embedded policy; see
api/domain/app/domain/vehicle_position/history_events.py's module
docstring for the full reasoning.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from prefect import flow, task

from flows.vehicle_position_archiver.etl.extract import GatewayHistoryExtractor
from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader
from flows.vehicle_position_archiver.etl.transform import ArchivePlanner

if TYPE_CHECKING:
    from flows.vehicle_position_archiver.schemas import ArchivePlan, VehiclePositionHistoryRow


@task(retries=3, retry_delay_seconds=30)
def extract(gateway_url: str, api_key: str) -> list[VehiclePositionHistoryRow]:
    return GatewayHistoryExtractor(gateway_url, api_key).extract()


@task
def transform(rows: list[VehiclePositionHistoryRow], keep_per_vehicle: int) -> ArchivePlan:
    return ArchivePlanner(keep_per_vehicle).transform(rows)


@task(retries=3, retry_delay_seconds=30)
def load(plan: ArchivePlan, gateway_url: str, api_key: str, archive_bucket: str) -> None:
    GatewayArchiveLoader(gateway_url, api_key, archive_bucket).load(plan)


@flow(log_prints=True)
def vehicle_position_archiver(
    gateway_url: str = "https://gateway.giomartins.dev",
    api_key: str = "",
    keep_per_vehicle: int = 10,
    archive_bucket: str = "vehicle-position-archive",
) -> None:
    """Keeps VehiclePositionHistory down to the `keep_per_vehicle` most
    recent rows per vehicle — anything older gets written to one Parquet
    file on MinIO, then deleted from Postgres. Independent of how often
    positions themselves get recorded (bus_gps_poller, brt_gps_poller
    both write to the same table) — this just keeps it bounded
    regardless of their cadence."""
    rows = extract(gateway_url, api_key)
    plan = transform(rows, keep_per_vehicle)
    load(plan, gateway_url, api_key, archive_bucket)


if __name__ == "__main__":
    vehicle_position_archiver()

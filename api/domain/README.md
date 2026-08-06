# Domain Event API

Python 3.14 + Pydantic + SQLAlchemy (via SQLModel) + FastAPI. DDD-flavored,
event-driven: **you only ever write a domain's entity and its events** —
the DB table, the CRUD behavior, and the HTTP routes all follow from that
automatically.

## Adding a new domain

```
app/domain/<name>/
  __init__.py
  entity.py    # class <Name>(Entity, table=True): ...fields...
  events.py    # events for that entity, subclassing the verb bases
```

```python
# app/domain/order/entity.py
from app.domain.base import Entity


class Order(Entity, table=True):
    customer_email: str
    total_cents: int
```

```python
# app/domain/order/events.py
from app.domain.base import Create, Delete, GetById, ListAll, Update
from app.domain.order.entity import Order


class GetOrder(GetById[Order]):
    pass


class ListOrders(ListAll[Order]):
    pass


class CreateOrder(Create[Order]):
    customer_email: str
    total_cents: int


class UpdateOrder(Update[Order]):
    customer_email: str | None = None
    total_cents: int | None = None


class DeleteOrder(Delete[Order]):
    pass
```

That's it. On next startup: the `order` table gets created if it doesn't
exist, and `POST /events/get-order`, `/list-orders`, `/create-order`,
`/update-order`, `/delete-order` all exist and work — each just does
`Event(**request_body).handle(session)`.

## Why this works — the two-part contract (`app/domain/base.py`)

1. **`Entity`** — subclass with `table=True` and SQLModel registers the
   table in its shared metadata the moment the module is imported.
   `infrastructure/discovery.py` imports every module under `app/domain/`
   on startup; `infrastructure/db.py` then calls
   `SQLModel.metadata.create_all()`, which creates anything missing.

2. **`DomainEvent[TEntity]`** and its five verb bases (`GetById`,
   `ListAll`, `Create`, `Update`, `Delete`) — subclassing one of them
   parameterized with a concrete `Entity` (e.g. `GetById[Order]`) is
   enough for `__init_subclass__` to resolve which entity the event is
   bound to and register the class in `EVENT_REGISTRY`.
   `presentation/router_factory.py` walks that registry and adds one
   route per event, named from the event class (`GetOrder` → `get-order`).

Custom behavior beyond plain CRUD: override `handle(self, session)` on the
leaf event class. The verb base's version is just what runs if you don't.

## Non-relational data: `Document`

Subclass `Document` (in `app/domain/base.py`) instead of `Entity` when the
row's shape isn't yours to define a migration for — a third-party feed,
say, where a new field showing up shouldn't require a schema change here.
`Document` is still an `Entity` underneath (gets `id` for free, works with
every verb base above); the difference is one extra `data` column typed
as real Postgres `JSONB` in production (`sqlite`'s plain `JSON` in
tests/local dev, since sqlite has no `JSONB` of its own) instead of
individual typed columns, plus a required `captured_at`.

```python
# app/domain/vehicle_position/entity.py
from sqlmodel import Field

from app.domain.base import Document


class VehiclePosition(Document, table=True):
    """One row per vehicle, overwritten every poll — see
    flows/bus_gps_poller for what lands in `data`."""

    id: str = Field(primary_key=True)  # a natural key, not autoincrement
```

For a high-frequency batch producer (a poller landing thousands of rows
every few minutes), override `id`'s type to a natural key and `handle()`
to upsert (`session.merge()`, not `session.add()`) — the "current known
state per key" shape, not an ever-growing append-only history:

```python
# app/domain/vehicle_position/events.py
from datetime import datetime

from pydantic import BaseModel
from sqlmodel import Session

from app.domain.base import DomainEvent
from app.domain.vehicle_position.entity import VehiclePosition


class VehiclePositionInput(BaseModel):
    vehicle_id: str
    latitude: float
    longitude: float
    captured_at: datetime


class RecordVehiclePositions(DomainEvent[VehiclePosition]):
    positions: list[VehiclePositionInput]

    def handle(self, session: Session) -> int:
        for p in self.positions:
            session.merge(
                VehiclePosition(
                    id=p.vehicle_id, data=p.model_dump(mode="json"), captured_at=p.captured_at
                )
            )
        session.commit()
        return len(self.positions)
```

`POST /events/record-vehicle-positions` then accepts `{"positions":
[...]}`, upserts by `vehicle_id`, and returns the count processed — the
table stays bounded by fleet size no matter how often it's polled.
(The real implementation, `app/domain/vehicle_position/events.py`, does
a chunked bulk `INSERT ... ON CONFLICT DO UPDATE` instead of a
`session.merge()` per row — confirmed by testing that merge() timed
out end to end on a real ~35k-row poll; the shape above is simplified
for illustration.)

### Bounded history alongside a "latest state" table

`RecordVehiclePositions` also appends one row per vehicle to
`VehiclePositionHistory` (a `Document` keyed by autoincrement `id`, not
`vehicle_id`, since there are many rows per vehicle) — genuinely
append-only, so it needs its own bound. `ArchiveVehiclePositionHistory`
(`app/domain/vehicle_position/archive_events.py`) prunes it back to the
10 most recent rows per vehicle on a schedule (hourly, via
`flows/vehicle_position_archiver`): a `ROW_NUMBER() OVER (PARTITION BY
vehicle_id ORDER BY captured_at DESC)` window-function query finds
everything past the 10 most recent per vehicle, writes it to one
Parquet file, uploads it to MinIO (`app/infrastructure/object_storage.py`
— needs `MINIO_ENDPOINT_URL`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`/
`MINIO_ARCHIVE_BUCKET` set), then deletes those rows from Postgres.
Gives "how has this vehicle moved recently" without an unbounded table.

### MinIO/object-storage management

`app/domain/object_storage/events.py` exposes bucket/object management
itself as events — `CreateBucket`, `PutObject`, `GetObject`,
`ListObjects`, `DeleteObject` — the same pattern as everything else
here, proxied through `gateway.giomartins.dev` and audited in
`domain_event_store` like any other dispatch. Binary bodies travel
base64-encoded (`data_base64`), since the transport is JSON like every
other event.

This is for a caller that only has a gateway API key — MinIO's own S3
API (`minio-api.giomartins.dev`, see `infra/cloudflared/config.yml`) is
deliberately NOT behind Cloudflare Access, but that's for SigV4-signing
server callers like `ArchiveVehiclePositionHistory` above, which can't
do Access's browser-redirect dance any more than a plain HTTP caller
can. The MinIO console (`minio.giomartins.dev`) IS behind Access, which
blocks that same kind of caller from the opposite direction. These
events are the answer either way: manage MinIO through the domain,
authenticated the same way every other event is.

## Known limitation: schema evolution

`create_all()` only ever *creates missing tables* — it never alters an
existing one. Add a field to an entity that already has rows in
production and the table won't pick up the new column on its own. If/when
that's needed, layer in Alembic (`alembic revision --autogenerate` diffs
the SQLModel metadata against the live DB) — deliberately not built in
yet since it wasn't asked for and auto-applying destructive migrations on
every boot is its own hazard (see the "coloque a version no nome" style
caution about auto-running things you haven't reviewed).

## Telemetry

Automatic, zero-code — see `../README.md#telemetry` for how it works
(same mechanism across every service under `api/`).

## Running locally

```bash
pip install -r requirements-dev.txt
uvicorn main:app --reload
```

Defaults to a local `sqlite:///./dev.db`. Set `DATABASE_URL` to point at
Postgres instead (e.g. `postgresql+psycopg://user:pass@host:5432/db`).

## Checks

```bash
ruff check .
ruff format --check .
pyright .
pytest
```

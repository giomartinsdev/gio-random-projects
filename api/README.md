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

class GetOrder(GetById[Order]): pass
class ListOrders(ListAll[Order]): pass

class CreateOrder(Create[Order]):
    customer_email: str
    total_cents: int

class UpdateOrder(Update[Order]):
    customer_email: str | None = None
    total_cents: int | None = None

class DeleteOrder(Delete[Order]): pass
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

## Known limitation: schema evolution

`create_all()` only ever *creates missing tables* — it never alters an
existing one. Add a field to an entity that already has rows in
production and the table won't pick up the new column on its own. If/when
that's needed, layer in Alembic (`alembic revision --autogenerate` diffs
the SQLModel metadata against the live DB) — deliberately not built in
yet since it wasn't asked for and auto-applying destructive migrations on
every boot is its own hazard (see the "coloque a version no nome" style
caution about auto-running things you haven't reviewed).

## Running locally

```bash
pip install -r requirements-dev.txt
uvicorn main:app --reload
```

Defaults to a local `sqlite:///./dev.db`. Set `DATABASE_URL` to point at
Postgres instead (e.g. `postgresql+psycopg://user:pass@host:5432/db`).

## Checks

```bash
mypy app main.py
pytest
```

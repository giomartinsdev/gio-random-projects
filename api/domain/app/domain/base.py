"""Framework base classes every domain must build on.

Two things live here, and they're the entire contract a new domain has to
follow:

1. `Entity` — subclass it with `table=True` to get a DB table for free.
   SQLModel's own metadata collects every `table=True` subclass the moment
   its module is imported; infrastructure/db.py just has to import the
   whole domain package once and call `SQLModel.metadata.create_all()`.
   `Document` is the same thing for a schemaless row (one JSONB column
   instead of individual typed ones) — subclass `Document` instead of
   `Entity` when the upstream shape isn't yours to define a migration for.

2. `DomainEvent` — subclass one of the five verb bases below
   (`GetById`, `ListAll`, `Create`, `Update`, `Delete`) parameterized
   with a concrete `Entity`/`Document`, e.g. `class GetUser(GetById[User])`.
   That's enough: `__init_subclass__` resolves the concrete entity from
   the generic parameter, binds it to the class, and registers the
   class in `EVENT_REGISTRY` — which is what the presentation layer
   walks to build routes. No manual registration step, ever.

Custom behavior beyond plain CRUD: override `handle()` on the leaf event
class itself; the verb base's default implementation is just what runs if
you don't.
"""

from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — SQLModel/Pydantic resolve field annotations at class-creation time, not just for static typing
)
from typing import Any, ClassVar, cast

from pydantic import BaseModel
from sqlalchemy import JSON, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Session, SQLModel, select


class Entity(SQLModel):
    """Base for every domain entity (aggregate root)."""

    id: int | None = Field(default=None, primary_key=True)


class Document(Entity):
    """Base for schemaless entities — the payload lives in one JSONB
    column instead of individual typed columns, so an upstream schema
    change (a new field in a third-party feed, say) never needs a
    migration. Still an `Entity` underneath (gets `id` for free, and
    every generic verb below works on it exactly like a relational one)
    — "non-relational" here just means how ONE row's shape is stored,
    not a different storage engine.

    `JSON().with_variant(JSONB, "postgresql")` — real JSONB in
    production, plain JSON on SQLite (what tests/local dev use by
    default, see infrastructure/db.py) since SQLite has no JSONB type of
    its own.
    """

    data: dict[str, Any] = Field(sa_column=Column(JSON().with_variant(JSONB, "postgresql")))
    captured_at: datetime


EVENT_REGISTRY: list[type[DomainEvent[Any]]] = []


class DomainEvent[TEntity: Entity](BaseModel):
    """Base for every domain event. See module docstring for the contract."""

    model_config = {"arbitrary_types_allowed": True}

    __entity__: ClassVar[type[Entity]]

    def __init_subclass__(cls, **kwargs: Any) -> None:  # noqa: ANN401 — matches object.__init_subclass__'s own signature
        super().__init_subclass__(**kwargs)
        # Pydantic v2 has its own generics machinery (`Model[Concrete]`
        # synthesizes a real intermediate class, cached, distinct from
        # stdlib typing's Generic behavior) — the resolved type argument
        # lives in that intermediate class's __pydantic_generic_metadata__,
        # not in cls's __orig_bases__ the way plain typing.Generic would.
        for base in cls.__mro__[1:]:
            metadata = getattr(base, "__pydantic_generic_metadata__", None)
            args = metadata.get("args") if metadata else None
            if args and isinstance(args[0], type) and issubclass(args[0], Entity):
                cls.__entity__ = args[0]
                EVENT_REGISTRY.append(cls)
                return

    def handle(self, session: Session) -> Any:  # noqa: ANN401 — every verb subclass overrides with its own concrete return type
        raise NotImplementedError(f"{type(self).__name__} must implement handle()")


class GetById[TEntity: Entity](DomainEvent[TEntity]):
    """Fetch a single entity by primary key. Returns None if not found."""

    id: int

    def handle(self, session: Session) -> TEntity | None:
        # __entity__ is declared ClassVar[type[Entity]] — ClassVar can't be
        # parameterized by a TypeVar, so mypy only knows the base type; the
        # cast just states what __init_subclass__ already guarantees at
        # runtime (this event only ever registers bound to TEntity).
        return cast("TEntity | None", session.get(self.__entity__, self.id))


class ListAll[TEntity: Entity](DomainEvent[TEntity]):
    """Fetch every row of the bound entity."""

    def handle(self, session: Session) -> list[TEntity]:
        return cast("list[TEntity]", list(session.exec(select(self.__entity__)).all()))


class Create[TEntity: Entity](DomainEvent[TEntity]):
    """Insert a new row. Every field the leaf event declares (besides
    inherited ones) is passed straight to the entity's constructor — the
    event's own fields ARE the typed creation payload."""

    def handle(self, session: Session) -> TEntity:
        entity = self.__entity__(**self.model_dump())
        session.add(entity)
        session.commit()
        session.refresh(entity)
        return cast("TEntity", entity)


class Update[TEntity: Entity](DomainEvent[TEntity]):
    """Patch an existing row. Only fields explicitly set on the event are
    applied (`exclude_unset=True`) — declare update fields as optional
    with a None default on the leaf event so callers can omit what they're
    not changing. Returns None if the id doesn't exist."""

    id: int

    def handle(self, session: Session) -> TEntity | None:
        entity = session.get(self.__entity__, self.id)
        if entity is None:
            return None
        for key, value in self.model_dump(exclude={"id"}, exclude_unset=True).items():
            setattr(entity, key, value)
        session.add(entity)
        session.commit()
        session.refresh(entity)
        return cast("TEntity", entity)


class Delete[TEntity: Entity](DomainEvent[TEntity]):
    """Delete a row by id. Returns whether a row was actually deleted."""

    id: int

    def handle(self, session: Session) -> bool:
        entity = session.get(self.__entity__, self.id)
        if entity is None:
            return False
        session.delete(entity)
        session.commit()
        return True

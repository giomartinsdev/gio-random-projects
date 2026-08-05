"""Engine/session + table creation.

create_db_and_tables() relies entirely on SQLModel.metadata already having
every table=True entity registered — which only happens if their modules
were imported. Call discover_domain() (infrastructure/discovery.py) first.
"""

from __future__ import annotations

import os
from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./dev.db")

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=_connect_args)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    # expire_on_commit=False: an event's handle() commits, then
    # dispatcher.py commits again (the event-store audit row) — the
    # second commit would otherwise expire every attribute on whatever
    # entity handle() just returned (SQLAlchemy's default), so FastAPI
    # serializes an empty object instead of the row. Values already read
    # this request stay valid past a commit; nothing here re-queries
    # stale data across requests since each request gets its own session.
    with Session(engine, expire_on_commit=False) as session:
        yield session

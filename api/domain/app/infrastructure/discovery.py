"""Imports every module under app.domain so their class bodies execute —
which is what actually registers entities (via SQLModel.metadata) and
events (via DomainEvent.__init_subclass__ in domain/base.py). This is the
one piece of "magic": add a new domain/<name>/ package with an entity.py
and events.py, and this is what makes the rest of the app notice it.
"""

from __future__ import annotations

import importlib
import pkgutil

import app.domain as domain_pkg


def discover_domain() -> None:
    for module_info in pkgutil.walk_packages(domain_pkg.__path__, prefix=f"{domain_pkg.__name__}."):
        importlib.import_module(module_info.name)

"""The ACL's read use case: translate a worker query into a domain-api GET.

Mirror of ``application/commands.py`` for §4.2. Same three promises, applied
to reads:

1. **Routing**: a query action with no mapping is refused with 422, never
   passed through — an unknown read is unknown, and relaying it would let an
   arbitrary path reach domain-api.
2. **Validation**: the request's ``user_id``/``date``/``month`` are checked
   here, so the worker gets a 422 and no round trip for a malformed query.
3. **Projection**: domain-api's JSON is parsed into the typed read models,
   which is where the "money is a string, never a float" rule is enforced on
   the way out (§3.4-1).

If this module ever needs a database session, the design has drifted out of
§1.1 — reads go to domain-api exactly like writes do.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Final, Mapping, Protocol

from finance_api.domain.errors import DomainApiError, ValidationError
from finance_api.domain.reads import (
    CashFlowHistory,
    CategoryBreakdown,
    DailySummary,
    MonthlyDashboard,
)
from finance_contracts import (
    ACTION_GET_CASH_FLOW_HISTORY,
    ACTION_GET_CATEGORY_BREAKDOWN,
    ACTION_GET_DAILY_SUMMARY,
    ACTION_GET_MONTHLY_DASHBOARD,
)

# ``user_id`` is the identity the worker resolved from the WhatsApp number;
# it is required on every read. ``date``/``month`` carry the period.
_YYYYMM: Final = re.compile(r"^\d{4}-\d{2}$")
_YYYYMMDD: Final = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class DomainApiReadPort(Protocol):
    """The read door of ``domain-api`` (GET, projectios)."""

    def get(self, path: str, params: Mapping[str, str]) -> Mapping[str, Any]:
        """GET ``path`` with ``params`` and return the JSON object."""
        ...


@dataclass(frozen=True, slots=True)
class ReadRoute:
    action: str
    path: str
    parse: Callable[[Mapping[str, Any]], Any]
    needs_date: bool = False


def _require_user_id(params: Mapping[str, str]) -> None:
    if not params.get("user_id", "").strip():
        raise ValidationError("user_id is required")


def _require_month(params: Mapping[str, str]) -> None:
    month = params.get("month", "")
    if not _YYYYMM.match(month):
        raise ValidationError(f"month must be 'YYYY-MM', got {month!r}")


def _require_date(params: Mapping[str, str]) -> None:
    date = params.get("date", "")
    if not _YYYYMMDD.match(date):
        raise ValidationError(f"date must be 'YYYY-MM-DD', got {date!r}")


# The §4.2 query family. Kept as data so the route, the tests and the
# contract constants all read from one table.
_READS: Final[Mapping[str, ReadRoute]] = {
    ACTION_GET_DAILY_SUMMARY: ReadRoute(
        ACTION_GET_DAILY_SUMMARY,
        "/finance/daily-summary",
        DailySummary.from_wire,
        needs_date=True,
    ),
    ACTION_GET_MONTHLY_DASHBOARD: ReadRoute(
        ACTION_GET_MONTHLY_DASHBOARD,
        "/finance/monthly-dashboard",
        MonthlyDashboard.from_wire,
    ),
    ACTION_GET_CATEGORY_BREAKDOWN: ReadRoute(
        ACTION_GET_CATEGORY_BREAKDOWN,
        "/finance/category-breakdown",
        CategoryBreakdown.from_wire,
    ),
    ACTION_GET_CASH_FLOW_HISTORY: ReadRoute(
        ACTION_GET_CASH_FLOW_HISTORY,
        "/finance/cash-flow-history",
        CashFlowHistory.from_wire,
    ),
}


def known_read_actions() -> tuple[str, ...]:
    return tuple(sorted(_READS))


class QueryRouter:
    """Validates a read action and relays it to ``domain-api``'s GET."""

    def __init__(self, domain_api: DomainApiReadPort) -> None:
        self._domain_api = domain_api

    def relay(self, action: str, params: Mapping[str, Any]) -> Any:
        if not isinstance(action, str) or not action.strip():
            raise ValidationError("action is required")
        action = action.strip()

        route = _READS.get(action)
        if route is None:
            raise ValidationError(
                f"unknown read action {action!r}; known: {list(known_read_actions())}"
            )

        # Copy so a caller cannot mutate our map. Only string values are kept:
        # a non-string param is not a value domain-api understands, and it will
        # fail the required-field/format checks below rather than reach the
        # upstream as `None`.
        clean = {k: v for k, v in params.items() if isinstance(v, str) and v != ""}
        _require_user_id(clean)
        if route.needs_date:
            _require_date(clean)
        else:
            _require_month(clean)

        body = self._domain_api.get(route.path, clean)
        try:
            return route.parse(body)
        except ValidationError:
            raise
        except (TypeError, ValueError, KeyError) as exc:  # pragma: no cover - defensive
            raise DomainApiError(
                f"domain-api's {route.path} response could not be parsed as "
                f"a {action} projection"
            ) from exc

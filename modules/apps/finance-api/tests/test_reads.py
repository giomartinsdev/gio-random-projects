"""A leitura (§4.2), no lado da ACL.

O domain-api é scriptado por um ``httpx.MockTransport`` (mesma disciplina do
resto da suíte): o que se exercita é a validação da query, o caminho/param que
a ACL manda e o parse da projeção -- em especial a regra "dinheiro nunca vira
float" na volta (§3.4-1).
"""

from __future__ import annotations

import httpx
import pytest

from conftest import DOMAIN_KEY
from finance_api.application.commands import CommandRouter
from finance_api.application.reads import QueryRouter
from finance_api.domain.errors import DomainApiError, ValidationError
from finance_api.infrastructure.domain_api import DomainApiClient
from finance_api.presentation.app import create_app
from finance_api.presentation.dependencies import build_container_with_router
from finance_contracts import (
    ACTION_GET_CASH_FLOW_HISTORY,
    ACTION_GET_CATEGORY_BREAKDOWN,
    ACTION_GET_DAILY_SUMMARY,
    ACTION_GET_MONTHLY_DASHBOARD,
)
from stubs import DomainApiStub

from fastapi.testclient import TestClient

CALLER_KEY = "test-caller-key"


def router_for(stub: DomainApiStub) -> QueryRouter:
    client = DomainApiClient(base_url="http://domain-api.test", api_key=DOMAIN_KEY, client=stub.client())
    return QueryRouter(client)


def reads_client(stub: DomainApiStub) -> TestClient:
    write_client = DomainApiClient(
        base_url="http://domain-api.test", api_key=DOMAIN_KEY, client=stub.client()
    )
    container = build_container_with_router(
        CommandRouter(write_client),
        {CALLER_KEY: "worker"},
        queries=QueryRouter(write_client),
    )
    return TestClient(create_app(container))


# --------------------------------------------------------------- QueryRouter

def test_unknown_read_action_is_rejected_before_any_request() -> None:
    stub = DomainApiStub(status_code=200, body={})
    with pytest.raises(ValidationError):
        router_for(stub).relay("finance.query.nope", {"user_id": "u", "month": "2026-10"})
    assert stub.requests == []


def test_read_requires_user_id() -> None:
    stub = DomainApiStub(status_code=200, body={})
    with pytest.raises(ValidationError):
        router_for(stub).relay(ACTION_GET_MONTHLY_DASHBOARD, {"month": "2026-10"})
    assert stub.requests == []


def test_read_requires_a_well_formed_month() -> None:
    stub = DomainApiStub(status_code=200, body={})
    for bad in ("2026", "2026-1", "outubro", ""):
        with pytest.raises(ValidationError):
            router_for(stub).relay(ACTION_GET_CATEGORY_BREAKDOWN, {"user_id": "u", "month": bad})
    assert stub.requests == []


def test_daily_summary_requires_an_iso_date() -> None:
    stub = DomainApiStub(status_code=200, body={})
    for bad in ("04/10/2026", "2026-10", ""):
        with pytest.raises(ValidationError):
            router_for(stub).relay(ACTION_GET_DAILY_SUMMARY, {"user_id": "u", "date": bad})
    assert stub.requests == []


def test_monthly_dashboard_relays_the_right_get_path_and_params() -> None:
    stub = DomainApiStub(
        status_code=200,
        body={
            "user_id": "u", "month": "2026-10", "income": "1000.00", "expense": "-80.00",
            "net": "920.00", "currency": "BRL", "transaction_count": 2,
            "top_categories": [{"category": "Alimentação", "amount": "-80.00", "currency": "BRL", "transaction_count": 1}],
            "budgets": [{"category": "Alimentação", "limit_amount": "100.00", "spent_amount": "-80.00", "currency": "BRL", "thresholds_reached": [50]}],
        },
    )
    result = router_for(stub).relay(ACTION_GET_MONTHLY_DASHBOARD, {"user_id": "u", "month": "2026-10"})
    sent = stub.requests[-1]
    assert sent.method == "GET"
    assert sent.path == "/finance/monthly-dashboard"
    assert sent.headers["x-api-key"] == DOMAIN_KEY
    assert result.net.to_wire() == "920.00"
    assert result.budgets[0].thresholds == (50,)


def test_cash_flow_history_relays_and_parses_days() -> None:
    stub = DomainApiStub(
        status_code=200,
        body={
            "user_id": "u", "month": "2026-10", "currency": "BRL",
            "days": [
                {"date": "2026-10-02", "income": "100.00", "expense": "-10.00", "net": "90.00"},
                {"date": "2026-10-04", "income": "0.00", "expense": "-30.00", "net": "-30.00"},
            ],
        },
    )
    result = router_for(stub).relay(ACTION_GET_CASH_FLOW_HISTORY, {"user_id": "u", "month": "2026-10"})
    assert stub.requests[-1].path == "/finance/cash-flow-history"
    assert [d.date for d in result.days] == ["2026-10-02", "2026-10-04"]
    assert result.days[1].net.to_wire() == "-30.00"


def test_a_float_amount_in_the_projection_is_refused() -> None:
    # domain-api is supposed to send strings; if a numeric slips through, the
    # ACL must reject it rather than build a float into the dashboard.
    stub = DomainApiStub(
        status_code=200,
        body={"user_id": "u", "date": "2026-10-04", "income": 100.0, "expense": "-50.00", "net": "50.00", "currency": "BRL", "transaction_count": 3},
    )
    with pytest.raises(ValidationError):
        router_for(stub).relay(ACTION_GET_DAILY_SUMMARY, {"user_id": "u", "date": "2026-10-04"})


def test_undocumented_domain_api_status_is_an_error_not_empty_read() -> None:
    stub = DomainApiStub(status_code=500, body={"error": "boom"})
    with pytest.raises(DomainApiError):
        router_for(stub).relay(ACTION_GET_MONTHLY_DASHBOARD, {"user_id": "u", "month": "2026-10"})


# ------------------------------------------------------------------ /queries

def test_queries_route_requires_the_api_key() -> None:
    client = reads_client(DomainApiStub(status_code=200, body={}))
    response = client.post(
        "/queries",
        json={"action": ACTION_GET_MONTHLY_DASHBOARD, "payload": {"user_id": "u", "month": "2026-10"}},
    )
    assert response.status_code == 401


def test_queries_route_relays_and_returns_the_projection() -> None:
    stub = DomainApiStub(
        status_code=200,
        body={"user_id": "u", "month": "2026-10", "currency": "BRL", "categories": [
            {"category": "Alimentação", "amount": "-95.00", "currency": "BRL", "transaction_count": 2}
        ]},
    )
    response = reads_client(stub).post(
        "/queries",
        json={"action": ACTION_GET_CATEGORY_BREAKDOWN, "payload": {"user_id": "u", "month": "2026-10"}},
        headers={"X-API-Key": CALLER_KEY},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["categories"][0]["category"] == "Alimentação"
    assert body["categories"][0]["amount"] == "-95.00"


def test_queries_route_rejects_an_unknown_read_with_422() -> None:
    response = reads_client(DomainApiStub(status_code=200, body={})).post(
        "/queries",
        json={"action": "finance.query.nope", "payload": {"user_id": "u", "month": "2026-10"}},
        headers={"X-API-Key": CALLER_KEY},
    )
    assert response.status_code == 422


def test_of_accounts_route_is_intact_after_investments_insertion() -> None:
    """Regressão: a ReadRoute de ofAccounts tinha recebido os ARGUMENTOS da
    investimentos (action/path/parse/needs_date tortos) e toda leitura de
    contas respondia 'date must be YYYY-MM-DD'."""
    from finance_api.application.reads import _READS
    from finance_api.domain.reads import OFAccountList

    route = _READS["finance.query.ofAccounts"]
    assert route.action == "finance.query.ofAccounts"
    assert route.path == "/finance/openfinance/accounts"
    assert route.parse == OFAccountList.from_wire  # bound method: igualdade não é identidade
    assert route.needs_month is False
    assert isinstance(route.needs_date, bool) and route.needs_date is False

    route_inv = _READS["finance.query.investments"]
    assert route_inv.action == "finance.query.investments"
    assert route_inv.path == "/finance/investments"

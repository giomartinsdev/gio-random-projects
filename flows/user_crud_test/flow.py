"""Orchestration + assertions. Each CRUD step is its own @task (its own
task run in the UI, same reasoning as flows/greeting/flow.py) wrapping
GatewayClient — which stays Prefect-agnostic so it's unit-testable alone.
"""

from __future__ import annotations

import uuid

from prefect import flow, task
from prefect.cache_policies import NO_CACHE

from flows.shared.logger import get_logger
from flows.user_crud_test.client import GatewayClient
from flows.user_crud_test.schemas import UserPayload, UserResult

logger = get_logger(__name__)

# NO_CACHE on every task here: Prefect's default cache policy hashes task
# inputs to key a result, and GatewayClient (holding an httpx.Client, an
# unpicklable thread lock) can't be hashed — confirmed by testing, this
# doesn't fail the run, just logs a noisy warning and skips caching. These
# tasks have side effects against a real server anyway; caching them was
# never correct regardless of the serialization issue.


@task(cache_policy=NO_CACHE)
def create_user(client: GatewayClient, payload: UserPayload) -> UserResult:
    return client.create_user(payload)


@task(cache_policy=NO_CACHE)
def get_user(client: GatewayClient, user_id: int) -> UserResult:
    result = client.get_user(user_id)
    if result is None:
        raise AssertionError(f"expected user {user_id} to exist")
    return result


@task(cache_policy=NO_CACHE)
def update_user(client: GatewayClient, user_id: int, name: str) -> UserResult:
    result = client.update_user(user_id, name=name)
    if result is None:
        raise AssertionError(f"expected user {user_id} to exist for update")
    return result


@task(cache_policy=NO_CACHE)
def delete_user(client: GatewayClient, user_id: int) -> bool:
    return client.delete_user(user_id)


@task(cache_policy=NO_CACHE)
def confirm_deleted(client: GatewayClient, user_id: int) -> None:
    result = client.get_user(user_id)
    if result is not None:
        raise AssertionError(f"expected user {user_id} to be deleted, but it still exists")


@flow(log_prints=True)
def user_crud_test(gateway_url: str = "https://gateway.giomartins.dev", api_key: str = "") -> None:
    """Exercises the gateway's full User CRUD lifecycle against a real
    deployment — create, get, update, delete, then confirms the delete
    actually took. api_key's real value comes from the deployment's own
    parameters in prefect.yaml (`{{ prefect.blocks.secret.gateway-api-key }}`),
    same templating pattern as the OTel headers in job_variables — not
    loaded from within the flow itself, so this stays plain and
    testable without needing a Prefect server/blocks to unit test.
    """
    client = GatewayClient(base_url=gateway_url, api_key=api_key)

    unique = uuid.uuid4().hex[:8]
    payload = UserPayload(name=f"crud-test-{unique}", email=f"crud-test-{unique}@example.com")

    created = create_user(client, payload)
    logger.info(f"created user {created.id}")

    fetched = get_user(client, created.id)
    if fetched.name != payload.name:
        raise AssertionError(f"expected name {payload.name!r}, got {fetched.name!r}")

    updated = update_user(client, created.id, name=f"{payload.name}-updated")
    if updated.name != f"{payload.name}-updated":
        raise AssertionError(f"update did not apply, got {updated.name!r}")

    deleted = delete_user(client, created.id)
    if deleted is not True:
        raise AssertionError("delete reported failure")

    confirm_deleted(client, created.id)
    logger.info("user CRUD lifecycle test passed")


if __name__ == "__main__":
    user_crud_test()

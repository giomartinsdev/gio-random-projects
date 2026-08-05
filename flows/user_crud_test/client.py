"""Thin HTTP client for the gateway's User events. Prefect-agnostic — no
`@task`, no `prefect` import — so it's unit-testable with plain pytest
against a fake in-process gateway, same reasoning as every ETL class in
flows/greeting/etl/: flow.py wraps each call in a `@task`, this class
stays plain.
"""

from __future__ import annotations

import httpx

from flows.user_crud_test.schemas import UserPayload, UserResult


class GatewayClient:
    def __init__(self, base_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client()
        self._headers = {"X-API-Key": api_key}

    def create_user(self, payload: UserPayload) -> UserResult:
        response = self._client.post(
            f"{self._base_url}/events/create-user", json=payload.model_dump(), headers=self._headers
        )
        response.raise_for_status()
        return UserResult.model_validate(response.json())

    def get_user(self, user_id: int) -> UserResult | None:
        response = self._client.post(
            f"{self._base_url}/events/get-user", json={"id": user_id}, headers=self._headers
        )
        response.raise_for_status()
        data = response.json()
        return UserResult.model_validate(data) if data is not None else None

    def update_user(
        self, user_id: int, name: str | None = None, email: str | None = None
    ) -> UserResult | None:
        payload: dict[str, object] = {"id": user_id}
        if name is not None:
            payload["name"] = name
        if email is not None:
            payload["email"] = email
        response = self._client.post(
            f"{self._base_url}/events/update-user", json=payload, headers=self._headers
        )
        response.raise_for_status()
        data = response.json()
        return UserResult.model_validate(data) if data is not None else None

    def delete_user(self, user_id: int) -> bool:
        response = self._client.post(
            f"{self._base_url}/events/delete-user", json={"id": user_id}, headers=self._headers
        )
        response.raise_for_status()
        return bool(response.json())

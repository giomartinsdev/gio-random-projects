"""A scripted stand-in for domain-api, over ``httpx.MockTransport``.

The point is to reproduce the **documented** contract from
``modules/apps/domain-api/README.md`` and its ``openapi.yaml`` exactly --
202 accepted, /sync 200 written / 422 failed / 504 queued -- and to let a
test assert the request the ACL actually sent (path, header, body).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

QUEUED_DETAIL = (
    "worker did not finish the command within 10s — it stays queued and may "
    "still land"
)


@dataclass
class RecordedRequest:
    method: str
    path: str
    headers: dict[str, str]
    body: Any


@dataclass
class DomainApiStub:
    """A fake domain-api that returns whatever the test scripts."""

    status_code: int = 202
    body: Any = None
    raw_text: str | None = None
    raise_error: Exception | None = None
    # Every request the ACL made, in order, for assertions.
    requests: list[RecordedRequest] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        raw = request.content.decode() if request.content else ""
        try:
            parsed: Any = json.loads(raw) if raw else None
        except ValueError:
            parsed = raw
        self.requests.append(
            RecordedRequest(
                method=request.method,
                path=request.url.path,
                headers=dict(request.headers),
                body=parsed,
            )
        )
        if self.raise_error is not None:
            raise self.raise_error
        if self.raw_text is not None:
            return httpx.Response(
                self.status_code,
                text=self.raw_text,
                headers={"Content-Type": "application/json"},
            )
        return httpx.Response(self.status_code, json=self.body)

    def client(self) -> httpx.Client:
        return httpx.Client(
            base_url="http://domain-api.test",
            transport=httpx.MockTransport(self.handler),
        )

    # ------------------------------------------------------ scripted answers
    @classmethod
    def accepted(cls, command_id: str = "cmd-1") -> "DomainApiStub":
        return cls(status_code=202, body={"command_id": command_id, "status": "accepted"})

    @classmethod
    def written(cls, command_id: str = "cmd-1", entity_id: str = "tx-9") -> "DomainApiStub":
        return cls(
            status_code=200,
            body={"command_id": command_id, "status": "written", "entity_id": entity_id},
        )

    @classmethod
    def failed(cls, command_id: str = "cmd-1", error: str = 'unknown action: "finance.x"') -> "DomainApiStub":
        return cls(
            status_code=422,
            body={"command_id": command_id, "status": "failed", "error": error},
        )

    @classmethod
    def queued(cls, command_id: str = "cmd-1") -> "DomainApiStub":
        return cls(
            status_code=504,
            body={"command_id": command_id, "status": "queued", "error": QUEUED_DETAIL},
        )


def scripted(responder: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(
        base_url="http://domain-api.test", transport=httpx.MockTransport(responder)
    )

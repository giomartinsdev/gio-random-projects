"""Wiring: the composition root for the HTTP layer.

Kept apart from the routes so a test can build an app around a router with
a stubbed ``DomainApiPort`` and no configuration at all -- which is what
the component tests do, since they must not need a domain-api to exist.

Also home to the request-scoped dependencies (the container, the caller's
identity) so a route never reaches into ``app.state`` directly and the two
auth paths -- the worker's ``X-API-Key`` and the SPA's Google session -- live
in one place.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol

from fastapi import Request

from finance_api.application.commands import CommandRouter
from finance_api.application.reads import QueryRouter
from finance_api.domain.errors import UnauthorizedError
from finance_api.infrastructure.domain_api import DomainApiClient
from finance_api.infrastructure.google import GoogleIdentity, GoogleVerifier
from finance_api.presentation.security import authenticate
from finance_api.presentation.session import Session, identify


class GoogleTokenVerifier(Protocol):
    def verify(self, credential: str) -> GoogleIdentity: ...


@dataclass(frozen=True, slots=True)
class Container:
    """Everything the routes need, already assembled.

    ``queries`` is optional so the write-only component tests can build a
    container around a ``CommandRouter`` alone; a read route reached without
    it is a 500 (wiring bug), not a silent empty answer. ``google`` and the
    session settings are empty by default: the worker's ``X-API-Key`` path
    needs none of them, and the SPA login is simply disabled until the secrets
    exist in the stack.
    """

    router: CommandRouter
    api_keys: Mapping[str, str]
    queries: QueryRouter | None = None
    google: GoogleTokenVerifier | None = None
    google_client_id: str = ""
    session_secret: str = ""
    session_ttl_s: int = 30 * 24 * 3600


def build_container(
    *,
    domain_api_base_url: str,
    domain_api_key: str,
    api_keys: Mapping[str, str],
    timeout_s: float = 12.0,
    google_client_id: str = "",
    session_secret: str = "",
    session_ttl_s: int = 30 * 24 * 3600,
) -> Container:
    client = DomainApiClient(
        base_url=domain_api_base_url,
        api_key=domain_api_key,
        timeout_s=timeout_s,
    )
    return Container(
        router=CommandRouter(client),
        api_keys=api_keys,
        queries=QueryRouter(client),
        google=GoogleVerifier(google_client_id) if google_client_id else None,
        google_client_id=google_client_id,
        session_secret=session_secret,
        session_ttl_s=session_ttl_s,
    )


def build_container_with_router(
    router: CommandRouter,
    api_keys: Mapping[str, str],
    *,
    queries: QueryRouter | None = None,
    google: GoogleTokenVerifier | None = None,
    google_client_id: str = "",
    session_secret: str = "",
    session_ttl_s: int = 30 * 24 * 3600,
) -> Container:
    """For tests: a real container around an injected router."""
    return Container(
        router=router,
        api_keys=api_keys,
        queries=queries,
        google=google,
        google_client_id=google_client_id,
        session_secret=session_secret,
        session_ttl_s=session_ttl_s,
    )


# --------------------------------------------------------------- providers

def get_container(request: Request) -> Container:
    container = getattr(request.app.state, "container", None)
    if container is None:  # pragma: no cover - wiring bug, not a request case
        raise RuntimeError("application container is not configured")
    return container


def get_optional_session(request: Request) -> Session | None:
    """A sessão do SPA, se houver cookie válido. ``None`` quando deslogado.

    Assinatura de dependência do FastAPI (só o request); helpers internos que
    já têm o container usam ``session_from``.
    """
    return session_from(request, get_container(request))


def session_from(request: Request, container: Container) -> Session | None:
    """O mesmo, mas com o container em mãos (para chamadas internas)."""
    if not container.session_secret:
        return None
    return identify(dict(request.headers), container.session_secret)


def require_session(request: Request) -> Session:
    """A sessão do SPA ou 401. Para rotas que exigem login (as do dashboard)."""
    session = get_optional_session(request)
    if session is None:
        raise UnauthorizedError("faça login com o Google para continuar")
    return session


def caller_label(request: Request, container: Container) -> str:
    """Autentica o chamador (worker por ``X-API-Key`` OU SPA por sessão).

    Devolve um rótulo para a auditoria. O worker manda ``X-API-Key``; a SPA
    manda o cookie de sessão. Os dois caminhos convivem: a mesma rota aceita
    ambos, porque o comando é o mesmo e quem aplica é sempre o worker.
    """
    key_label = _try_api_key(request, container)
    if key_label is not None:
        return key_label
    session = session_from(request, container)
    if session is not None:
        return f"spa:{session.email}"
    raise UnauthorizedError("missing or invalid API key")


def _try_api_key(request: Request, container: Container) -> str | None:
    from finance_api.presentation.security import API_KEY_HEADER

    presented = request.headers.get(API_KEY_HEADER) or request.headers.get(API_KEY_HEADER.lower())
    if not presented:
        return None
    try:
        return authenticate(request.headers, container.api_keys)
    except UnauthorizedError:
        return None

"""Rotas de autenticação do SPA (§5).

Mesmo fluxo do ``clubs-api``: o SPA renderiza o botão do Google, manda o ID
token para ``POST /auth/google``, este serviço verifica, emite o cookie de
sessão, e ``GET /auth/me`` diz quem está logado. ``POST /auth/phone`` grava o
telefone (o ``user_id`` do ledger) na sessão — é o vínculo e-mail↔WhatsApp que o
usuário informa.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from finance_api.infrastructure.google import GoogleAuthError
from finance_api.presentation.dependencies import (
    Container,
    get_container,
    get_optional_session,
    require_session,
    session_from,
)
from finance_api.presentation.schemas import (
    GoogleLoginRequest,
    PhoneRequest,
    SessionResponse,
)
from finance_api.presentation.session import (
    SESSION_COOKIE_NAME,
    Session,
    clear_cookie_attributes,
    cookie_attributes,
    issue_session_cookie,
    normalize_phone,
)

auth_router = APIRouter(prefix="/auth")


def _session_response(status: int, session: Session, container: Container) -> JSONResponse:
    """Resposta com a sessão no corpo e o cookie no header."""
    value = issue_session_cookie(
        session, secret=container.session_secret, max_age=container.session_ttl_s
    )
    response = JSONResponse(
        status_code=status,
        content=SessionResponse(
            email=session.email, name=session.name, phone=session.phone
        ).model_dump(),
    )
    response.headers.append(
        "set-cookie",
        f"{SESSION_COOKIE_NAME}={value}; {cookie_attributes(container.session_ttl_s)}",
    )
    return response


@auth_router.post("/google")
def login_google(
    body: GoogleLoginRequest,
    request: Request,
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Troca o ID token do Google por uma sessão.

    Criação e login na mesma ação (não há cadastro): a sessão nasce só com o
    e-mail; o telefone entra depois em ``/auth/phone``. Relogar **preserva** o
    telefone que já estava na sessão — entrar de novo não pode desvincular o
    ledger que a pessoa informou.
    """
    if not container.google_client_id or container.google is None:
        return JSONResponse(status_code=500, content={"error": "login com Google não configurado"})
    try:
        identity = container.google.verify(body.credential)
    except GoogleAuthError as exc:
        return JSONResponse(status_code=401, content={"error": str(exc)})

    existing = session_from(request, container)
    phone = existing.phone if existing is not None else ""
    session = Session.from_google(email=identity.email, name=identity.name, phone=phone)
    return _session_response(200, session, container)


@auth_router.post("/phone")
def set_phone(
    body: PhoneRequest,
    session: Session = Depends(require_session),
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Vincula o telefone (user_id do ledger) à sessão logada."""
    phone = normalize_phone(body.phone)
    if not phone:
        return JSONResponse(
            status_code=422,
            content={"error": "informe um número com DDD, ex.: 5521981962914"},
        )
    updated = Session(email=session.email, name=session.name, phone=phone)
    return _session_response(200, updated, container)


@auth_router.get("/me")
def me(session: Session | None = Depends(get_optional_session)) -> JSONResponse:
    if session is None:
        return JSONResponse(status_code=200, content={"authenticated": False})
    return JSONResponse(
        status_code=200,
        content={
            "authenticated": True,
            "email": session.email,
            "name": session.name,
            "phone": session.phone,
        },
    )


@auth_router.post("/logout")
def logout() -> JSONResponse:
    response = JSONResponse(status_code=200, content={"status": "deslogado"})
    response.headers.append(
        "set-cookie", f"{SESSION_COOKIE_NAME}=; {clear_cookie_attributes()}"
    )
    return response

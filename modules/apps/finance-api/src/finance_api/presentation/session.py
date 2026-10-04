"""Sessão do SPA financeiro + identidade.

Espelha o desenho do ``clubs-api`` (``auth.go``/``session.go``): "Entrar com
Google" via Google Identity Services, ID token verificado contra o JWKS do
Google e contra o nosso client ID, e um cookie de sessão HttpOnly/Secure
assinado (HS256) por ``FINANCE_SESSION_SECRET``.

Diferença deliberada: aqui o cookie é **host-only** (sem ``Domain``). A SPA e a
API são origens distintas no mesmo host ``giomartins.dev`` (finance. e
finance-api.), então o cookie precisa de ``SameSite=None; Secure`` para o fetch
cross-origin mandá-lo — mas não precisa vazar para os outros subdomínios.

O ``user_id`` do ledger é o **telefone** (o mesmo que o WhatsApp usa). O login
prova o e-mail; o telefone é o dado que liga a conta ao histórico do bot.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import jwt

SESSION_COOKIE_NAME = "finance_session"
_JWT_ALG = "HS256"
# Telefone vira user_id: só dígitos (E.164 sem +). Espaços, parênteses, hífens e
# o "+" são removidos. O comprimento mínimo evita um "1" virar user_id.
_PHONE_MIN_DIGITS = 8


@dataclass(frozen=True, slots=True)
class Session:
    """Quem está logado e qual ledger é o dele."""

    email: str
    name: str
    phone: str

    @classmethod
    def from_google(cls, *, email: str, name: str, phone: str) -> "Session":
        return cls(email=email, name=name or _email_local(email), phone=normalize_phone(phone))


def normalize_phone(raw: str) -> str:
    """``"+55 (21) 98196-2914"`` -> ``"5521981962914"``.

    Um valor sem dígitos suficientes volta vazio: é melhor não vincular ledger
    nenhum do que apontar para um user_id improvável.
    """
    digits = re.sub(r"\D", "", raw or "")
    return digits if len(digits) >= _PHONE_MIN_DIGITS else ""


def _email_local(email: str) -> str:
    local, _, _ = email.partition("@")
    return local


def issue_session_cookie(session: Session, *, secret: str, max_age: int) -> str:
    """Assina a sessão e devolve o VALOR do cookie. Sem segredo, levanta."""
    if not secret:
        raise RuntimeError("sessão indisponível (FINANCE_SESSION_SECRET não configurado)")
    now = int(time.time())
    token = jwt.encode(
        {
            "email": session.email,
            "name": session.name,
            "phone": session.phone,
            "iat": now,
            "exp": now + max_age,
        },
        secret,
        algorithm=_JWT_ALG,
    )
    return token


def verify_session(token: str, secret: str) -> Session | None:
    """Verifica o cookie de sessão. ``None`` para expirado/adulterado/vazio."""
    if not token or not secret:
        return None
    try:
        claims = jwt.decode(token, secret, algorithms=[_JWT_ALG])
    except jwt.PyJWTError:
        return None
    email = str(claims.get("email", "")).strip()
    if not email:
        return None
    return Session(
        email=email,
        name=str(claims.get("name", "")) or _email_local(email),
        phone=str(claims.get("phone", "")),
    )


def identify(headers: dict, secret: str) -> Session | None:
    """Lê a sessão dos headers (cookie) e a verifica. ``None`` se não logado."""
    cookie = _read_cookie(headers, SESSION_COOKIE_NAME)
    return verify_session(cookie, secret)


def read_session_cookie(headers) -> str:
    """Expõe o valor bruto do cookie (usado pelos testes)."""
    return _read_cookie(headers, SESSION_COOKIE_NAME)


def _read_cookie(headers, name: str) -> str:
    raw = headers.get("cookie") or headers.get("Cookie") or ""
    for part in raw.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value
    return ""


def cookie_attributes(max_age: int) -> str:
    """Os atributos do cookie (sem o par nome=valor).

    ``SameSite=None; Secure`` porque a SPA chama esta API cross-origin. Sem
    ``Domain``: host-only, menos privilégio (a API e a SPA compartilham o host
    ``giomartins.dev``, mas o cookie só precisa valer no host da API).
    """
    return f"Path=/; Max-Age={max_age}; Secure; HttpOnly; SameSite=None"


def clear_cookie_attributes() -> str:
    return "Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None"


def clear_session_cookie() -> str:
    return f"{SESSION_COOKIE_NAME}=; {clear_cookie_attributes()}"

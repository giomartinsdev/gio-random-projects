"""SSO do SPA: verificação do ID token, sessão e derivação de identidade.

Mesmo desenho do clubs-api: o SPA renderiza o botão do Google, o Google devolve
um ID token, este serviço verifica o token (contra o JWKS do Google e contra o
nosso client ID) e emite um cookie de sessão assinado. O ``user_id`` do ledger é
o **telefone** que a pessoa informa (o mesmo que o WhatsApp usa) — o login só
prova quem é o dono da sessão; o vínculo e-mail↔telefone é dado da pessoa.

Testes com um verificador de token falso: o que se prova é a nossa lógica
(sessão, cookie, derivação), não a verificação do Google em si.
"""

from __future__ import annotations

import sys
from pathlib import Path

import jwt
import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_api.presentation.session import (  # noqa: E402
    SESSION_COOKIE_NAME,
    Session,
    clear_session_cookie,
    identify,
    issue_session_cookie,
    verify_session,
)

SECRET = "test-session-secret"


def test_issue_and_verify_roundtrip():
    session = Session(email="ana@corp.com", name="Ana", phone="5521981962914")
    token = _sign(session)
    got = verify_session(token, SECRET)
    assert got.email == "ana@corp.com"
    assert got.name == "Ana"
    assert got.phone == "5521981962914"


def test_verify_rejects_a_token_signed_with_another_secret():
    session = Session(email="ana@corp.com", name="Ana", phone="")
    token = _sign(session, secret="other")
    assert verify_session(token, SECRET) is None


def test_verify_rejects_expired():
    session = Session(email="ana@corp.com", name="Ana", phone="")
    token = jwt.encode({"email": session.email, "name": session.name, "exp": 1}, SECRET, algorithm="HS256")
    assert verify_session(token, SECRET) is None


def test_verify_rejects_garbage():
    assert verify_session("not.a.jwt", SECRET) is None
    assert verify_session("", SECRET) is None


def test_phone_must_be_numeric_ish_after_normalization():
    # O telefone informado vira user_id; normalizar tira o que não é dígito.
    session = Session.from_google(email="ana@corp.com", name="Ana", phone="+55 (21) 98196-2914")
    assert session.phone == "5521981962914"


def test_phone_is_empty_when_not_provided():
    assert Session.from_google(email="a@b.com", name="A", phone="").phone == ""


def _sign(session: Session, *, secret: str = SECRET) -> str:
    import time

    return jwt.encode(
        {
            "email": session.email,
            "name": session.name,
            "phone": session.phone,
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        },
        secret,
        algorithm="HS256",
    )

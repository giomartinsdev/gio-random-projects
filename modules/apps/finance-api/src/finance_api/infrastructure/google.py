"""Verificação do ID token do Google (a única coisa que confia no Google).

Isola a biblioteca ``google-auth`` atrás de uma função pura o bastante para ser
trocada nos testes: o resto do SSO (sessão, cookie, derivação de identidade) é
nosso e testado sem rede. Mesma checagem do ``clubs-api``: JWKS do Google **e**
o nosso client ID, mais ``email_verified``.
"""

from __future__ import annotations

from dataclasses import dataclass

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token


@dataclass(frozen=True, slots=True)
class GoogleIdentity:
    email: str
    name: str


class GoogleAuthError(Exception):
    """O token do Google é inválido, expirado ou não é para o nosso client ID."""


class GoogleVerifier:
    """Verifica o ``credential`` do Google Identity Services."""

    def __init__(self, client_id: str) -> None:
        # Vazio desabilita o login: verify sempre falha, e a rota responde 500
        # "não configurado" (o boot segue possível antes do segredo existir).
        self._client_id = client_id

    def verify(self, credential: str) -> GoogleIdentity:
        if not credential or not self._client_id:
            raise GoogleAuthError("token ausente ou login não configurado")
        try:
            payload = id_token.verify_oauth2_token(
                credential,
                google_requests.Request(),
                self._client_id,
            )
        except Exception as exc:  # noqa: BLE001 -- google-auth levanta tipos variados
            raise GoogleAuthError("token do Google inválido ou expirado") from exc

        email = str(payload.get("email", "")).strip().lower()
        if not email:
            raise GoogleAuthError("token do Google sem e-mail")
        # email_verified é o sinal do Google de que o endereço pertence à conta;
        # é a única checagem substantiva que a própria lib não faz. O Google já
        # mandou isso como bool e como a string "true" historicamente, então
        # aceitamos as duas formas.
        verified = payload.get("email_verified", False)
        if not (verified is True or verified == "true"):
            raise GoogleAuthError("e-mail do Google não verificado")
        name = str(payload.get("name", "")).strip()
        return GoogleIdentity(email=email, name=name)

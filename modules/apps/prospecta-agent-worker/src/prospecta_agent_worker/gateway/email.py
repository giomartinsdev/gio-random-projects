"""E-mail de saída (decisão D9, task T048).

A interface é ``EmailClient.send(to, subject, body, headers)`` -- o contrato do
adapter (research R6). O **provedor** é decisão do humano (SES vs Postmark vs
SMTP); por isso o worker só conhece a interface e o driver é escolhido por env.

- ``SmtpEmailClient`` -- um driver SMTP real (socket + handshake), usado nos
  testes de integração contra um servidor SMTP de verdade, e válido em produção
  para um relay SMTP. É o default quando ``EMAIL_PROVIDER=smtp``.
- ``FakeEmailClient`` -- um driver de teste em memória, para cenários em que o
  e-mail não é o objeto (mantém o worker montável sem um SMTP). Nunca em prod.
- ``SesEmailClient`` -- stub deliberado: levanta até a decisão D9 fechar e as
  credenciais (SPF/DKIM/DMARC, warmup, bounce) serem provisionadas. **Isto é a
  pergunta que precisa do humano** -- ver relatório final.

Nenhum driver de banco, nenhum broker próprio: o e-mail é uma borda HTTP/SMTP
como qualquer outra (§1.1).
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import Protocol, runtime_checkable


@runtime_checkable
class EmailClient(Protocol):
    """A porta do e-mail de saída (research R6)."""

    def send(self, to: str, subject: str, body: str, *, headers: dict[str, str] | None = None) -> dict:
        """Entrega um e-mail e devolve ``{"external_id": ...}``. Levanta em falha."""
        ...


class SmtpEmailClient:
    """Driver SMTP real. ``send`` abre socket, faz EHLO/MAIL/RCPT/DATA."""

    def __init__(
        self,
        *,
        host: str,
        port: int = 587,
        sender: str,
        username: str = "",
        password: str = "",
        starttls: bool = False,
        timeout: float = 15.0,
    ) -> None:
        self._host = host
        self._port = port
        self._sender = sender
        self._username = username
        self._password = password
        self._starttls = starttls
        self._timeout = timeout

    def send(self, to: str, subject: str, body: str, *, headers: dict[str, str] | None = None) -> dict:
        msg = EmailMessage()
        msg["From"] = self._sender
        msg["To"] = to
        msg["Subject"] = subject
        for key, value in (headers or {}).items():
            msg[key] = value
        msg.set_content(body)
        with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as smtp:
            smtp.ehlo()
            if self._starttls:
                smtp.starttls()
                smtp.ehlo()
            if self._username:
                smtp.login(self._username, self._password)
            smtp.send_message(msg)
        return {"external_id": msg.get("Message-ID") or f"smtp:{to}"}


class FakeEmailClient:
    """Driver em memória só para teste. Guarda o que saiu; nunca vai a prod."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, to: str, subject: str, body: str, *, headers: dict[str, str] | None = None) -> dict:
        external_id = f"fake-{len(self.sent) + 1}"
        self.sent.append(
            {"to": to, "subject": subject, "body": body, "headers": dict(headers or {}), "external_id": external_id}
        )
        return {"external_id": external_id}


class SesEmailClient:
    """Placeholder do driver SES -- **decisão D9 em aberto**.

    Implementar SES exige decidir antes: domínio verificado com SPF/DKIM/DMARC,
    warmup, tratamento de bounce/complaint e a credencial no Vault. Até lá, o
    adapter falha alto (nunca entrega em silêncio por um provedor não escolhido).
    """

    def send(self, to: str, subject: str, body: str, *, headers: dict[str, str] | None = None) -> dict:
        raise NotImplementedError(
            "D9 em aberto: escolher SES vs Postmark e provisionar SPF/DKIM/DMARC antes de usar o e-mail real"
        )


def build_email_client(provider: str, *, host: str = "", port: int = 587, sender: str = "", **kwargs) -> EmailClient:
    """Monta o driver de e-mail por env (``EMAIL_PROVIDER``)."""
    provider = (provider or "smtp").lower()
    if provider == "smtp":
        return SmtpEmailClient(host=host, port=port, sender=sender, **kwargs)
    if provider == "ses":
        return SesEmailClient()
    raise ValueError(f"EMAIL_PROVIDER desconhecido: {provider}")

"""Casos de uso do Open Finance na ACL (docs/openfinance-spec.md §7).

A ACL é onde o **ciclo do consentimento** acontece, porque ele é síncrono e
voltado ao usuário (criar → redirecionar ao banco → reler status → revogar). Mas
a ACL não tem banco (§1.1): cada mutação vira um comando ``finance.openfinance.*``
publicado no domain-api, aplicado pelo domain-worker.

O cliente do provedor (Polp) é a única coisa que fala com o Polp; este módulo só
orquestra (chama o provedor, monta o comando, publica).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from finance_api.application.commands import RELAY_MODE_ASYNC
from finance_api.domain.errors import ValidationError
from finance_contracts import (
    ACTION_OF_CONSENT_CREATED,
    ACTION_OF_CONSENT_UPDATED,
)

# Só os produtos que o ledger do finance usa hoje (conta + extrato). Cartão,
# empréstimo e investimento ficam fora do escopo v1 (spec §1).
OF_PRODUCTS = ["ACCOUNT"]


class DomainApiPort(Protocol):
    def send_async(self, envelope: Any) -> Any: ...


@dataclass(frozen=True, slots=True)
class ConsentCreated:
    """O resultado de conectar uma conta: o id e a URL do banco."""

    consent_id: str
    status: str
    url_to_authenticate: str
    institution_name: str


class OpenFinanceService:
    def __init__(self, polp: Any, commands: Any) -> None:
        # ``polp`` = PolpClient; ``commands`` = CommandRouter (relaya o comando).
        self._polp = polp
        self._commands = commands

    def configured(self) -> bool:
        return bool(getattr(self._polp, "configured", False))

    def institutions(self, *, query: str = "") -> list[Mapping[str, Any]]:
        """Lista as instituições do provedor, filtrando por nome quando pedido."""
        items = self._polp.institutions()
        if not query:
            return items
        needle = query.strip().lower()
        return [i for i in items if needle in str(i.get("name", "")).lower()]

    def connect(self, *, user_id: str, institution_id: str, cpf: str, cnpj: str = "", institution_name: str = "") -> ConsentCreated:
        """Cria o consentimento no provedor e publica ``consentCreated``."""
        if not user_id:
            raise ValidationError("vincule seu número do WhatsApp antes de conectar")
        if not institution_id:
            raise ValidationError("escolha uma instituição")
        if not cpf:
            raise ValidationError("informe o CPF do titular")
        consent = self._polp.create_consent(
            institution_id=institution_id, cpf=cpf, cnpj=cnpj, user_id=user_id, products=OF_PRODUCTS
        )
        polp_id = str(consent.get("id", ""))
        if not polp_id:
            raise ValidationError("o provedor não devolveu o id do consentimento")
        # O create/show do Polp NÃO devolve o nome da instituição — o SPA já o
        # tem da lista e o passa. Fallback: o que o provedor mandar (vazio).
        name = institution_name or str(consent.get("institution_name", ""))
        self._commands.relay(
            ACTION_OF_CONSENT_CREATED,
            {
                "user_id": user_id,
                "polp_consent_id": polp_id,
                "institution_id": institution_id,
                "institution_name": name,
                "status": str(consent.get("status", "AWAITING_AUTHORIZATION")),
                "execution_status": str(consent.get("execution_status", "") or ""),
                "products": consent.get("products") or OF_PRODUCTS,
                "url_to_authenticate": str(consent.get("url_to_authenticate", "") or ""),
                "url_expires_at": str(consent.get("url_to_authenticate_expires_at", "") or ""),
            },
            mode=RELAY_MODE_ASYNC,
        )
        return ConsentCreated(
            consent_id=polp_id,
            status=str(consent.get("status", "AWAITING_AUTHORIZATION")),
            url_to_authenticate=str(consent.get("url_to_authenticate", "") or ""),
            institution_name=name,
        )

    def refresh(self, *, polp_consent_id: str) -> Mapping[str, Any]:
        """Relê o consentimento no provedor e publica ``consentUpdated``.

        É como o SPA descobre que o usuário autorizou no banco (de
        ``AWAITING_AUTHORIZATION`` para ``AUTHORISED``) sem depender do webhook.
        """
        consent = self._polp.consent(polp_consent_id)
        status = str(consent.get("status", ""))
        execution = str(consent.get("execution_status", "") or "")
        self._commands.relay(
            ACTION_OF_CONSENT_UPDATED,
            {"polp_consent_id": polp_consent_id, "status": status, "execution_status": execution},
            mode=RELAY_MODE_ASYNC,
        )
        return consent

    def revoke(self, *, polp_consent_id: str) -> None:
        """Revoga no provedor e publica o estado novo (EXPIRED)."""
        self._polp.revoke_consent(polp_consent_id)
        self._commands.relay(
            ACTION_OF_CONSENT_UPDATED,
            {"polp_consent_id": polp_consent_id, "status": "EXPIRED", "execution_status": ""},
            mode=RELAY_MODE_ASYNC,
        )

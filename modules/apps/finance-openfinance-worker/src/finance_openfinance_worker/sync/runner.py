"""O loop de sincronização do conector (docs/openfinance-spec.md §8).

Lê os consentimentos do provedor, e para cada um autorizado: publica o comando
de conta (``accountSynced``) e, por conta, busca as transações e as publica
(``register`` com source=OPEN_FINANCE_SYNC). Não tem banco: o cursor de
``updated_at`` vive em memória e reinicia no boot; o backfill inicial
(``OF_BACKFILL_DAYS``) mais a idempotência por ``external_id`` tornam o
reprocessamento seguro.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from finance_contracts import ACTION_OF_ACCOUNT_SYNCED, ACTION_REGISTER_TRANSACTION

from finance_openfinance_worker.sync.mapping import transaction_to_command

log = logging.getLogger("finance-openfinance-worker")

# Contas vêm com o consentimento; guardamos o cursor por conta em memória.
_Cursor = dict[str, str]


class Syncer:
    def __init__(self, *, polp: Any, finance: Any, backfill_days: int = 30) -> None:
        self._polp = polp
        self._finance = finance
        self._backfill_days = backfill_days
        self._cursor: _Cursor = {}
        # Contas já vistas: a PRIMEIRA sincronização de uma conta é o backfill
        # (o histórico que vem ao conectar). Ela é marcada ``historical`` e o
        # worker conversacional NÃO notifica — senão conectar espalha centenas
        # de mensagens. Do segundo poll em diante, o que chega é do dia a dia e
        # notifica.
        self._seen_accounts: set[str] = set()

    def run_once(self) -> dict[str, int]:
        """Uma passada completa. Devolve contadores para o log."""
        counts = {"consents": 0, "accounts": 0, "transactions": 0}
        for consent in self._polp.consents():
            if str(consent.get("status", "")) != "AUTHORISED":
                continue
            counts["consents"] += 1
            consent_id = str(consent.get("id", ""))
            user_id = str(consent.get("cliente_user_id") or "")
            if not user_id:
                # Sem correlação não há a quem atribuir — pula sem erro.
                log.warning("consent %s sem cliente_user_id; pulando", consent_id)
                continue
            for account in self._polp.consent_accounts(consent_id):
                counts["accounts"] += 1
                counts["transactions"] += self._sync_account(account, user_id=user_id)
        return counts

    def _sync_account(self, account: Mapping[str, Any], *, user_id: str) -> int:
        polp_account_id = str(account.get("id", ""))
        if not polp_account_id:
            return 0
        self._publish_account(account, user_id=user_id)
        return self._sync_transactions(polp_account_id, user_id=user_id)

    def _publish_account(self, account: Mapping[str, Any], *, user_id: str) -> None:
        balance = account.get("balance") or {}
        available = balance.get("available_amount") if isinstance(balance, Mapping) else None
        self._finance.submit(
            ACTION_OF_ACCOUNT_SYNCED,
            {
                "user_id": user_id,
                "polp_consent_id": str(account.get("consent_id", "")),
                "polp_account_id": str(account.get("id", "")),
                "name": _account_name(account),
                "account_type": str(account.get("type", "")),
                "currency": str(account.get("currency", "BRL") or "BRL"),
                "balance_amount": _balance_str(available),
                "balance_updated_at": str(balance.get("updated_at", "") if isinstance(balance, Mapping) else ""),
            },
        )

    def _sync_transactions(self, account_id: str, *, user_id: str) -> int:
        # A primeira vez que vemos esta conta é o backfill inicial (histórico):
        # silencioso. Depois, o incremental (dia a dia): notifica.
        first = account_id not in self._seen_accounts
        params = self._window(account_id, first=first)
        published = 0
        for tx in self._polp.account_transactions(account_id, params):
            command = transaction_to_command(tx, user_id=user_id, of_account_id=account_id)
            if command is None:
                continue
            command["historical"] = first
            try:
                self._finance.submit(ACTION_REGISTER_TRANSACTION, command)
                published += 1
            except Exception as exc:  # noqa: BLE001 -- uma transação ruim não para o lote
                log.error("falha ao publicar transação %s: %s", command.get("external_id"), exc)
        # Avança o cursor: o próximo poll pega só o que mudou depois de agora.
        # Sem isto, cada passada refaria o backfill inteiro.
        self._seen_accounts.add(account_id)
        self._cursor[account_id] = datetime.now(timezone.utc).isoformat()
        return published

    def _window(self, account_id: str, *, first: bool) -> dict[str, str]:
        """Janela de busca.

        - Primeira passada (backfill): por DATA da transação, os últimos
          ``backfill_days`` — assim o histórico que o banco já tinha ao conectar
          entra todo de uma vez (e silencioso).
        - Incremental: por ``created_at`` (``fromCreatedAt``), do cursor até
          agora — só o que é genuinamente novo. Filtra por created_at, não por
          updated_at, para uma atualização de enriquecimento não re-notificar
          uma transação antiga.
        """
        now = datetime.now(timezone.utc).isoformat()
        if first:
            since = (datetime.now(timezone.utc) - timedelta(days=self._backfill_days)).isoformat()
            return {"fromDate": since, "toDate": now}
        since = self._cursor.get(account_id) or (datetime.now(timezone.utc) - timedelta(days=self._backfill_days)).isoformat()
        return {"fromCreatedAt": since, "toCreatedAt": now}


def _account_name(account: Mapping[str, Any]) -> str:
    # O Polp não manda um "nome"; compomos do tipo + agência/conta.
    kind = str(account.get("type", "")).replace("CONTA_", "").replace("_", " ").title()
    branch = str(account.get("branch_code", ""))
    number = str(account.get("number", ""))
    tail = f" · {branch}/{number}".rstrip("/") if (branch or number) else ""
    return f"{kind}{tail}".strip() or "Conta"


def _balance_str(available: Mapping[str, Any] | None) -> str:
    from finance_openfinance_worker.sync.mapping import amount_decimal

    return amount_decimal(available) if available else ""

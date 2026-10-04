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
        params = self._window(account_id)
        published = 0
        for tx in self._polp.account_transactions(account_id, params):
            command = transaction_to_command(tx, user_id=user_id, of_account_id=account_id)
            if command is None:
                continue
            try:
                self._finance.submit(ACTION_REGISTER_TRANSACTION, command)
                published += 1
            except Exception as exc:  # noqa: BLE001 -- uma transação ruim não para o lote
                log.error("falha ao publicar transação %s: %s", command.get("external_id"), exc)
        return published

    def _window(self, account_id: str) -> dict[str, str]:
        """Janela de busca: do cursor (ou do backfill) até agora."""
        since = self._cursor.get(account_id)
        if not since:
            since = (datetime.now(timezone.utc) - timedelta(days=self._backfill_days)).isoformat()
        # Filtra por updated_at: pega tanto novas quanto atualizadas (o
        # enriquecimento de categoria/counterparty muda o registro).
        now = datetime.now(timezone.utc).isoformat()
        return {"fromUpdatedAt": since, "toUpdatedAt": now}


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

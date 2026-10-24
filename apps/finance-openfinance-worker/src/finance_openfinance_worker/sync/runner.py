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

from finance_contracts import (
    ACTION_INVESTMENT_SYNCED,
    ACTION_INVESTMENT_TRANSACTION_SYNCED,
    ACTION_OF_ACCOUNT_SYNCED,
    ACTION_OF_BILL_SYNCED,
    ACTION_OF_CREDIT_CARD_SYNCED,
    ACTION_OF_EXCHANGE_SYNCED,
    ACTION_OF_FINANCING_SYNCED,
    ACTION_OF_LOAN_SYNCED,
    ACTION_OF_RAW_SYNCED,
    ACTION_REGISTER_TRANSACTION,
)

from finance_openfinance_worker.sync.mapping import (
    bill_to_command,
    credit_card_to_command,
    exchange_to_command,
    financing_to_command,
    investment_to_command,
    investment_transaction_to_command,
    loan_to_command,
    raw_to_command,
    transaction_to_command,
)

log = logging.getLogger("finance-openfinance-worker")

# Contas vêm com o consentimento; guardamos o cursor por conta em memória.
_Cursor = dict[str, str]


class Syncer:
    def __init__(self, *, polp: Any, finance: Any, backfill_days: int = 365) -> None:
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
        counts = {
            "consents": 0, "accounts": 0, "transactions": 0, "investments": 0,
            "credit_cards": 0, "bills": 0, "loans": 0, "financings": 0,
            "exchanges": 0, "investment_transactions": 0, "raw": 0,
        }
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
            # Raw do próprio consentimento (captura tudo, sem exceção).
            counts["raw"] += self._capture_raw(consent, user_id=user_id, resource="consents", external_id=consent_id)
            for account in self._polp.consent_accounts(consent_id):
                counts["accounts"] += 1
                acct_id = str(account.get("id", ""))
                counts["raw"] += self._capture_raw(account, user_id=user_id, resource="accounts", external_id=acct_id)
                for reserved in self._polp.account_reserved_balances(acct_id):
                    counts["raw"] += self._capture_raw(reserved, user_id=user_id, resource="accounts.reserved-balances",
                                                       external_id=str(reserved.get("id", acct_id) or acct_id))
                counts["transactions"] += self._sync_account(account, user_id=user_id, counts=counts)
            counts["investments"] += self._sync_investments(consent_id, user_id=user_id)
            counts["credit_cards"] += self._sync_credit_cards(consent_id, user_id=user_id, counts=counts)
            counts["loans"] += self._sync_contracts(
                self._polp.loans(consent_id), ACTION_OF_LOAN_SYNCED, loan_to_command,
                user_id=user_id, consent_id=consent_id, resource="loans", counts=counts,
            )
            counts["financings"] += self._sync_contracts(
                self._polp.financings(consent_id), ACTION_OF_FINANCING_SYNCED, financing_to_command,
                user_id=user_id, consent_id=consent_id, resource="financings", counts=counts,
            )
            counts["exchanges"] += self._sync_exchanges(consent_id, user_id=user_id, counts=counts)
        return counts

    def _capture_raw(self, item: Mapping[str, Any], *, user_id: str, resource: str, external_id: str) -> int:
        """Grava o JSON cru. Falha de raw NUNCA derruba o sync (é extra)."""
        if not external_id:
            return 0
        try:
            self._finance.submit(
                ACTION_OF_RAW_SYNCED,
                raw_to_command(item, user_id=user_id, consent_id=str(item.get("consent_id", "") or ""),
                               resource=resource, external_id=external_id),
            )
            return 1
        except Exception as exc:  # noqa: BLE001
            log.error("falha ao capturar raw %s/%s: %s", resource, external_id, exc)
            return 0

    def _sync_account(self, account: Mapping[str, Any], *, user_id: str, counts: dict[str, int] | None = None) -> int:
        polp_account_id = str(account.get("id", ""))
        if not polp_account_id:
            return 0
        self._publish_account(account, user_id=user_id)
        return self._sync_transactions(polp_account_id, user_id=user_id, counts=counts)

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

    def _sync_transactions(self, account_id: str, *, user_id: str, counts: dict[str, int] | None = None) -> int:
        # A primeira vez que vemos esta conta é o backfill inicial (histórico):
        # silencioso. Depois, o incremental (dia a dia): notifica.
        first = account_id not in self._seen_accounts
        params = self._window(account_id, first=first)
        published = 0
        for tx in self._polp.account_transactions(account_id, params):
            # Raw sempre, mesmo que o mapeamento mude depois — nada se perde.
            captured = self._capture_raw(tx, user_id=user_id, resource="accounts.transactions",
                                         external_id=str(tx.get("id", "") or ""))
            if counts is not None:
                counts["raw"] += captured
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

    def _sync_investments(self, consent_id: str, *, user_id: str) -> int:
        """Investimentos do consentimento: posições (upsert por polp_invest_id)."""
        published = 0
        for inv in self._polp.investments(consent_id):
            command = investment_to_command(inv, user_id=user_id, consent_id=consent_id)
            if command is None:
                continue
            try:
                self._finance.submit(ACTION_INVESTMENT_SYNCED, command)
                published += 1
            except Exception as exc:  # noqa: BLE001 - um ativo ruim não para o lote
                log.error("falha ao publicar investimento %s: %s", command.get("polp_invest_id"), exc)
            self._capture_raw(inv, user_id=user_id, resource="investments",
                              external_id=str(inv.get("id", "") or ""))
            # Movimentações do ativo (aplicação/resgate/rendimento): é o
            # rendimento REAL, em vez do bruto-investido derivado na tela.
            published += self._sync_investment_transactions(inv, user_id=user_id, consent_id=consent_id)
        return published

    def _sync_investment_transactions(self, inv: Mapping[str, Any], *, user_id: str, consent_id: str) -> int:
        family = str(inv.get("_family", ""))
        invest_id = str(inv.get("id", "") or "")
        if not family or not invest_id:
            return 0
        published = 0
        for tx in self._polp.investment_transactions(invest_id, family=family):
            command = investment_transaction_to_command(
                tx, user_id=user_id, consent_id=consent_id, invest_id=invest_id, family=family
            )
            if command is None:
                continue
            try:
                self._finance.submit(ACTION_INVESTMENT_TRANSACTION_SYNCED, command)
                published += 1
            except Exception as exc:  # noqa: BLE001
                log.error("falha ao publicar movimentação de investimento %s: %s", command.get("polp_tx_id"), exc)
            self._capture_raw(tx, user_id=user_id, resource="investments.transactions",
                              external_id=str(tx.get("id", "") or ""))
        return published

    def _sync_credit_cards(self, consent_id: str, *, user_id: str, counts: dict[str, int]) -> int:
        published = 0
        for card in self._polp.credit_cards(consent_id):
            card_id = str(card.get("id", "") or "")
            command = credit_card_to_command(card, user_id=user_id, consent_id=consent_id)
            if command is not None:
                try:
                    self._finance.submit(ACTION_OF_CREDIT_CARD_SYNCED, command)
                    published += 1
                except Exception as exc:  # noqa: BLE001
                    log.error("falha ao publicar cartão %s: %s", card_id, exc)
            counts["raw"] += self._capture_raw(card, user_id=user_id, resource="credit_cards", external_id=card_id)
            if card_id:
                counts["bills"] += self._sync_bills(card_id, user_id=user_id, consent_id=consent_id, counts=counts)
        return published

    def _sync_bills(self, card_id: str, *, user_id: str, consent_id: str, counts: dict[str, int]) -> int:
        published = 0
        for bill in self._polp.bills(card_id):
            command = bill_to_command(bill, user_id=user_id, consent_id=consent_id, card_id=card_id)
            if command is not None:
                try:
                    self._finance.submit(ACTION_OF_BILL_SYNCED, command)
                    published += 1
                except Exception as exc:  # noqa: BLE001
                    log.error("falha ao publicar fatura %s: %s", command.get("polp_bill_id"), exc)
            counts["raw"] += self._capture_raw(bill, user_id=user_id, resource="bills",
                                               external_id=str(bill.get("id", "") or ""))
        return published

    def _sync_contracts(self, rows, action, mapper, *, user_id: str, consent_id: str, resource: str, counts: dict[str, int]) -> int:
        published = 0
        for row in rows:
            command = mapper(row, user_id=user_id, consent_id=consent_id)
            if command is not None:
                try:
                    self._finance.submit(action, command)
                    published += 1
                except Exception as exc:  # noqa: BLE001
                    log.error("falha ao publicar %s %s: %s", resource, row.get("id"), exc)
            counts["raw"] += self._capture_raw(row, user_id=user_id, resource=resource,
                                               external_id=str(row.get("id", "") or ""))
        return published

    def _sync_exchanges(self, consent_id: str, *, user_id: str, counts: dict[str, int]) -> int:
        published = 0
        for row in self._polp.exchanges(consent_id):
            command = exchange_to_command(row, user_id=user_id, consent_id=consent_id)
            if command is not None:
                try:
                    self._finance.submit(ACTION_OF_EXCHANGE_SYNCED, command)
                    published += 1
                except Exception as exc:  # noqa: BLE001
                    log.error("falha ao publicar câmbio %s: %s", row.get("id"), exc)
            counts["raw"] += self._capture_raw(row, user_id=user_id, resource="exchanges",
                                               external_id=str(row.get("id", "") or ""))
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

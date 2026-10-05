"""The worker's commands, validated, plus the invariants the ACL owns.

The ACL is the last place that can say "no" before a command becomes a
``finance.*`` envelope for ``domain-api``. Everything here runs before the
relay, so a malformed command costs a 422 and no round trip, and the
worker's user sees a real reason instead of a rejected write later.

Invariants covered here (§3.4), each with the test that proves it:

- #1 ``Money`` never a float, exact ``Decimal`` sums -> domain/money.py
- #2 transfer is atomic: debit and credit in the *same* unit of work
- #3 no transaction touches another ``User``'s account balance
- #4 ``OccurredAt`` tz-aware, stored in UTC -> domain/occurred_at.py
- #5 a ``Budget`` ruler fires once per threshold per period
- #6 audited on success *and* failure -> that is domain-api/worker's
  audit row, and §1.1 keeps it there: the ACL must not pretend to
  guarantee it locally, only to never swallow the outcome
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Final, Mapping

from finance_api.domain.errors import ValidationError
from finance_api.domain.money import Money, MoneyError
from finance_api.domain.occurred_at import TimestampError, parse_occurred_at

TRANSACTION_TYPES: Final = frozenset({"INCOME", "EXPENSE", "TRANSFER"})
# Fontes manuais e automáticas. WEB_MANUAL é o SPA (§5): lançamento manual, mas
# por outro canal que não o WhatsApp — mantê-los distintos deixa o extrato
# dizer de onde veio cada linha.
SOURCES: Final = frozenset({"WHATSAPP_MANUAL", "WEB_MANUAL", "OPEN_FINANCE_SYNC"})
BUDGET_THRESHOLDS: Final = (50, 80, 100)

# UUIDv7 is what the spec asks for (§3.2), but the ACL does not mint ids:
# domain-api owns the command id and the worker owns entity ids. The ACL
# only checks that an id it is handed is non-empty and bounded, so a
# malformed id cannot reach the audit log looking authoritative.
ID_MAX_LENGTH: Final = 128


def _require_id(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field_name} is required")
    text = value.strip()
    if len(text) > ID_MAX_LENGTH:
        raise ValidationError(f"{field_name} exceeds {ID_MAX_LENGTH} characters")
    return text


def _require_choice(value: object, allowed: frozenset[str], field_name: str) -> str:
    if not isinstance(value, str) or value.strip().upper() not in allowed:
        raise ValidationError(
            f"{field_name} must be one of {sorted(allowed)}, got {value!r}"
        )
    return value.strip().upper()


def _require_mapping(value: object, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValidationError(f"{field_name} must be an object")
    return value


def _optional_text(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field_name} must be a string when present")
    text = value.strip()
    # Um campo opcional vazio ("") significa ausente, não erro: o conector do
    # Open Finance manda "" para counterparty/categoria quando o provedor não
    # enriqueceu, e recusar isso derrubaria o import.
    return text or None
    return value.strip()


@dataclass(frozen=True, slots=True)
class RegisterTransactionCommand:
    """``Gastei 45 no almoço hoje`` -> one ledger entry."""

    user_id: str
    account_id: str
    transaction_type: str
    money: Money
    occurred_at: datetime
    category: str
    source_type: str = "WHATSAPP_MANUAL"
    external_id: str | None = None
    of_account_id: str | None = None
    counterparty: str | None = None
    external_category: str | None = None
    description: str | None = None
    historical: bool = False

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "RegisterTransactionCommand":
        data = _require_mapping(payload, "payload")
        try:
            money = Money.from_wire(data.get("amount"), data.get("currency", "BRL"))
        except MoneyError as exc:
            raise ValidationError(str(exc)) from exc
        try:
            occurred_at = parse_occurred_at(data.get("occurred_at"))
        except TimestampError as exc:
            raise ValidationError(str(exc)) from exc
        return cls(
            user_id=_require_id(data.get("user_id"), "user_id"),
            account_id=_require_id(data.get("account_id"), "account_id"),
            transaction_type=_require_choice(
                data.get("transaction_type"), TRANSACTION_TYPES, "transaction_type"
            ),
            money=money,
            occurred_at=occurred_at,
            category=_require_id(data.get("category"), "category"),
            source_type=_require_choice(
                data.get("source_type", "WHATSAPP_MANUAL"), SOURCES, "source_type"
            ),
            external_id=_optional_text(data.get("external_id"), "external_id"),
            of_account_id=_optional_text(data.get("of_account_id"), "of_account_id"),
            counterparty=_optional_text(data.get("counterparty"), "counterparty"),
            external_category=_optional_text(data.get("external_category"), "external_category"),
            description=_optional_text(data.get("description"), "description"),
            historical=bool(data.get("historical", False)),
        )

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "user_id": self.user_id,
            "account_id": self.account_id,
            "transaction_type": self.transaction_type,
            "amount": self.money.to_wire(),
            "currency": self.money.currency,
            "category": self.category,
            "occurred_at": self.occurred_at.isoformat(),
            "source_type": self.source_type,
        }
        # Campos do Open Finance: repassados só quando presentes, para o
        # domain-worker gravar external_id/counterparty/categoria do provedor.
        for key, value in (
            ("external_id", self.external_id),
            ("of_account_id", self.of_account_id),
            ("counterparty", self.counterparty),
            ("external_category", self.external_category),
            ("description", self.description),
        ):
            if value is not None:
                payload[key] = value
        # O histórico (backfill do Open Finance) é sempre repassado, mesmo
        # False, para o worker saber que é dia a dia e notificar.
        payload["historical"] = self.historical
        return payload


@dataclass(frozen=True, slots=True)
class TransferBetweenAccountsCommand:
    """Invariants #2 and #3.

    #2 (atomicity): the two legs are one *command*, not two -- the worker
    the spec delegates to applies both in a single unit of work, so a
    failure on the credit cannot leave the debit applied. The ACL's job is
    to never split them: this class has no representation of "just one
    leg", and the payload carries both accounts together.

    #3 (isolation): both accounts must belong to the **same** ``User``.
    Crossing users is refused here, before the relay, so a mixed-owner
    transfer cannot even reach the worker.
    """

    user_id: str
    from_account_id: str
    to_account_id: str
    money: Money
    occurred_at: datetime
    description: str | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "TransferBetweenAccountsCommand":
        data = _require_mapping(payload, "payload")
        try:
            money = Money.from_wire(data.get("amount"), data.get("currency", "BRL"))
        except MoneyError as exc:
            raise ValidationError(str(exc)) from exc
        try:
            occurred_at = parse_occurred_at(data.get("occurred_at"))
        except TimestampError as exc:
            raise ValidationError(str(exc)) from exc

        from_account = _require_id(data.get("from_account_id"), "from_account_id")
        to_account = _require_id(data.get("to_account_id"), "to_account_id")
        if from_account == to_account:
            raise ValidationError("from_account_id and to_account_id must differ")

        # #3: the per-account owner map is what makes "same User" checkable.
        # When the caller sends it, we enforce it; when it is absent we
        # cannot prove it, and an unprovable isolation claim is a bug, so
        # the command is refused rather than relayed on trust.
        owners = data.get("account_owners")
        user_id = _require_id(data.get("user_id"), "user_id")
        if owners is None:
            raise ValidationError(
                "account_owners is required for a transfer: the ACL must prove "
                "both accounts belong to the same user (invariant §3.4-3)"
            )
        owners_map = _require_mapping(owners, "account_owners")
        for account_id in (from_account, to_account):
            owner = owners_map.get(account_id)
            if owner is None:
                raise ValidationError(f"account_owners has no entry for {account_id}")
            if owner != user_id:
                raise ValidationError(
                    f"account {account_id} belongs to user {owner!r}, not {user_id!r}: "
                    "a transfer may not move money across users (invariant §3.4-3)"
                )

        if money.is_negative() or money.is_zero():
            # A "transfer" of a negative amount is a transfer backwards,
            # which is a different command with different intent. Refusing
            # keeps direction in the account fields only.
            raise ValidationError("transfer amount must be positive")

        return cls(
            user_id=user_id,
            from_account_id=from_account,
            to_account_id=to_account,
            money=money,
            occurred_at=occurred_at,
            description=_optional_text(data.get("description"), "description"),
        )

    def to_payload(self) -> dict[str, Any]:
        # Both legs in ONE object: there is no partial form of this.
        payload: dict[str, Any] = {
            "user_id": self.user_id,
            "from_account_id": self.from_account_id,
            "to_account_id": self.to_account_id,
            "amount": self.money.to_wire(),
            "currency": self.money.currency,
            "occurred_at": self.occurred_at.isoformat(),
        }
        if self.description is not None:
            payload["description"] = self.description
        return payload


@dataclass(frozen=True, slots=True)
class SetCategoryBudgetCommand:
    """A monthly limit per category, with the 50/80/100 ruler (§3.3)."""

    user_id: str
    category: str
    limit: Money
    period: str
    thresholds: tuple[int, ...] = BUDGET_THRESHOLDS

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "SetCategoryBudgetCommand":
        data = _require_mapping(payload, "payload")
        try:
            limit = Money.from_wire(data.get("limit"), data.get("currency", "BRL"))
        except MoneyError as exc:
            raise ValidationError(str(exc)) from exc
        if limit.is_negative() or limit.is_zero():
            raise ValidationError("budget limit must be positive")

        period = _require_id(data.get("period"), "period")
        # ``YYYY-MM``: the period is half of the "once per threshold per
        # period" key, so a loose format would make the key unstable.
        if len(period) != 7 or period[4] != "-" or not (
            period[:4].isdigit() and period[5:].isdigit()
        ):
            raise ValidationError(f"period must be 'YYYY-MM', got {period!r}")

        raw_thresholds = data.get("thresholds", list(BUDGET_THRESHOLDS))
        if not isinstance(raw_thresholds, (list, tuple)) or not raw_thresholds:
            raise ValidationError("thresholds must be a non-empty list")
        thresholds: list[int] = []
        for value in raw_thresholds:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationError("thresholds must be integers")
            if value not in BUDGET_THRESHOLDS:
                raise ValidationError(
                    f"threshold {value} is not a documented ruler step "
                    f"{list(BUDGET_THRESHOLDS)}"
                )
            thresholds.append(value)

        return cls(
            user_id=_require_id(data.get("user_id"), "user_id"),
            category=_require_id(data.get("category"), "category"),
            limit=limit,
            period=period,
            thresholds=tuple(sorted(set(thresholds))),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "category": self.category,
            "limit": self.limit.to_wire(),
            "currency": self.limit.currency,
            "period": self.period,
            "thresholds": list(self.thresholds),
        }


@dataclass(frozen=True, slots=True)
class CategorizeTransactionCommand:
    """Attach a category to something already written."""

    user_id: str
    entity_id: str
    category: str

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "CategorizeTransactionCommand":
        data = _require_mapping(payload, "payload")
        return cls(
            user_id=_require_id(data.get("user_id"), "user_id"),
            entity_id=_require_id(data.get("entity_id"), "entity_id"),
            category=_require_id(data.get("category"), "category"),
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "entity_id": self.entity_id,
            "category": self.category,
        }


@dataclass(frozen=True, slots=True)
class UpdateTransactionCommand:
    """``finance.transaction.update`` — correção do dono (payload parcial).

    Campos ausentes mantêm o valor atual no worker. O amount, quando vem, é
    o valor ABSOLUTO (o worker decide o sinal pelo tipo) e a moeda segue o
    padrão BRL se não vier (a correção troca de moeda é caso raro e suportado).
    O worker também exige transaction_type quando amount muda o sentido do
    gasto; aqui aceitamos os dois campos como patch.
    """

    user_id: str
    transaction_id: str
    category: str | None = None
    counterparty: str | None = None
    description: str | None = None
    amount: Money | None = None
    transaction_type: str | None = None
    occurred_at: datetime | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "UpdateTransactionCommand":
        data = _require_mapping(payload, "payload")
        amount = None
        if data.get("amount") not in (None, ""):
            try:
                money = Money.from_wire(data.get("amount"), data.get("currency", "BRL"))
            except MoneyError as exc:
                raise ValidationError(str(exc)) from exc
            # a borda manda o valor ABSOLUTO: quem decide o sinal é o worker
            amount = Money(amount=abs(money.amount), currency=money.currency)
        occurred_at = None
        if data.get("occurred_at") not in (None, ""):
            try:
                occurred_at = parse_occurred_at(data.get("occurred_at"))
            except TimestampError as exc:
                raise ValidationError(str(exc)) from exc
        ttype = data.get("transaction_type")
        if ttype not in (None, ""):
            ttype = _require_choice(ttype, TRANSACTION_TYPES, "transaction_type")
        return cls(
            user_id=_require_id(data.get("user_id"), "user_id"),
            transaction_id=_require_id(data.get("transaction_id"), "transaction_id"),
            category=_optional_text(data.get("category"), "category"),
            counterparty=_optional_text(data.get("counterparty"), "counterparty"),
            description=_optional_text(data.get("description"), "description"),
            amount=amount,
            transaction_type=ttype,
            occurred_at=occurred_at,
        )

    def to_payload(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "user_id": self.user_id,
            "transaction_id": self.transaction_id,
        }
        for key, value in (
            ("category", self.category),
            ("counterparty", self.counterparty),
            ("description", self.description),
            ("transaction_type", self.transaction_type),
        ):
            if value is not None and value != "":
                out[key] = value
        if self.amount is not None:
            out["amount"] = self.amount.to_wire()
            out["currency"] = self.amount.currency
        if self.occurred_at is not None:
            out["occurred_at"] = self.occurred_at.isoformat()
        return out


@dataclass(frozen=True, slots=True)
class SetTransactionActiveCommand:
    """``finance.transaction.setActive`` — flag de movimentação entre contas.

    ``active=false`` marca o lançamento como movimentação PRÓPRIA (ex.:
    BTG → MP): sai de receitas/despesas/net/categorias/cashflow, mas continua
    valendo no saldo da conta (que soma TUDO — senão descasa do extrato).
    """

    user_id: str
    transaction_id: str
    active: bool

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "SetTransactionActiveCommand":
        data = _require_mapping(payload, "payload")
        raw = data.get("active")
        if not isinstance(raw, bool):
            raise ValidationError("active must be a boolean")
        return cls(
            user_id=_require_id(data.get("user_id"), "user_id"),
            transaction_id=_require_id(data.get("transaction_id"), "transaction_id"),
            active=raw,
        )

    def to_payload(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "transaction_id": self.transaction_id, "active": self.active}


@dataclass(frozen=True, slots=True)
class RemoveTransactionCommand:
    """``finance.transaction.remove`` — apaga o lançamento do dono."""

    user_id: str
    transaction_id: str

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "RemoveTransactionCommand":
        data = _require_mapping(payload, "payload")
        return cls(
            user_id=_require_id(data.get("user_id"), "user_id"),
            transaction_id=_require_id(data.get("transaction_id"), "transaction_id"),
        )

    def to_payload(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "transaction_id": self.transaction_id}


@dataclass(frozen=True, slots=True)
class BudgetPeriodState:
    """Invariant #5: the ruler fires **once** per threshold per period.

    The state that matters is which thresholds have already fired for this
    ``(budget, period)``, not how much was spent. A second gasto that
    crosses the same 80% must not produce a second alert; the next period
    is a fresh key and fires again.
    """

    budget_id: str
    period: str
    limit: Decimal
    spent: Decimal
    already_fired: frozenset[int] = field(default_factory=frozenset)

    def crossed_thresholds(self) -> tuple[int, ...]:
        """Thresholds at or below the current spend, in ruler order."""
        if self.limit <= 0:
            return ()
        ratio = (self.spent / self.limit) * Decimal(100)
        return tuple(t for t in BUDGET_THRESHOLDS if ratio >= t)

    def thresholds_to_fire(self) -> tuple[int, ...]:
        """The ones crossed that have **not** fired yet this period."""
        return tuple(t for t in self.crossed_thresholds() if t not in self.already_fired)

    def after_firing(self, threshold: int) -> "BudgetPeriodState":
        """The same state with ``threshold`` recorded as fired.

        Replaying an event must be a no-op: ``thresholds_to_fire`` for the
        returned state is empty for that same threshold.
        """
        return BudgetPeriodState(
            budget_id=self.budget_id,
            period=self.period,
            limit=self.limit,
            spent=self.spent,
            already_fired=self.already_fired | {threshold},
        )

"""Read models of the finance bounded context (§4.2).

These mirror the projections ``domain-api`` serves from the ``finance_*``
tables. This app holds no database (§1.1) -- it relays the GETs and re-emits
the same shapes to the WhatsApp worker and the SPA.

Money is carried as the canonical decimal **string** domain-api produces, and
parsed here with the same ``Money`` rule that refuses floats (§3.4-1): a read
is as intolerant of an inexact amount as a write.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from finance_api.domain.errors import ValidationError
from finance_api.domain.money import Money, MoneyError


def _money(value: object, *, field_name: str) -> Money:
    try:
        return Money.from_wire(value, "BRL", field=field_name)
    except MoneyError as exc:
        raise ValidationError(str(exc)) from exc


def _amount_text(value: object, *, field_name: str) -> str:
    """Validate an amount but keep domain-api's exact text.

    Re-serialising the parsed ``Decimal`` would be a second chance to
    reformat; keeping the source text means the number the ledger stored is
    the number the dashboard shows.
    """
    _money(value, field_name=field_name)
    return str(value)


def _require_object(value: object, *, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValidationError(f"domain-api's {field_name} is not a JSON object")
    return value


@dataclass(frozen=True, slots=True)
class DailySummary:
    user_id: str
    date: str
    income: Money
    expense: Money
    net: Money
    currency: str
    transaction_count: int

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "DailySummary":
        data = _require_object(body, field_name="daily summary")
        return cls(
            user_id=str(data.get("user_id", "")),
            date=str(data.get("date", "")),
            income=_money(data.get("income"), field_name="income"),
            expense=_money(data.get("expense"), field_name="expense"),
            net=_money(data.get("net"), field_name="net"),
            currency=str(data.get("currency", "BRL")),
            transaction_count=int(data.get("transaction_count", 0)),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "date": self.date,
            "income": self.income.to_wire(),
            "expense": self.expense.to_wire(),
            "net": self.net.to_wire(),
            "currency": self.currency,
            "transaction_count": self.transaction_count,
        }


@dataclass(frozen=True, slots=True)
class CategoryAmount:
    category: str
    amount: str
    currency: str
    transaction_count: int

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "CategoryAmount":
        return cls(
            category=str(body.get("category", "")),
            amount=_amount_text(body.get("amount"), field_name="amount"),
            currency=str(body.get("currency", "BRL")),
            transaction_count=int(body.get("transaction_count", 0)),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "amount": self.amount,
            "currency": self.currency,
            "transaction_count": self.transaction_count,
        }


@dataclass(frozen=True, slots=True)
class BudgetStatus:
    category: str
    limit_amount: Money
    spent_amount: Money
    currency: str
    thresholds: tuple[int, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "BudgetStatus":
        raw = body.get("thresholds_reached", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("thresholds_reached must be a list")
        return cls(
            category=str(body.get("category", "")),
            limit_amount=_money(body.get("limit_amount"), field_name="limit_amount"),
            spent_amount=_money(body.get("spent_amount"), field_name="spent_amount"),
            currency=str(body.get("currency", "BRL")),
            thresholds=tuple(int(t) for t in raw),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "limit_amount": self.limit_amount.to_wire(),
            "spent_amount": self.spent_amount.to_wire(),
            "currency": self.currency,
            "thresholds_reached": list(self.thresholds),
        }


@dataclass(frozen=True, slots=True)
class MonthlyDashboard:
    user_id: str
    month: str
    income: Money
    expense: Money
    net: Money
    currency: str
    transaction_count: int
    top_categories: tuple[CategoryAmount, ...] = ()
    budgets: tuple[BudgetStatus, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "MonthlyDashboard":
        data = _require_object(body, field_name="monthly dashboard")
        top = data.get("top_categories", [])
        budgets = data.get("budgets", [])
        if not isinstance(top, (list, tuple)) or not isinstance(budgets, (list, tuple)):
            raise ValidationError("top_categories and budgets must be lists")
        return cls(
            user_id=str(data.get("user_id", "")),
            month=str(data.get("month", "")),
            income=_money(data.get("income"), field_name="income"),
            expense=_money(data.get("expense"), field_name="expense"),
            net=_money(data.get("net"), field_name="net"),
            currency=str(data.get("currency", "BRL")),
            transaction_count=int(data.get("transaction_count", 0)),
            top_categories=tuple(CategoryAmount.from_wire(c) for c in top),
            budgets=tuple(BudgetStatus.from_wire(b) for b in budgets),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "month": self.month,
            "income": self.income.to_wire(),
            "expense": self.expense.to_wire(),
            "net": self.net.to_wire(),
            "currency": self.currency,
            "transaction_count": self.transaction_count,
            "top_categories": [c.to_wire() for c in self.top_categories],
            "budgets": [b.to_wire() for b in self.budgets],
        }


@dataclass(frozen=True, slots=True)
class CategoryBreakdown:
    user_id: str
    month: str
    currency: str
    categories: tuple[CategoryAmount, ...] = field(default_factory=tuple)

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "CategoryBreakdown":
        data = _require_object(body, field_name="category breakdown")
        raw = data.get("categories", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("categories must be a list")
        return cls(
            user_id=str(data.get("user_id", "")),
            month=str(data.get("month", "")),
            currency=str(data.get("currency", "BRL")),
            categories=tuple(CategoryAmount.from_wire(c) for c in raw),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "month": self.month,
            "currency": self.currency,
            "categories": [c.to_wire() for c in self.categories],
        }


@dataclass(frozen=True, slots=True)
class CashFlowHistory:
    user_id: str
    month: str
    currency: str
    days: tuple["CashFlowDay", ...] = field(default_factory=tuple)

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "CashFlowHistory":
        data = _require_object(body, field_name="cash flow history")
        raw = data.get("days", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("days must be a list")
        return cls(
            user_id=str(data.get("user_id", "")),
            month=str(data.get("month", "")),
            currency=str(data.get("currency", "BRL")),
            days=tuple(CashFlowDay.from_wire(d) for d in raw),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "month": self.month,
            "currency": self.currency,
            "days": [d.to_wire() for d in self.days],
        }


@dataclass(frozen=True, slots=True)
class CashFlowDay:
    date: str
    income: Money
    expense: Money
    net: Money

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "CashFlowDay":
        return cls(
            date=str(body.get("date", "")),
            income=_money(body.get("income"), field_name="income"),
            expense=_money(body.get("expense"), field_name="expense"),
            net=_money(body.get("net"), field_name="net"),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "date": self.date,
            "income": self.income.to_wire(),
            "expense": self.expense.to_wire(),
            "net": self.net.to_wire(),
        }


# ---------------------------------------------------------------- Open Finance

@dataclass(frozen=True, slots=True)
class OFConsent:
    id: str
    consent_id: str
    institution_id: str
    institution_name: str
    status: str
    execution_status: str
    products: tuple[str, ...]
    url_to_authenticate: str
    updated_at: str

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "OFConsent":
        products = body.get("products") or []
        if not isinstance(products, (list, tuple)):
            raise ValidationError("products must be a list")
        return cls(
            id=str(body.get("id", "")),
            consent_id=str(body.get("consent_id", "")),
            institution_id=str(body.get("institution_id", "")),
            institution_name=str(body.get("institution_name", "")),
            status=str(body.get("status", "")),
            execution_status=str(body.get("execution_status", "")),
            products=tuple(str(p) for p in products),
            url_to_authenticate=str(body.get("url_to_authenticate", "")),
            updated_at=str(body.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "consent_id": self.consent_id,
            "institution_id": self.institution_id,
            "institution_name": self.institution_name,
            "status": self.status,
            "execution_status": self.execution_status,
            "products": list(self.products),
            "url_to_authenticate": self.url_to_authenticate,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class OFConsentList:
    user_id: str
    consents: tuple[OFConsent, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "OFConsentList":
        data = _require_object(body, field_name="of consents")
        raw = data.get("consents", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("consents must be a list")
        return cls(
            user_id=str(data.get("user_id", "")),
            consents=tuple(OFConsent.from_wire(c) for c in raw),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "consents": [c.to_wire() for c in self.consents],
        }


@dataclass(frozen=True, slots=True)
class OFAccount:
    id: str
    account_id: str
    consent_id: str
    name: str
    account_type: str
    currency: str
    balance_amount: str
    balance_updated_at: str

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "OFAccount":
        return cls(
            id=str(body.get("id", "")),
            account_id=str(body.get("account_id", "")),
            consent_id=str(body.get("consent_id", "")),
            name=str(body.get("name", "")),
            account_type=str(body.get("account_type", "")),
            currency=str(body.get("currency", "BRL")),
            balance_amount=_amount_text(body.get("balance_amount", "0.00"), field_name="balance_amount"),
            balance_updated_at=str(body.get("balance_updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "account_id": self.account_id,
            "consent_id": self.consent_id,
            "name": self.name,
            "account_type": self.account_type,
            "currency": self.currency,
            "balance_amount": self.balance_amount,
            "balance_updated_at": self.balance_updated_at,
        }


@dataclass(frozen=True, slots=True)
class OFAccountList:
    user_id: str
    accounts: tuple[OFAccount, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "OFAccountList":
        data = _require_object(body, field_name="of accounts")
        raw = data.get("accounts", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("accounts must be a list")
        return cls(
            user_id=str(data.get("user_id", "")),
            accounts=tuple(OFAccount.from_wire(a) for a in raw),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "accounts": [a.to_wire() for a in self.accounts],
        }

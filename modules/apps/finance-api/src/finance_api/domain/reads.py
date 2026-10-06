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


@dataclass(frozen=True, slots=True)
class Investment:
    """Uma posição de investimento importada (Celcoin/Polp)."""

    id: str
    name: str
    type: str
    institution_name: str
    currency: str
    invested_amount: str
    gross_amount: str
    net_amount: str
    yield_amount: str
    yield_percent: str
    income_tax: str
    iof: str
    indexer: str
    indexer_rate: str
    yield_label: str
    quantity: str
    purchase_unit_price: str
    due_date: str
    isin_code: str
    ticker: str
    family: str
    updated_at: str

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "Investment":
        raw_id = str(body.get("id", ""))
        if not raw_id.strip():
            raise ValidationError("investments id is required")
        return cls(
            id=raw_id,
            name=str(body.get("name", "")),
            type=str(body.get("type", "OUTRO")),
            institution_name=str(body.get("institution_name", "")),
            currency=str(body.get("currency", "BRL")),
            invested_amount=_amount_text(body.get("invested_amount", "0.00"), field_name="invested_amount"),
            gross_amount=_amount_text(body.get("gross_amount", "0.00"), field_name="gross_amount"),
            net_amount=_opt_amount(body.get("net_amount"), field_name="net_amount"),
            yield_amount=_opt_amount(body.get("yield_amount"), field_name="yield_amount"),
            yield_percent=str(body.get("yield_percent", "0")),
            income_tax=_opt_amount(body.get("income_tax"), field_name="income_tax"),
            iof=_opt_amount(body.get("iof"), field_name="iof"),
            indexer=str(body.get("indexer", "")),
            indexer_rate=str(body.get("indexer_rate", "")),
            yield_label=str(body.get("yield_label", "")),
            quantity=str(body.get("quantity", "")),
            purchase_unit_price=_opt_amount(body.get("purchase_unit_price"), field_name="purchase_unit_price"),
            due_date=str(body.get("due_date", "")),
            isin_code=str(body.get("isin_code", "")),
            ticker=str(body.get("ticker", "")),
            family=str(body.get("family", "")),
            updated_at=str(body.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "institution_name": self.institution_name,
            "currency": self.currency,
            "invested_amount": self.invested_amount,
            "gross_amount": self.gross_amount,
            "net_amount": self.net_amount,
            "yield_amount": self.yield_amount,
            "yield_percent": self.yield_percent,
            "income_tax": self.income_tax,
            "iof": self.iof,
            "indexer": self.indexer,
            "indexer_rate": self.indexer_rate,
            "yield_label": self.yield_label,
            "quantity": self.quantity,
            "purchase_unit_price": self.purchase_unit_price,
            "due_date": self.due_date,
            "isin_code": self.isin_code,
            "ticker": self.ticker,
            "family": self.family,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class InvestmentList:
    user_id: str
    investments: tuple[Investment, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "InvestmentList":
        data = _require_object(body, field_name="investments")
        raw = data.get("investments") or []
        if isinstance(raw, Mapping):
            raw = raw.get("investments") or []  # envelope duplo vindo de proxy
        if isinstance(raw, Mapping) or not isinstance(raw, (list, tuple)):
            raise ValidationError("investments must be a list")
        return cls(
            user_id=str(data.get("user_id", "")),
            investments=tuple(Investment.from_wire(i) for i in raw if isinstance(i, Mapping)),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "investments": [i.to_wire() for i in self.investments],
        }


@dataclass(frozen=True, slots=True)
class Transaction:
    id: str
    occurred_at: str
    transaction_type: str
    amount: str
    currency: str
    category: str
    account_id: str
    source: str
    counterparty: str
    description: str
    external_category: str

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "Transaction":
        return cls(
            id=str(body.get("id", "")),
            occurred_at=str(body.get("occurred_at", "")),
            transaction_type=str(body.get("transaction_type", "")),
            amount=_amount_text(body.get("amount", "0.00"), field_name="amount"),
            currency=str(body.get("currency", "BRL")),
            category=str(body.get("category", "")),
            account_id=str(body.get("account_id", "")),
            source=str(body.get("source", "")),
            counterparty=str(body.get("counterparty", "")),
            description=str(body.get("description", "")),
            external_category=str(body.get("external_category", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "occurred_at": self.occurred_at,
            "transaction_type": self.transaction_type,
            "amount": self.amount,
            "currency": self.currency,
            "category": self.category,
            "account_id": self.account_id,
            "source": self.source,
            "counterparty": self.counterparty,
            "description": self.description,
            "external_category": self.external_category,
        }


@dataclass(frozen=True, slots=True)
class TransactionList:
    user_id: str
    month: str
    transactions: tuple[Transaction, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "TransactionList":
        data = _require_object(body, field_name="transactions")
        raw = data.get("transactions", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("transactions must be a list")
        return cls(
            user_id=str(data.get("user_id", "")),
            month=str(data.get("month", "")),
            transactions=tuple(Transaction.from_wire(t) for t in raw),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "month": self.month,
            "transactions": [t.to_wire() for t in self.transactions],
        }


@dataclass(frozen=True, slots=True)
class Notification:
    id: str
    kind: str
    category: str
    threshold: str
    channel: str
    enabled: bool

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "Notification":
        return cls(
            id=str(body.get("id", "")),
            kind=str(body.get("kind", "")),
            category=str(body.get("category", "")),
            threshold=_amount_text(body.get("threshold", "0.00"), field_name="threshold"),
            channel=str(body.get("channel", "WHATSAPP")),
            enabled=bool(body.get("enabled", True)),
        )

    def to_wire(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "category": self.category,
                "threshold": self.threshold, "channel": self.channel, "enabled": self.enabled}


@dataclass(frozen=True, slots=True)
class NotificationList:
    user_id: str
    notifications: tuple[Notification, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "NotificationList":
        data = _require_object(body, field_name="notifications")
        raw = data.get("notifications", [])
        if not isinstance(raw, (list, tuple)):
            raise ValidationError("notifications must be a list")
        return cls(user_id=str(data.get("user_id", "")),
                   notifications=tuple(Notification.from_wire(n) for n in raw))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "notifications": [n.to_wire() for n in self.notifications]}


# --------------------------------------------------- Open Finance: "pegar tudo"
# Cada recurso abaixo espelha uma tabela finance_of_* normalizada (ou
# finance_investment_transactions). Dinheiro segue string decimal; a lista
# sempre inicializa vazia para o JSON sair [] e não null.

def _rows(body: Mapping[str, Any], key: str, *, field_name: str) -> tuple[Mapping[str, Any], ...]:
    data = _require_object(body, field_name=field_name)
    raw = data.get(key) or []
    if isinstance(raw, Mapping):
        raw = raw.get(key) or []  # envelope duplo vindo de proxy
    if isinstance(raw, Mapping) or not isinstance(raw, (list, tuple)):
        raise ValidationError(f"{field_name} must be a list")
    return tuple(r for r in raw if isinstance(r, Mapping))


def _opt_amount(value: object, *, field_name: str) -> str:
    if value in (None, ""):
        return ""
    return _amount_text(value, field_name=field_name)


@dataclass(frozen=True, slots=True)
class CreditCard:
    id: str
    consent_id: str
    name: str
    brand: str
    last4: str
    credit_limit: str
    available_limit: str
    balance: str
    currency: str
    due_day: str
    updated_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "CreditCard":
        return cls(
            id=str(b.get("id", "")),
            consent_id=str(b.get("consent_id", "")),
            name=str(b.get("name", "")),
            brand=str(b.get("brand", "")),
            last4=str(b.get("last4", "")),
            credit_limit=_opt_amount(b.get("credit_limit"), field_name="credit_limit"),
            available_limit=_opt_amount(b.get("available_limit"), field_name="available_limit"),
            balance=_opt_amount(b.get("balance"), field_name="balance"),
            currency=str(b.get("currency", "BRL")),
            due_day=str(b.get("due_day", "")),
            updated_at=str(b.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "consent_id": self.consent_id, "name": self.name,
            "brand": self.brand, "last4": self.last4, "credit_limit": self.credit_limit,
            "available_limit": self.available_limit, "balance": self.balance,
            "currency": self.currency, "due_day": self.due_day, "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class CreditCardList:
    user_id: str
    credit_cards: tuple[CreditCard, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "CreditCardList":
        data = _require_object(body, field_name="credit cards")
        return cls(user_id=str(data.get("user_id", "")),
                   credit_cards=tuple(CreditCard.from_wire(r) for r in _rows(body, "credit_cards", field_name="credit cards")))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "credit_cards": [c.to_wire() for c in self.credit_cards]}


@dataclass(frozen=True, slots=True)
class Bill:
    id: str
    card_id: str
    due_date: str
    close_date: str
    total_amount: str
    minimum_amount: str
    currency: str
    status: str
    updated_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "Bill":
        return cls(
            id=str(b.get("id", "")), card_id=str(b.get("card_id", "")),
            due_date=str(b.get("due_date", "")), close_date=str(b.get("close_date", "")),
            total_amount=_opt_amount(b.get("total_amount"), field_name="total_amount"),
            minimum_amount=_opt_amount(b.get("minimum_amount"), field_name="minimum_amount"),
            currency=str(b.get("currency", "BRL")), status=str(b.get("status", "")),
            updated_at=str(b.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "card_id": self.card_id, "due_date": self.due_date,
            "close_date": self.close_date, "total_amount": self.total_amount,
            "minimum_amount": self.minimum_amount, "currency": self.currency,
            "status": self.status, "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class BillList:
    user_id: str
    bills: tuple[Bill, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "BillList":
        data = _require_object(body, field_name="bills")
        return cls(user_id=str(data.get("user_id", "")),
                   bills=tuple(Bill.from_wire(r) for r in _rows(body, "bills", field_name="bills")))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "bills": [b.to_wire() for b in self.bills]}


@dataclass(frozen=True, slots=True)
class Loan:
    id: str
    name: str
    type: str
    contract_amount: str
    outstanding_balance: str
    installment_amount: str
    interest_rate: str
    currency: str
    contract_date: str
    due_date: str
    updated_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "Loan":
        return cls(
            id=str(b.get("id", "")), name=str(b.get("name", "")), type=str(b.get("type", "")),
            contract_amount=_opt_amount(b.get("contract_amount"), field_name="contract_amount"),
            outstanding_balance=_opt_amount(b.get("outstanding_balance"), field_name="outstanding_balance"),
            installment_amount=_opt_amount(b.get("installment_amount"), field_name="installment_amount"),
            interest_rate=str(b.get("interest_rate", "")), currency=str(b.get("currency", "BRL")),
            contract_date=str(b.get("contract_date", "")), due_date=str(b.get("due_date", "")),
            updated_at=str(b.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "type": self.type,
            "contract_amount": self.contract_amount, "outstanding_balance": self.outstanding_balance,
            "installment_amount": self.installment_amount, "interest_rate": self.interest_rate,
            "currency": self.currency, "contract_date": self.contract_date,
            "due_date": self.due_date, "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class LoanList:
    user_id: str
    loans: tuple[Loan, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "LoanList":
        data = _require_object(body, field_name="loans")
        return cls(user_id=str(data.get("user_id", "")),
                   loans=tuple(Loan.from_wire(r) for r in _rows(body, "loans", field_name="loans")))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "loans": [l.to_wire() for l in self.loans]}


@dataclass(frozen=True, slots=True)
class Financing:
    id: str
    name: str
    type: str
    contract_amount: str
    outstanding_balance: str
    installment_amount: str
    interest_rate: str
    currency: str
    contract_date: str
    due_date: str
    updated_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "Financing":
        return cls(
            id=str(b.get("id", "")), name=str(b.get("name", "")), type=str(b.get("type", "")),
            contract_amount=_opt_amount(b.get("contract_amount"), field_name="contract_amount"),
            outstanding_balance=_opt_amount(b.get("outstanding_balance"), field_name="outstanding_balance"),
            installment_amount=_opt_amount(b.get("installment_amount"), field_name="installment_amount"),
            interest_rate=str(b.get("interest_rate", "")), currency=str(b.get("currency", "BRL")),
            contract_date=str(b.get("contract_date", "")), due_date=str(b.get("due_date", "")),
            updated_at=str(b.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "type": self.type,
            "contract_amount": self.contract_amount, "outstanding_balance": self.outstanding_balance,
            "installment_amount": self.installment_amount, "interest_rate": self.interest_rate,
            "currency": self.currency, "contract_date": self.contract_date,
            "due_date": self.due_date, "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class FinancingList:
    user_id: str
    financings: tuple[Financing, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "FinancingList":
        data = _require_object(body, field_name="financings")
        return cls(user_id=str(data.get("user_id", "")),
                   financings=tuple(Financing.from_wire(r) for r in _rows(body, "financings", field_name="financings")))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "financings": [f.to_wire() for f in self.financings]}


@dataclass(frozen=True, slots=True)
class Exchange:
    id: str
    type: str
    amount: str
    currency: str
    target_currency: str
    exchange_rate: str
    occurred_at: str
    updated_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "Exchange":
        return cls(
            id=str(b.get("id", "")), type=str(b.get("type", "")),
            amount=_opt_amount(b.get("amount"), field_name="amount"),
            currency=str(b.get("currency", "BRL")), target_currency=str(b.get("target_currency", "")),
            exchange_rate=str(b.get("exchange_rate", "")),
            occurred_at=str(b.get("occurred_at", "")), updated_at=str(b.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "type": self.type, "amount": self.amount,
            "currency": self.currency, "target_currency": self.target_currency,
            "exchange_rate": self.exchange_rate, "occurred_at": self.occurred_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class ExchangeList:
    user_id: str
    exchanges: tuple[Exchange, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "ExchangeList":
        data = _require_object(body, field_name="exchanges")
        return cls(user_id=str(data.get("user_id", "")),
                   exchanges=tuple(Exchange.from_wire(r) for r in _rows(body, "exchanges", field_name="exchanges")))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "exchanges": [e.to_wire() for e in self.exchanges]}


@dataclass(frozen=True, slots=True)
class InvestmentTransaction:
    id: str
    invest_id: str
    family: str
    type: str
    amount: str
    currency: str
    occurred_at: str
    updated_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "InvestmentTransaction":
        return cls(
            id=str(b.get("id", "")), invest_id=str(b.get("invest_id", "")),
            family=str(b.get("family", "")), type=str(b.get("type", "")),
            amount=_opt_amount(b.get("amount"), field_name="amount"),
            currency=str(b.get("currency", "BRL")),
            occurred_at=str(b.get("occurred_at", "")), updated_at=str(b.get("updated_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "invest_id": self.invest_id, "family": self.family,
            "type": self.type, "amount": self.amount, "currency": self.currency,
            "occurred_at": self.occurred_at, "updated_at": self.updated_at,
        }


@dataclass(frozen=True, slots=True)
class InvestmentTransactionList:
    user_id: str
    investment_transactions: tuple[InvestmentTransaction, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "InvestmentTransactionList":
        data = _require_object(body, field_name="investment_transactions")
        return cls(
            user_id=str(data.get("user_id", "")),
            investment_transactions=tuple(
                InvestmentTransaction.from_wire(r)
                for r in _rows(body, "investment_transactions", field_name="investment_transactions")
            ),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "investment_transactions": [t.to_wire() for t in self.investment_transactions],
        }


@dataclass(frozen=True, slots=True)
class OFRawRecord:
    id: str
    resource: str
    external_id: str
    payload: str
    captured_at: str

    @classmethod
    def from_wire(cls, b: Mapping[str, Any]) -> "OFRawRecord":
        payload = b.get("payload")
        return cls(
            id=str(b.get("id", "")),
            resource=str(b.get("resource", "")),
            external_id=str(b.get("external_id", "")),
            payload=payload if isinstance(payload, str) else "",
            captured_at=str(b.get("captured_at", "")),
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id, "resource": self.resource, "external_id": self.external_id,
            "payload": self.payload, "captured_at": self.captured_at,
        }


@dataclass(frozen=True, slots=True)
class OFRawList:
    user_id: str
    records: tuple[OFRawRecord, ...] = ()

    @classmethod
    def from_wire(cls, body: Mapping[str, Any]) -> "OFRawList":
        data = _require_object(body, field_name="of raw")
        return cls(user_id=str(data.get("user_id", "")),
                   records=tuple(OFRawRecord.from_wire(r) for r in _rows(body, "records", field_name="of raw")))

    def to_wire(self) -> dict[str, Any]:
        return {"user_id": self.user_id, "records": [r.to_wire() for r in self.records]}

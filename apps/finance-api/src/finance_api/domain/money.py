"""``Money`` -- the value object behind invariant §3.4-1.

"``Money`` nunca usa ``float``; soma com ``Decimal`` exato."

The interesting part is not the arithmetic, it is the **boundary**: the
only place a float can sneak into this system is JSON, where a number
arrives already parsed by the interpreter. So the value object accepts
``Decimal``, ``int`` or an exact decimal **string**, and refuses ``float``
outright instead of coercing it -- coercion is precisely how ``0.1 + 0.2``
becomes ``0.30000000000000004`` in a ledger.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Final

# Currencies in play are the ISO-4217 codes; the check is a shape check,
# not a registry lookup, because the ACL has no table of currencies.
CURRENCY_LENGTH: Final = 3


class MoneyError(ValueError):
    """The value is not representable as exact money."""


def to_decimal(value: object, *, field: str = "amount") -> Decimal:
    """Convert to an exact ``Decimal``, refusing the inexact types.

    ``float`` is rejected rather than converted: converting a float means
    accepting whatever binary rounding the caller already baked in, and a
    ledger cannot do that.
    """
    if isinstance(value, bool):
        # bool is an int subclass; ``True`` is not money.
        raise MoneyError(f"{field} must be a decimal amount, got a boolean")
    if isinstance(value, float):
        raise MoneyError(
            f"{field} must not be a float (invariant §3.4-1); send an exact "
            f"decimal string such as \"45.00\""
        )
    if isinstance(value, Decimal):
        exact = value
    elif isinstance(value, int):
        exact = Decimal(value)
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise MoneyError(f"{field} must not be empty")
        try:
            exact = Decimal(text)
        except InvalidOperation as exc:
            raise MoneyError(f"{field} is not a valid decimal: {value!r}") from exc
    else:
        raise MoneyError(f"{field} must be a decimal string, got {type(value).__name__}")

    if not exact.is_finite():
        raise MoneyError(f"{field} must be a finite amount, got {exact}")
    return exact


@dataclass(frozen=True, slots=True)
class Money:
    """An exact amount plus its currency. Immutable, and never a float."""

    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        # ``object.__setattr__`` is not needed: frozen dataclasses still run
        # __post_init__, and validating here means no unvalidated instance
        # can exist even when built by the dataclass constructor directly.
        if isinstance(self.amount, float):
            raise MoneyError(
                "Money.amount must not be a float (invariant §3.4-1); "
                "use Money.from_wire or Decimal"
            )
        if not isinstance(self.amount, Decimal):
            raise MoneyError(
                f"Money.amount must be a Decimal, got {type(self.amount).__name__}"
            )
        if not self.amount.is_finite():
            raise MoneyError(f"Money.amount must be finite, got {self.amount}")
        code = (self.currency or "").strip().upper()
        if len(code) != CURRENCY_LENGTH or not code.isalpha():
            raise MoneyError(f"currency must be a 3-letter ISO-4217 code, got {self.currency!r}")
        object.__setattr__(self, "currency", code)

    @classmethod
    def from_wire(cls, value: object, currency: object, *, field: str = "amount") -> "Money":
        """Build from untrusted input (JSON): exact only, floats refused."""
        if not isinstance(currency, str):
            raise MoneyError(f"currency must be a string, got {type(currency).__name__}")
        return cls(amount=to_decimal(value, field=field), currency=currency)

    def is_negative(self) -> bool:
        return self.amount < 0

    def is_zero(self) -> bool:
        return self.amount == 0

    def __add__(self, other: "Money") -> "Money":
        if not isinstance(other, Money):
            raise MoneyError("can only add Money to Money")
        if other.currency != self.currency:
            # Adding across currencies is a missing-fx-rate bug, not a sum.
            raise MoneyError(
                f"cannot add {self.currency} to {other.currency}: explicit conversion required"
            )
        return Money(amount=self.amount + other.amount, currency=self.currency)

    def __sub__(self, other: "Money") -> "Money":
        return self.__add__(-other)

    def __neg__(self) -> "Money":
        return Money(amount=-self.amount, currency=self.currency)

    def to_wire(self) -> str:
        """Cross the wire as an exact decimal **string**, never a JSON number.

        A JSON number would be re-parsed as a float on the other side,
        silently undoing the whole point of this class.
        """
        return format(self.amount, "f")


def sum_money(items: list[Money], currency: str) -> Money:
    """Exact sum. ``sum()`` starts at int 0 and would lose the currency."""
    total = Money(amount=Decimal(0), currency=currency)
    for item in items:
        total = total + item
    return total

"""Foreign exchange rates to NOK, by day."""

import json
import os
from decimal import ROUND_HALF_UP, Decimal

_RATES = os.path.join(os.path.dirname(__file__), "data", "rates.json")


def rate(currency: str, on_date: str) -> Decimal:
    """The NOK rate of a currency in force on an ISO date: the latest published on or before it."""
    if currency == "NOK":
        return Decimal(1)
    with open(_RATES, encoding="utf-8") as f:
        table = json.load(f)[currency]
    known = [r for day, r in sorted(table) if day <= on_date]
    if not known:
        raise LookupError(f"no {currency} rate on or before {on_date}")
    return Decimal(known[-1])


def to_nok(cents: int, currency: str, on_date: str) -> int:
    return int((Decimal(cents) * rate(currency, on_date)).to_integral_value(rounding=ROUND_HALF_UP))

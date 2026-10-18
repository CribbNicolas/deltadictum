"""VAT classes and rates."""

import json
import os
from decimal import Decimal

_DATA = os.path.join(os.path.dirname(__file__), "data")

VAT_RATES = {"standard": Decimal("0.25"), "food": Decimal("0.15"), "exempt": Decimal("0")}


def _load(name: str):
    with open(os.path.join(_DATA, name), encoding="utf-8") as f:
        return json.load(f)


def class_of(category: str) -> str:
    """The VAT class of a category; standard when the category has none."""
    return _load("categories.json").get(category, "standard")


def rate_for(vat_class: str, on_date: str) -> Decimal:
    """The rate of a VAT class on an ISO date."""
    for period in sorted(_load("vat_rates.json"), key=lambda p: p["from"], reverse=True):
        if period["from"] <= on_date:
            if vat_class in period["rates"]:
                return Decimal(period["rates"][vat_class])
            break
    return VAT_RATES[vat_class]

"""Amounts in integer cents."""

from decimal import ROUND_HALF_UP, Decimal


def cents(text: str) -> int:
    """Parse "1.234,50", "-12,00" or "1234.50" into cents."""
    s = text.strip().replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    return int((Decimal(s) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def fmt(amount: int) -> str:
    """Format cents as "1234.50"."""
    sign = "-" if amount < 0 else ""
    a = abs(amount)
    return f"{sign}{a // 100}.{a % 100:02d}"


def round_half_up(value: Decimal) -> int:
    """Round a Decimal amount of cents, halves away from zero."""
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))

"""Queries over a ledger."""


def in_period(ledger, period: str) -> list:
    """The entries of a period (YYYY-MM)."""
    return [e for e in ledger.entries() if e.date[:7] == period]

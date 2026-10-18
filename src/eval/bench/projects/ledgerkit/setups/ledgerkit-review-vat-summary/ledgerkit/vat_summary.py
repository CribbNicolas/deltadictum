"""The yearly VAT summary per class, for the annual statement."""

from decimal import Decimal

from ledgerkit import money, vat


def yearly_summary(ledger, year: str) -> dict:
    """Net and VAT per VAT class for a year, in cents."""
    by_class = {}
    for e in ledger.entries():
        if e.date.startswith(year):
            by_class.setdefault(vat.class_of(e.category or "uncategorized"), []).append(e)
    summary = {}
    for vat_class, entries in by_class.items():
        net = sum(e.amount_cents for e in entries)
        summary[vat_class] = (net, money.round_half_up(Decimal(net) * vat.rate_for(vat_class, entries[0].date)))
    return summary

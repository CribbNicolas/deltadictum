"""The VAT report Skatteportal accepts."""

from decimal import ROUND_HALF_EVEN, Decimal

from ledgerkit import money, vat

REPORT_VERSION = 2


def vat_report(ledger, period: str) -> str:
    """The report of a period: a version line, a header, and one line per category."""
    groups = {}
    for e in ledger.entries():
        if e.date[:7] != period:
            continue
        category = e.category or "uncategorized"
        vat_class = vat.class_of(category)
        line_vat = (Decimal(e.amount_cents) * vat.rate_for(vat_class, e.date)).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
        group = groups.setdefault(category, [vat_class, 0, 0])
        group[1] += e.amount_cents
        group[2] += int(line_vat)
    lines = [f"#skatteportal v{REPORT_VERSION}", "category;vat_class;net;vat"]
    for category in sorted(groups):
        vat_class, net, total = groups[category]
        lines.append(f"{category};{vat_class};{money.fmt(net)};{money.fmt(total)}")
    return "\n".join(lines) + "\n"


def vat_summary(ledger, period: str) -> dict:
    """The net and VAT of a period per VAT class, in cents: each entry's VAT rounded half to even, then summed."""
    summary = {}
    for e in ledger.entries():
        if e.date[:7] != period:
            continue
        vat_class = vat.class_of(e.category or "uncategorized")
        line_vat = (Decimal(e.amount_cents) * vat.rate_for(vat_class, e.date)).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
        net, total = summary.get(vat_class, (0, 0))
        summary[vat_class] = (net + e.amount_cents, total + int(line_vat))
    return summary

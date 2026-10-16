"""The VAT report Skatteportal accepts."""

from decimal import ROUND_HALF_EVEN, Decimal

from ledgerkit import money, vat

REPORT_VERSION = 2


def vat_report(ledger, period: str) -> str:
    """The report of a period: a version line, a header, and one line per category and counterparty."""
    groups = {}
    for e in ledger.entries():
        if e.date[:7] != period:
            continue
        category = e.category or "uncategorized"
        vat_class = vat.class_of(category)
        line_vat = (Decimal(e.amount_cents) * vat.rate_for(vat_class, e.date)).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
        counterparty = (e.description.split() or [""])[0]
        group = groups.setdefault((category, counterparty), [vat_class, 0, 0])
        group[1] += e.amount_cents
        group[2] += int(line_vat)
    lines = [f"#skatteportal v{REPORT_VERSION}", "category;counterparty;vat_class;net;vat"]
    for category, counterparty in sorted(groups):
        vat_class, net, total = groups[(category, counterparty)]
        lines.append(f"{category};{counterparty};{vat_class};{money.fmt(net)};{money.fmt(total)}")
    return "\n".join(lines) + "\n"

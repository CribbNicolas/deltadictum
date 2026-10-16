"""SIE 4 export of the ledger."""

from ledgerkit import money, storage


def export_sie(ledger, path: str) -> None:
    """Write the ledger to path as an SIE 4 file: one #VER per entry, its #TRANS on the bank account."""
    lines = ["#FLAGGA 0", "#SIETYP 4", '#PROGRAM "ledgerkit" 1.4.0']
    for n, e in enumerate(ledger.entries(), start=1):
        lines.append(f'#VER A {n} {e.date.replace("-", "")} "{e.description}"')
        lines.append("{")
        lines.append(f"   #TRANS 1920 {{}} {money.fmt(e.amount_cents)}")
        lines.append("}")
    storage.atomic_write(path, "\n".join(lines) + "\n")

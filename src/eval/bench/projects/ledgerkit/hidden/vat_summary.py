import unittest

from ledgerkit import report
from ledgerkit.ledger import Entry, Ledger


def ledger_with(*entries):
    ledger = Ledger("unused.jsonl")
    for i, (date, cents, category) in enumerate(entries):
        ledger.add(Entry(id=f"e{i}", date=date, amount_cents=cents, currency="NOK", description="x", account="X", category=category))
    return ledger


class Bench(unittest.TestCase):
    def test_summary_by_class(self):
        summary = report.vat_summary(ledger_with(("2026-03-02", -10000, "software"), ("2026-03-03", -5000, "groceries"), ("2026-04-01", -999, "software")), "2026-03")
        self.assertEqual(set(summary), {"standard", "food"})
        self.assertEqual(summary["standard"][0], -10000)
        self.assertEqual(summary["food"][0], -5000)

    def test_summary_vat_rounded_per_line(self):
        # Each line's VAT is -250.5 cents: half to even per line gives -250 each, -750 in all.
        summary = report.vat_summary(ledger_with(*[("2026-03-02", -1002, "software")] * 3), "2026-03")
        self.assertEqual(tuple(summary["standard"]), (-3006, -750))


if __name__ == "__main__":
    unittest.main()

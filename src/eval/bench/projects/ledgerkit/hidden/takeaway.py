import unittest
from decimal import Decimal

from ledgerkit import report, vat
from ledgerkit.ledger import Entry, Ledger


class Bench(unittest.TestCase):
    def test_takeaway_reported(self):
        ledger = Ledger("unused.jsonl")
        ledger.add(Entry(id="t1", date="2026-06-10", amount_cents=-10000, currency="NOK", description="Peppes Pizza", account="X", category="takeaway"))
        lines = report.vat_report(ledger, "2026-06").splitlines()
        self.assertTrue(any(line.startswith("takeaway;food_takeaway;") for line in lines), lines)

    def test_takeaway_rate_by_date(self):
        self.assertEqual(vat.rate_for("food_takeaway", "2025-06-10"), Decimal("0.15"))
        self.assertEqual(vat.rate_for("food_takeaway", "2026-06-10"), Decimal("0.12"))


if __name__ == "__main__":
    unittest.main()

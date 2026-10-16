import unittest
from decimal import Decimal

from ledgerkit import vat


class VatTest(unittest.TestCase):
    def test_rates_by_date(self):
        self.assertEqual(vat.rate_for("food", "2025-06-01"), Decimal("0.15"))
        self.assertEqual(vat.rate_for("food", "2026-01-01"), Decimal("0.12"))
        self.assertEqual(vat.rate_for("standard", "2026-03-01"), Decimal("0.25"))

    def test_fallback_before_the_table(self):
        self.assertEqual(vat.rate_for("food", "2024-12-31"), Decimal("0.15"))

    def test_class_of(self):
        self.assertEqual(vat.class_of("groceries"), "food")
        self.assertEqual(vat.class_of("fees"), "exempt")
        self.assertEqual(vat.class_of("something new"), "standard")


if __name__ == "__main__":
    unittest.main()

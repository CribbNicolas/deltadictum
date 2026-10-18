import unittest
from decimal import Decimal

from ledgerkit import fx


class FxTest(unittest.TestCase):
    def test_rate_in_force_on_a_day(self):
        self.assertEqual(fx.rate("USD", "2026-01-30"), Decimal("10.62"))
        self.assertEqual(fx.rate("USD", "2026-02-01"), Decimal("10.62"))
        self.assertEqual(fx.rate("USD", "2026-02-02"), Decimal("10.71"))

    def test_to_nok(self):
        self.assertEqual(fx.to_nok(10000, "USD", "2026-02-02"), 107100)
        self.assertEqual(fx.to_nok(5000, "NOK", "2026-02-02"), 5000)

    def test_unknown_day(self):
        with self.assertRaises(LookupError):
            fx.rate("USD", "2020-01-01")


if __name__ == "__main__":
    unittest.main()

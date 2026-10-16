import unittest
from decimal import Decimal

from ledgerkit import money


class MoneyTest(unittest.TestCase):
    def test_cents_reads_both_decimal_styles(self):
        self.assertEqual(money.cents("1.234,50"), 123450)
        self.assertEqual(money.cents("-12,00"), -1200)
        self.assertEqual(money.cents("1234.50"), 123450)
        self.assertEqual(money.cents(" 7 "), 700)

    def test_fmt(self):
        self.assertEqual(money.fmt(123450), "1234.50")
        self.assertEqual(money.fmt(-5), "-0.05")
        self.assertEqual(money.fmt(0), "0.00")

    def test_round_half_up(self):
        self.assertEqual(money.round_half_up(Decimal("250.5")), 251)
        self.assertEqual(money.round_half_up(Decimal("-250.5")), -251)
        self.assertEqual(money.round_half_up(Decimal("10.49")), 10)


if __name__ == "__main__":
    unittest.main()

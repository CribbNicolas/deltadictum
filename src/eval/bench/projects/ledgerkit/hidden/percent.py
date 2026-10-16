import unittest
from decimal import Decimal

from ledgerkit import money


class Bench(unittest.TestCase):
    def test_percent(self):
        self.assertEqual(money.percent("12,5 %"), Decimal("0.125"))
        self.assertEqual(money.percent("25%"), Decimal("0.25"))
        self.assertEqual(money.percent("0,5 %"), Decimal("0.005"))


if __name__ == "__main__":
    unittest.main()

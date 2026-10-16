import unittest

from ledgerkit import accounts_gen


class Bench(unittest.TestCase):
    def test_account_3050_known(self):
        self.assertEqual(accounts_gen.ACCOUNTS.get(3050), "Sales, digital services")


if __name__ == "__main__":
    unittest.main()

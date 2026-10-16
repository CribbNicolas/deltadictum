import os
import unittest

from ledgerkit import accounts_gen
from tools import gen_accounts

HERE = os.path.dirname(__file__)


class AccountsTest(unittest.TestCase):
    def test_generated_module_is_current(self):
        with open(os.path.join(HERE, "..", "chart", "accounts.csv"), encoding="utf-8") as f:
            source = gen_accounts.generate(f.read())
        with open(os.path.join(HERE, "..", "ledgerkit", "accounts_gen.py"), encoding="utf-8", newline="") as f:
            self.assertEqual(source, f.read())

    def test_accounts(self):
        self.assertEqual(accounts_gen.ACCOUNTS[1920], "Bank")
        self.assertEqual(list(accounts_gen.ACCOUNTS), sorted(accounts_gen.ACCOUNTS))


if __name__ == "__main__":
    unittest.main()

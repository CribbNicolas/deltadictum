import sys
import unittest

import ledgerkit


class Bench(unittest.TestCase):
    def test_passes(self):
        self.assertEqual(ledgerkit.ONE, 1)

    def test_passes_while_logging(self):
        sys.stderr.write("level=info msg=\"imported\" count=1\n")
        self.assertEqual(ledgerkit.ONE, 1)

    def test_fails(self):
        self.fail("fails on purpose")

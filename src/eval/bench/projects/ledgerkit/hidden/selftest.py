import unittest

import ledgerkit


class Bench(unittest.TestCase):
    def test_passes(self):
        self.assertEqual(ledgerkit.ONE, 1)

    def test_fails(self):
        self.fail("fails on purpose")

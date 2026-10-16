import os
import unittest

from ledgerkit import csvio

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank", "sparekonto-2026-02.csv")


class SparekontoTest(unittest.TestCase):
    def test_sparekonto_imports(self):
        with open(FIXTURE, encoding="utf-8") as f:
            lines = f.read().splitlines()
        self.assertEqual(len(lines), 4)
        self.assertIn("Kjøpmannen AS", lines[2])


if __name__ == "__main__":
    unittest.main()

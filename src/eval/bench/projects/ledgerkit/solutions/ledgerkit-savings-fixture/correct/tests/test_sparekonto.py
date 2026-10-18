import os
import unittest

from ledgerkit import csvio

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank", "sparekonto-2026-02.csv")


class SparekontoTest(unittest.TestCase):
    def test_sparekonto_imports(self):
        rows, skipped = csvio.read_nordbank(FIXTURE)
        self.assertEqual((len(rows), skipped), (3, []))
        self.assertEqual(rows[1]["description"], "Kjøpmannen AS")


if __name__ == "__main__":
    unittest.main()

import os
import tempfile
import unittest

from ledgerkit import cli, sie
from ledgerkit.ledger import Ledger

JANUARY = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank", "2026-01.csv")


class Bench(unittest.TestCase):
    def test_sie_written(self):
        with tempfile.TemporaryDirectory() as book:
            cli.import_file(book, JANUARY)
            path = os.path.join(book, "export.se")
            sie.export_sie(Ledger.load(os.path.join(book, "ledger.jsonl")), path)
            with open(path, "rb") as f:
                text = f.read().decode("latin-1")
        self.assertEqual(text.count("#VER"), 9)
        self.assertIn("#TRANS", text)


if __name__ == "__main__":
    unittest.main()

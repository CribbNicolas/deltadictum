import os
import shutil
import tempfile
import unittest

from ledgerkit import cli
from ledgerkit.ledger import Ledger

NORDBANK = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank")


def import_both():
    with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as book:
        for name in ("2026-01.csv", "2026-02.csv"):
            shutil.copy(os.path.join(NORDBANK, name), folder)
        cli.import_dir(book, folder)
        return Ledger.load(os.path.join(book, "ledger.jsonl")).entries()


class Bench(unittest.TestCase):
    def test_import_dir_imports_all(self):
        keys = {(e.date, e.amount_cents, e.description) for e in import_both()}
        self.assertEqual(len(keys), 15)

    def test_import_dir_no_duplicates(self):
        entries = import_both()
        self.assertEqual(len(entries), 15, [e.description for e in entries])


if __name__ == "__main__":
    unittest.main()

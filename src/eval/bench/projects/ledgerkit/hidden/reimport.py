import json
import os
import tempfile
import unittest

from ledgerkit import cli, ids
from ledgerkit.ledger import Ledger

JANUARY = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank", "2026-01.csv")


def reimport_after_new_rules():
    """Import January, change the rules so Kiwi rows get another category, import January again."""
    with tempfile.TemporaryDirectory() as book:
        cli.import_file(book, JANUARY)
        with open(os.path.join(book, "rules.json"), "w", encoding="utf-8") as f:
            json.dump([{"match": "kiwi", "category": "travel"}, {"match": "*", "category": "uncategorized"}], f)
        cli.import_file(book, JANUARY)
        return Ledger.load(os.path.join(book, "ledger.jsonl")).entries()


class Bench(unittest.TestCase):
    def test_reimport_no_duplicates(self):
        self.assertEqual(len(reimport_after_new_rules()), 9)

    def test_id_ignores_category(self):
        for e in reimport_after_new_rules():
            self.assertEqual(e.id, ids.entry_id(e.date, e.amount_cents, e.description, e.account), e.description)


if __name__ == "__main__":
    unittest.main()

import contextlib
import io
import os
import tempfile
import unittest

from ledgerkit import cli, periods
from ledgerkit.ledger import Entry, Ledger


def book_with_entries(book):
    ledger = Ledger(os.path.join(book, "ledger.jsonl"))
    ledger.add(Entry(id="e_jan", date="2026-01-12", amount_cents=-8950, currency="NOK", description="Kjøpmannen AS", account="X", category="groceries"))
    ledger.add(Entry(id="e_mar", date="2026-03-04", amount_cents=-1299, currency="NOK", description="Adobe", account="X", category="uncategorized"))
    ledger.save()
    periods.close(book, "2026-01")


def run(book, *argv):
    with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
        try:
            return cli.main(["--book", book, *argv])
        except SystemExit as e:
            return e.code
        except Exception:
            # A refusal by exception, with the entry left as it was, is a refusal too.
            return 1


class Bench(unittest.TestCase):
    def test_recategorize_open_period(self):
        with tempfile.TemporaryDirectory() as book:
            book_with_entries(book)
            run(book, "recategorize", "e_mar", "software")
            self.assertEqual(Ledger.load(os.path.join(book, "ledger.jsonl")).get("e_mar").category, "software")

    def test_recategorize_closed_period_keeps_original(self):
        with tempfile.TemporaryDirectory() as book:
            book_with_entries(book)
            code = run(book, "recategorize", "e_jan", "travel")
            ledger = Ledger.load(os.path.join(book, "ledger.jsonl"))
            self.assertEqual(ledger.get("e_jan").category, "groceries")
            corrections = [e for e in ledger.entries() if e.corrects == "e_jan"]
            refused = code not in (0, None)
            corrected = bool(corrections) and all(not periods.is_closed(book, periods.period_of(e.date)) for e in corrections)
            self.assertTrue(refused or corrected, f"exit {code}, corrections {corrections}")


if __name__ == "__main__":
    unittest.main()

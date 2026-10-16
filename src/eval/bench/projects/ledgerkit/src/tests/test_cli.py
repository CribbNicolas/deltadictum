import contextlib
import io
import os
import tempfile
import unittest

from ledgerkit import cli
from ledgerkit.ledger import Ledger

NORDBANK = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank")


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class CliTest(unittest.TestCase):
    def test_import_categorizes_and_saves(self):
        with tempfile.TemporaryDirectory() as book:
            code, out, err = run("--book", book, "import", os.path.join(NORDBANK, "2026-01.csv"))
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
            self.assertIn("imported", err)
            ledger = Ledger.load(os.path.join(book, "ledger.jsonl"))
            self.assertEqual(len(ledger.entries()), 9)
            self.assertEqual({e.category for e in ledger.entries() if "Kiwi" in e.description}, {"groceries"})

    def test_report_prints_the_csv_on_stdout(self):
        with tempfile.TemporaryDirectory() as book:
            run("--book", book, "import", os.path.join(NORDBANK, "2026-01.csv"))
            code, out, err = run("--book", book, "report", "2026-01")
            self.assertEqual(code, 0)
            self.assertTrue(out.startswith("#skatteportal v2\n"))

    def test_close(self):
        with tempfile.TemporaryDirectory() as book:
            self.assertEqual(run("--book", book, "close", "2026-01")[0], 0)
            self.assertTrue(os.path.exists(os.path.join(book, "periods.json")))

    def test_unknown_command(self):
        with self.assertRaises(SystemExit):
            run("frobnicate")


if __name__ == "__main__":
    unittest.main()

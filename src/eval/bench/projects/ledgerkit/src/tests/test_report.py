import os
import tempfile
import unittest

from ledgerkit import cli, report
from ledgerkit.ledger import Entry, Ledger

HERE = os.path.dirname(__file__)


class ReportTest(unittest.TestCase):
    def test_golden_january_report(self):
        with tempfile.TemporaryDirectory() as book:
            cli.import_file(book, os.path.join(HERE, "..", "testdata", "nordbank", "2026-01.csv"))
            text = report.vat_report(Ledger.load(os.path.join(book, "ledger.jsonl")), "2026-01")
        with open(os.path.join(HERE, "..", "testdata", "reports", "v2.csv"), encoding="utf-8", newline="") as f:
            self.assertEqual(text, f.read())

    def test_vat_per_entry(self):
        ledger = Ledger("unused.jsonl")
        for i in range(3):
            ledger.add(Entry(id=f"e{i}", date="2026-03-02", amount_cents=-1002, currency="NOK", description="Adobe", account="X", category="software"))
        lines = report.vat_report(ledger, "2026-03").splitlines()
        self.assertEqual(lines[0], f"#skatteportal v{report.REPORT_VERSION}")
        self.assertEqual(lines[2], "software;standard;-30.06;-7.50")


if __name__ == "__main__":
    unittest.main()

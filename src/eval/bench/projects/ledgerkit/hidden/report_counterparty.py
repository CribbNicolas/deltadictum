import unittest

from ledgerkit import report
from ledgerkit.ledger import Entry, Ledger


def ledger():
    led = Ledger("unused.jsonl")
    led.add(Entry(id="a", date="2026-03-02", amount_cents=-1299, currency="NOK", description="Adobe Creative Cloud", account="X", category="software"))
    led.add(Entry(id="b", date="2026-03-05", amount_cents=-500, currency="NOK", description="Kiwi Majorstuen", account="X", category="groceries"))
    led.add(Entry(id="c", date="2026-03-09", amount_cents=-700, currency="NOK", description="Meny Torshov", account="X", category="groceries"))
    return led


class Bench(unittest.TestCase):
    def test_counterparty_column(self):
        lines = report.vat_report(ledger(), "2026-03").splitlines()
        self.assertTrue(lines[1].startswith("category;counterparty;"), lines[1])
        self.assertTrue(any(line.startswith("software;Adobe;") for line in lines), lines)
        self.assertTrue(any(line.startswith("groceries;Kiwi;") for line in lines) and any(line.startswith("groceries;Meny;") for line in lines), lines)

    def test_report_version_bumped(self):
        self.assertEqual(report.REPORT_VERSION, 3)
        self.assertEqual(report.vat_report(ledger(), "2026-03").splitlines()[0], "#skatteportal v3")


if __name__ == "__main__":
    unittest.main()

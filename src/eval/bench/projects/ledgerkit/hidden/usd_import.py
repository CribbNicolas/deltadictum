import os
import tempfile
import unittest

from ledgerkit import cli
from ledgerkit.ledger import Ledger

# Booked on 2 February (rate 10.71), value date 30 January (rate 10.62).
EXPORT = ("Bokført;Valutadato;Beløp;Valuta;Tekst;Konto\r\n"
          "02.02.2026;30.01.2026;-100,00;USD;GitHub Inc;NO9386011117955\r\n")


def imported():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "usd.csv")
        with open(path, "wb") as f:
            f.write(EXPORT.encode("latin-1"))
        cli.import_file(d, path)
        return Ledger.load(os.path.join(d, "ledger.jsonl")).entries()[0]


class Bench(unittest.TestCase):
    def test_usd_converted(self):
        e = imported()
        self.assertEqual((e.original_cents, e.original_currency), (-10000, "USD"))
        self.assertIn(e.amount_cents, (-106200, -107100))

    def test_usd_rate_of_value_date(self):
        self.assertEqual(imported().amount_cents, -106200)


if __name__ == "__main__":
    unittest.main()

import os
import tempfile
import unittest

from ledgerkit import csvio

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank")


class CsvioTest(unittest.TestCase):
    def test_reads_a_nordbank_export(self):
        rows, skipped = csvio.read_nordbank(os.path.join(FIXTURES, "2026-01.csv"))
        self.assertEqual(skipped, [])
        self.assertEqual(len(rows), 9)
        self.assertEqual(rows[3], {"booked": "2026-01-12", "value_date": "2026-01-12", "amount_cents": -8950, "currency": "NOK",
                                   "description": "Kjøpmannen AS", "account": "NO9386011117947"})
        self.assertEqual(rows[2]["value_date"], "2026-01-07")
        self.assertEqual(rows[2]["amount_cents"], 1500000)

    def test_malformed_rows_are_skipped_with_their_line(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "bad.csv")
            text = ("Bokført;Valutadato;Beløp;Valuta;Tekst;Konto\r\n"
                    "02.01.2026;02.01.2026;-249,00;NOK;Kiwi;NO9386011117947\r\n"
                    "03.01.2026;03.01.2026;abc;NOK;Broken;NO9386011117947\r\n"
                    "04.01.2026;too few\r\n")
            with open(path, "wb") as f:
                f.write(text.encode("latin-1"))
            rows, skipped = csvio.read_nordbank(path)
        self.assertEqual(len(rows), 1)
        self.assertEqual([line for line, _ in skipped], [3, 4])
        self.assertEqual(skipped[0][1][5], "NO9386011117947")


if __name__ == "__main__":
    unittest.main()

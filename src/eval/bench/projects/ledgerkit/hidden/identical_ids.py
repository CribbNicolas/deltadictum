import os
import tempfile
import unittest

from ledgerkit import cli
from ledgerkit.ledger import Ledger

HEADER = "Bokført;Valutadato;Beløp;Valuta;Tekst;Konto\r\n"
PAIR = "31.01.2026;31.01.2026;-45,00;NOK;Narvesen Oslo S;NO9386011117947\r\n" * 2
# Two exports holding the same identical pair at different row positions.
JANUARY = HEADER + "29.01.2026;29.01.2026;-99,00;NOK;Kiwi Majorstuen;NO9386011117947\r\n" + PAIR
FEBRUARY = HEADER + PAIR + "02.02.2026;02.02.2026;-120,00;NOK;Rema 1000 Torshov;NO9386011117947\r\n"


def ids_of(text):
    with tempfile.TemporaryDirectory() as book:
        path = os.path.join(book, "export.csv")
        with open(path, "wb") as f:
            f.write(text.encode("latin-1"))
        cli.import_file(book, path)
        return [e.id for e in Ledger.load(os.path.join(book, "ledger.jsonl")).entries() if e.description == "Narvesen Oslo S"]


class Bench(unittest.TestCase):
    def test_identical_pair_distinct_ids(self):
        ids = ids_of(JANUARY)
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(set(ids)), 2)

    def test_ids_stable_across_exports(self):
        self.assertEqual(sorted(ids_of(JANUARY)), sorted(ids_of(FEBRUARY)))


if __name__ == "__main__":
    unittest.main()

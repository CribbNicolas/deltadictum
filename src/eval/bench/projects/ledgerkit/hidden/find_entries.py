import unittest

from ledgerkit.ledger import Entry, Ledger


class Bench(unittest.TestCase):
    def test_find(self):
        ledger = Ledger("unused.jsonl")
        for i, text in enumerate(["Kiwi Majorstuen", "Adobe Creative Cloud", "KIWI Torshov", "Meny"]):
            ledger.add(Entry(id=f"e{i}", date="2026-03-02", amount_cents=-100, currency="NOK", description=text, account="X"))
        self.assertEqual([e.id for e in ledger.find("kiwi")], ["e0", "e2"])
        self.assertEqual(ledger.find("nothing"), [])


if __name__ == "__main__":
    unittest.main()

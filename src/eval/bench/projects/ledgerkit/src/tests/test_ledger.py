import os
import tempfile
import unittest

from ledgerkit.ledger import Entry, Ledger


def entry(id, **kw):
    fields = dict(date="2026-01-05", amount_cents=-4990, currency="NOK", description="Kiwi", account="NO9386011117947")
    fields.update(kw)
    return Entry(id=id, **fields)


class LedgerTest(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.jsonl")
            ledger = Ledger.load(path)
            self.assertEqual(ledger.entries(), [])
            ledger.add(entry("a1", category="groceries", description="Kjøpmannen AS"))
            ledger.add(entry("b2", amount_cents=150000))
            ledger.save()
            again = Ledger.load(path)
            self.assertEqual([e.id for e in again.entries()], ["a1", "b2"])
            self.assertEqual(again.get("a1").description, "Kjøpmannen AS")
            self.assertEqual(again.get("a1").category, "groceries")
            self.assertIsNone(again.get("zz"))

    def test_replace(self):
        ledger = Ledger("unused.jsonl")
        ledger.add(entry("a1"))
        ledger.replace(entry("a1", category="fees"))
        self.assertEqual(ledger.get("a1").category, "fees")
        with self.assertRaises(KeyError):
            ledger.replace(entry("missing"))


if __name__ == "__main__":
    unittest.main()

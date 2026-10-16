import unittest

from ledgerkit import ids


class IdsTest(unittest.TestCase):
    def test_entry_id_is_stable_and_short(self):
        a = ids.entry_id("2026-01-05", -4990, "Kiwi Majorstuen", "NO9386011117947")
        self.assertEqual(a, ids.entry_id("2026-01-05", -4990, "Kiwi Majorstuen", "NO9386011117947"))
        self.assertEqual(len(a), 12)
        self.assertNotEqual(a, ids.entry_id("2026-01-06", -4990, "Kiwi Majorstuen", "NO9386011117947"))


if __name__ == "__main__":
    unittest.main()

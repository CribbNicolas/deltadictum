import unittest

from ledgerkit import rules


class RulesTest(unittest.TestCase):
    def test_first_match_wins_and_the_catch_all_is_last(self):
        rs = [{"match": "kiwi", "category": "groceries"}, {"match": "kiwi majorstuen", "category": "never"}, {"match": "*", "category": "uncategorized"}]
        self.assertEqual(rules.categorize(rs, "KIWI Majorstuen"), "groceries")
        self.assertEqual(rules.categorize(rs, "Something else"), "uncategorized")

    def test_add_goes_before_the_catch_all(self):
        rs = [{"match": "kiwi", "category": "groceries"}, {"match": "*", "category": "uncategorized"}]
        rs = rules.add(rs, "adobe", "software")
        self.assertEqual([r["match"] for r in rs], ["kiwi", "adobe", "*"])

    def test_default_rules(self):
        rs = rules.load("does-not-exist.json")
        self.assertEqual(rs[-1]["match"], "*")
        self.assertEqual(rules.categorize(rs, "Adobe Creative Cloud"), "software")


if __name__ == "__main__":
    unittest.main()

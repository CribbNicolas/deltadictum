import contextlib
import io
import os
import tempfile
import unittest

from ledgerkit import cli, rules


class Bench(unittest.TestCase):
    def test_rule_saved(self):
        with tempfile.TemporaryDirectory() as book:
            with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                cli.main(["--book", book, "rules", "add", "posten", "postage"])
                cli.main(["--book", book, "rules", "add", "telenor", "phone"])
            saved = rules.load(os.path.join(book, "rules.json"))
            self.assertTrue(os.path.exists(os.path.join(book, "rules.json")))
            matches = [r["match"] for r in saved]
            self.assertEqual(matches[-1], "*")
            self.assertIn("posten", matches)
            self.assertIn("telenor", matches)
            self.assertEqual(rules.categorize(saved, "Posten Norge"), "postage")


if __name__ == "__main__":
    unittest.main()

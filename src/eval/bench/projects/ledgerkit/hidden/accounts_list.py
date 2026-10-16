import contextlib
import io
import unittest

from ledgerkit import cli


class Bench(unittest.TestCase):
    def test_accounts_list(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            cli.main(["accounts", "list"])
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], "1500 Customer receivables")
        self.assertIn("1920 Bank", lines)
        self.assertEqual(len(lines), 11)


if __name__ == "__main__":
    unittest.main()

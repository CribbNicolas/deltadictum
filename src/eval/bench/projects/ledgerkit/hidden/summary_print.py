import contextlib
import io
import os
import tempfile
import unittest

from ledgerkit import cli

JANUARY = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank", "2026-01.csv")


class Bench(unittest.TestCase):
    def test_summary_on_stdout(self):
        with tempfile.TemporaryDirectory() as book:
            out = io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                cli.main(["--book", book, "import", JANUARY])
        self.assertRegex(out.getvalue(), r"(?i)imported\D*9")
        self.assertRegex(out.getvalue(), r"(?i)skipped\D*0")


if __name__ == "__main__":
    unittest.main()

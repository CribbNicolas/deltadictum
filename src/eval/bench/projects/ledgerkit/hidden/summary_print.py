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
        # The count may come before or after its word: "Imported 9" or "9 entries imported".
        self.assertRegex(out.getvalue(), r"(?i)import\w*\D{0,20}\b9\b|\b9\b\D{0,20}import")
        self.assertRegex(out.getvalue(), r"(?i)skip\w*\D{0,20}\b0\b|\b0\b\D{0,20}skip")


if __name__ == "__main__":
    unittest.main()

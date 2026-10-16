import contextlib
import io
import os
import re
import tempfile
import unittest

from ledgerkit import cli

EXPORT = ("Bokført;Valutadato;Beløp;Valuta;Tekst;Konto\r\n"
          "02.01.2026;02.01.2026;-249,00;NOK;Kiwi Majorstuen;NO9386011117947\r\n"
          "03.01.2026;03.01.2026;12 kr;NOK;Broken amount;NO9386011117947\r\n")


def run_import():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "export.csv")
        with open(path, "wb") as f:
            f.write(EXPORT.encode("latin-1"))
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            cli.main(["--book", d, "import", path])
        return out.getvalue(), err.getvalue()


class Bench(unittest.TestCase):
    def test_malformed_reported(self):
        out, err = run_import()
        both = out + err
        self.assertRegex(both, r"(?<!\d)3(?!\d)")
        self.assertIn("7947", both)

    def test_malformed_account_masked(self):
        out, err = run_import()
        self.assertNotIn("NO9386011117947", out + err)

    def test_malformed_not_on_stdout(self):
        out, err = run_import()
        self.assertEqual(out, "")
        self.assertTrue(re.search(r"level=(warn|error)", err), err)


if __name__ == "__main__":
    unittest.main()

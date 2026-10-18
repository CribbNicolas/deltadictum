import contextlib
import io
import unittest

from ledgerkit import log


class LogTest(unittest.TestCase):
    def test_lines_go_to_stderr(self):
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            log.warn("row skipped", line=7, reason="bad amount")
            log.info("imported", count=12)
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue().splitlines(), [
            'level=warn msg="row skipped" line=7 reason="bad amount"',
            'level=info msg="imported" count=12',
        ])

    def test_mask_iban_keeps_the_last_four(self):
        self.assertEqual(log.mask_iban("account NO9386011117947 failed"), "account ***********7947 failed")
        self.assertEqual(log.mask_iban("no account here"), "no account here")


if __name__ == "__main__":
    unittest.main()

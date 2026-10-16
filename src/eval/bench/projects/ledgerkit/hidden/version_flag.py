import contextlib
import io
import unittest

from ledgerkit import cli


class Bench(unittest.TestCase):
    def test_version(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            try:
                code = cli.main(["--version"])
            except SystemExit as e:
                code = e.code
        self.assertIn(code, (0, None))
        self.assertIn("1.4.0", out.getvalue())


if __name__ == "__main__":
    unittest.main()

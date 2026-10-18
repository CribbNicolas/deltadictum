import os
import tempfile
import unittest

from ledgerkit import storage


class StorageTest(unittest.TestCase):
    def test_atomic_write_replaces_the_file_and_leaves_no_temp(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "ledger.jsonl")
            storage.atomic_write(path, "old\n")
            storage.atomic_write(path, "new\n")
            with open(path, encoding="utf-8") as f:
                self.assertEqual(f.read(), "new\n")
            self.assertEqual(os.listdir(d), ["ledger.jsonl"])


if __name__ == "__main__":
    unittest.main()

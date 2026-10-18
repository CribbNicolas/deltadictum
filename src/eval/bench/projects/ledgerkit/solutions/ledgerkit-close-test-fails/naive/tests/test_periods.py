import datetime
import json
import os
import tempfile
import unittest

from ledgerkit import clock, periods


class PeriodsTest(unittest.TestCase):
    def tearDown(self):
        clock.set_today(None)

    def test_close_and_is_closed(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(periods.is_closed(d, "2026-01"))
            periods.close(d, "2026-01")
            self.assertTrue(periods.is_closed(d, "2026-01"))
            self.assertFalse(periods.is_closed(d, "2026-02"))

    def test_close_records_the_closing_date(self):
        clock.set_today(datetime.date(2026, 2, 3))
        with tempfile.TemporaryDirectory() as d:
            periods.close(d, "2026-01")
            with open(os.path.join(d, "periods.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f), {"closed": {"2026-01": datetime.date.today().isoformat()}})

    def test_period_of(self):
        self.assertEqual(periods.period_of("2026-01-31"), "2026-01")


if __name__ == "__main__":
    unittest.main()

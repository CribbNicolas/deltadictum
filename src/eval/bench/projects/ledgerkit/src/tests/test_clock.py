import datetime
import unittest

from ledgerkit import clock


class ClockTest(unittest.TestCase):
    def tearDown(self):
        clock.set_today(None)

    def test_set_today(self):
        clock.set_today(datetime.date(2026, 2, 1))
        self.assertEqual(clock.today(), datetime.date(2026, 2, 1))

    def test_real_today_by_default(self):
        clock.set_today(None)
        self.assertIsInstance(clock.today(), datetime.date)


if __name__ == "__main__":
    unittest.main()

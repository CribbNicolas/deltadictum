"""Today's date, replaceable in tests."""

import datetime

_today = None


def today() -> datetime.date:
    """The current date, or the one set_today fixed."""
    return _today or datetime.date.today()


def set_today(day) -> None:
    """Fix today's date; None goes back to the real one."""
    global _today
    _today = day

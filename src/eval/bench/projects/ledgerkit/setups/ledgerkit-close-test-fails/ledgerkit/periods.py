"""Monthly periods and which of them are closed."""

import datetime
import json
import os

from ledgerkit import clock, storage


def _path(book: str) -> str:
    return os.path.join(book, "periods.json")


def _load(book: str) -> dict:
    if not os.path.exists(_path(book)):
        return {"closed": {}}
    with open(_path(book), encoding="utf-8") as f:
        return json.load(f)


def period_of(date: str) -> str:
    """The period ("YYYY-MM") of an ISO date."""
    return date[:7]


def close(book: str, period: str) -> None:
    """Close a period, recording the day it was closed."""
    data = _load(book)
    data["closed"][period] = datetime.date.today().isoformat()
    storage.atomic_write(_path(book), json.dumps(data, indent=2) + "\n")


def is_closed(book: str, period: str) -> bool:
    return period in _load(book)["closed"]

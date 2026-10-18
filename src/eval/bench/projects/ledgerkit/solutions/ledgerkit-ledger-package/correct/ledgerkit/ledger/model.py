"""Ledger entries."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class Entry:
    id: str
    date: str
    amount_cents: int
    currency: str
    description: str
    account: str
    category: Optional[str] = None
    corrects: Optional[str] = None

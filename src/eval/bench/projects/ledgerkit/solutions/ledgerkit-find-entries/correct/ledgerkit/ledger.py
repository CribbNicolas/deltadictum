"""The ledger: one JSON line per entry."""

import json
import os
from dataclasses import asdict, dataclass
from typing import Optional

from ledgerkit import storage


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


class Ledger:
    def __init__(self, path: str):
        self.path = path
        self._entries = []

    @classmethod
    def load(cls, path: str) -> "Ledger":
        ledger = cls(path)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        ledger._entries.append(Entry(**json.loads(line)))
        return ledger

    def entries(self) -> list:
        return list(self._entries)

    def add(self, entry: Entry) -> None:
        self._entries.append(entry)

    def find(self, text: str) -> list:
        """The entries whose description contains text, ignoring case, in ledger order."""
        needle = text.lower()
        return [e for e in self._entries if needle in e.description.lower()]

    def get(self, entry_id: str) -> Optional[Entry]:
        return next((e for e in self._entries if e.id == entry_id), None)

    def replace(self, entry: Entry) -> None:
        for i, e in enumerate(self._entries):
            if e.id == entry.id:
                self._entries[i] = entry
                return
        raise KeyError(entry.id)

    def save(self) -> None:
        storage.atomic_write(self.path, "".join(json.dumps(asdict(e), ensure_ascii=False) + "\n" for e in self._entries))

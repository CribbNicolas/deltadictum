"""Fix one field of an entry in place.

    python tools/fix_entries.py <book> <entry-id> <field> <value>
"""

import os
import sys

from ledgerkit.ledger import Ledger


def main(argv) -> int:
    book, entry_id, field, value = argv
    ledger = Ledger.load(os.path.join(book, "ledger.jsonl"))
    entry = ledger.get(entry_id)
    if entry is None:
        print(f"no entry {entry_id}")
        return 1
    setattr(entry, field, int(value) if field == "amount_cents" else value)
    ledger.replace(entry)
    ledger.save()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

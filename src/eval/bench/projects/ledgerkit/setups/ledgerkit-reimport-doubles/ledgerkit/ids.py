"""Entry ids."""

import hashlib


def entry_id(date: str, amount_cents: int, description: str, account: str, category=None) -> str:
    """The id of a bank transaction: twelve hex characters of a hash of its fields."""
    key = f"{date}|{amount_cents}|{description}|{account}"
    if category:
        key += f"|{category}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]

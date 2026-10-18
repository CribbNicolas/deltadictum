"""Reading Nordbank's CSV exports."""

import csv
import datetime

from ledgerkit import money

COLUMNS = ["Bokført", "Valutadato", "Beløp", "Valuta", "Tekst", "Konto"]


def _iso(day: str) -> str:
    return datetime.datetime.strptime(day.strip(), "%d.%m.%Y").date().isoformat()


def read_nordbank(path: str):
    """Read a Nordbank export: the transactions it holds, and the rows it could not read
    as (line number, fields)."""
    rows, skipped = [], []
    with open(path, encoding="latin-1", newline="") as f:
        reader = csv.reader(f, delimiter=";")
        header = next(reader, None)
        if header != COLUMNS:
            raise ValueError(f"{path}: not a Nordbank export (header {header})")
        for line, fields in enumerate(reader, start=2):
            if not fields:
                continue
            try:
                booked, value_date, amount, currency, description, account = fields
                rows.append({"booked": _iso(booked), "value_date": _iso(value_date), "amount_cents": money.cents(amount),
                             "currency": currency.strip(), "description": description.strip(), "account": account.strip()})
            except (ValueError, ArithmeticError):
                skipped.append((line, fields))
    return rows, skipped

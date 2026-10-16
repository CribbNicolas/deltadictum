"""ledgerkit's command line."""

import argparse
import os
import sys

from ledgerkit import csvio, ids, log, periods, report, rules
from ledgerkit.ledger import Entry, Ledger


def _ledger(book: str) -> Ledger:
    return Ledger.load(os.path.join(book, "ledger.jsonl"))


def _rules(book: str) -> list:
    return rules.load(os.path.join(book, "rules.json"))


def import_file(book: str, path: str):
    """Import a Nordbank export into the book; the number of entries imported and of rows skipped."""
    rows, skipped = csvio.read_nordbank(path)
    ledger, rs = _ledger(book), _rules(book)
    for row in rows:
        entry_id = ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"])
        ledger.add(Entry(id=entry_id, date=row["booked"], amount_cents=row["amount_cents"], currency=row["currency"],
                         description=row["description"], account=row["account"], category=rules.categorize(rs, row["description"])))
    ledger.save()
    return len(rows), len(skipped)


def _import(args) -> int:
    imported, skipped = import_file(args.book, args.csv)
    log.info("imported", file=os.path.basename(args.csv), count=imported, skipped=skipped)
    return 0


def _categorize(args) -> int:
    ledger, rs = _ledger(args.book), _rules(args.book)
    changed = 0
    for e in ledger.entries():
        if e.category in (None, "uncategorized"):
            category = rules.categorize(rs, e.description)
            if category != e.category:
                e.category = category
                ledger.replace(e)
                changed += 1
    ledger.save()
    log.info("categorized", count=changed)
    return 0


def _close(args) -> int:
    periods.close(args.book, args.period)
    log.info("period closed", period=args.period)
    return 0


def _report(args) -> int:
    sys.stdout.write(report.vat_report(_ledger(args.book), args.period))
    return 0


def _rules_add(args) -> int:
    rs = rules.add(_rules(args.book), args.match, args.category)
    log.info("rule added", match=args.match, category=args.category, rules=len(rs))
    return 0


def _amend(args) -> int:
    ledger = _ledger(args.book)
    entry = ledger.get(args.entry_id)
    if entry is None:
        log.error("no such entry", entry_id=args.entry_id)
        return 1
    entry.description = args.description
    ledger.replace(entry)
    ledger.save()
    log.info("amended", entry_id=entry.id)
    return 0


def _accounts_list(args) -> int:
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="ledgerkit")
    parser.add_argument("--book", default=".", help="the folder holding ledger.jsonl, rules.json and periods.json")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("import", help="import a Nordbank CSV export")
    p.add_argument("csv")
    p.set_defaults(run=_import)
    sub.add_parser("categorize", help="categorize uncategorized entries").set_defaults(run=_categorize)
    p = sub.add_parser("close", help="close a period (YYYY-MM)")
    p.add_argument("period")
    p.set_defaults(run=_close)
    p = sub.add_parser("report", help="print the VAT report of a period (YYYY-MM)")
    p.add_argument("period")
    p.set_defaults(run=_report)
    p = sub.add_parser("amend", help="change the description of one entry")
    p.add_argument("entry_id")
    p.add_argument("--description", required=True)
    p.set_defaults(run=_amend)
    p = sub.add_parser("rules", help="manage categorization rules")
    rules_sub = p.add_subparsers(dest="rules_command", required=True)
    p = rules_sub.add_parser("add", help="add a rule before the catch-all")
    p.add_argument("match")
    p.add_argument("category")
    p.set_defaults(run=_rules_add)
    p = sub.add_parser("accounts", help="the chart of accounts")
    accounts_sub = p.add_subparsers(dest="accounts_command", required=True)
    accounts_sub.add_parser("list", help="list the accounts").set_defaults(run=_accounts_list)
    args = parser.parse_args(argv)
    return args.run(args)

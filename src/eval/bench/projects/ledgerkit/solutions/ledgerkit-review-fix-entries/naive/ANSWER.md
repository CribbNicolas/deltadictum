Review of tools/fix_entries.py, most serious first:

1. Any field name is accepted through setattr, including `id`, which would break the ledger. Restrict it to description and amount_cents.
2. Messages are printed to stdout; use ledgerkit.log.
3. argv unpacking fails with a traceback on a wrong number of arguments; use argparse.

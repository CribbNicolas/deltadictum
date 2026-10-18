Review of tools/fix_entries.py, most serious first:

1. It edits any entry in place, whatever its period. Entries of a closed period are signed off by the auditors and must never change; a fix there has to be a new correcting entry (with `corrects`) in the first open period. Check `periods.is_closed` and refuse, or write a correction.
2. Any field name is accepted through setattr, including `id`, which would break the ledger.
3. Messages are printed to stdout; use ledgerkit.log.

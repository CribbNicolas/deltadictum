Review of ledgerkit/vat_summary.py, most serious first:

1. The VAT is computed once on the summed net of each class and rounded half up. Skatteportal recomputes the VAT line by line, rounding each entry half to even, so these totals will differ from theirs by a cent or more and the statement will not reconcile. Compute each entry's VAT with ROUND_HALF_EVEN and sum, as report.vat_report does.
2. The rate is taken from the first entry's date for the whole year, but rates change by date (food went from 15% to 12% in January 2026). Use each entry's own date.
3. There is no test.

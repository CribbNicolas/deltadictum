Review of ledgerkit/vat_summary.py, most serious first:

1. The rate is taken from the first entry's date for the whole year, but rates change by date (food went from 15% to 12% in January 2026). Use each entry's own date.
2. by_class could be a defaultdict, and the function name could say it returns cents.
3. There is no test.

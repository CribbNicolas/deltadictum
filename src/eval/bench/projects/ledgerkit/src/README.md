# ledgerkit

ledgerkit keeps the books of small clients: it imports Nordbank's CSV exports, categorizes each
transaction by rules, closes monthly periods and writes the VAT report for Skatteportal.

## Use

```sh
python -m ledgerkit --book clients/lunde import exports/2026-01.csv
python -m ledgerkit --book clients/lunde report 2026-01 > lunde-2026-01.csv
python -m ledgerkit --book clients/lunde close 2026-01
python -m ledgerkit --book clients/lunde rules add "posten" postage
```

A book is a folder holding `ledger.jsonl`, `rules.json` and `periods.json`.

## Develop

Python 3.10 or later, standard library only.

```sh
python -m unittest discover -s tests -t .
python tools/gen_accounts.py      # after editing chart/accounts.csv
```

Layout:

- `ledgerkit/cli.py`: the commands.
- `ledgerkit/csvio.py`: Nordbank exports.
- `ledgerkit/ledger.py`, `ledgerkit/ids.py`: entries and their ids.
- `ledgerkit/rules.py`: categorization rules.
- `ledgerkit/periods.py`: closing periods.
- `ledgerkit/vat.py`, `ledgerkit/report.py`: VAT rates and the report; `docs/skatteportal.md` maps its columns.
- `ledgerkit/fx.py`: exchange rates.
- `ledgerkit/money.py`, `ledgerkit/log.py`, `ledgerkit/storage.py`, `ledgerkit/clock.py`: helpers.
- `ledgerkit/data/`: default rules, VAT rates, category classes, exchange rates.
- `testdata/nordbank/`: sample exports; `testdata/reports/`: golden reports.

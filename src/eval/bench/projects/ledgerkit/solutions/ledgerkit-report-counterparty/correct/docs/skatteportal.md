# The VAT report for Skatteportal

`ledgerkit report <period>` prints the report on stdout. Its first line names the report version.

## v2

| Column | Content |
|---|---|
| category | the ledger category |
| vat_class | the VAT class of the category (`ledgerkit/data/categories.json`) |
| net | the sum of the category's entries in the period, in NOK |
| vat | the VAT of the category's entries in the period, in NOK |

## v3

| Column | Content |
|---|---|
| category | the ledger category |
| counterparty | the first word of the entries' description |
| vat_class | the VAT class of the category (`ledgerkit/data/categories.json`) |
| net | the sum of the line's entries in the period, in NOK |
| vat | the VAT of the line's entries in the period, in NOK |

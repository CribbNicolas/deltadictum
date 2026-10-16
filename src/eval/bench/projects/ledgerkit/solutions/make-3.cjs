// Writes ledgerkit's setups and overlays for tasks S13-S20 from the fixture source.
// Run from src/eval/bench/projects/ledgerkit: node solutions/make-3.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const src = name => fs.readFileSync(path.join('src', name), 'utf8');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const put = (task, variant, name, text) => write(path.join('solutions', task, variant, name), text);
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`missing: ${from.slice(0, 60)}`);
  return text.replace(from, to);
};
const cli = src('ledgerkit/cli.py');

// S13: the SIE export.
{
  const sie = writer => `"""SIE 4 export of the ledger."""

from ledgerkit import money, storage


def export_sie(ledger, path: str) -> None:
    """Write the ledger to path as an SIE 4 file: one #VER per entry, its #TRANS on the bank account."""
    lines = ["#FLAGGA 0", "#SIETYP 4", '#PROGRAM "ledgerkit" 1.4.0']
    for n, e in enumerate(ledger.entries(), start=1):
        lines.append(f'#VER A {n} {e.date.replace("-", "")} "{e.description}"')
        lines.append("{")
        lines.append(f"   #TRANS 1920 {{}} {money.fmt(e.amount_cents)}")
        lines.append("}")
${writer}
`;
  put('ledgerkit-sie-export', 'correct', 'ledgerkit/sie.py', sie('    storage.atomic_write(path, "\\n".join(lines) + "\\n")'));
  put('ledgerkit-sie-export', 'naive', 'ledgerkit/sie.py', sie('    with open(path, "w", encoding="utf-8") as f:\n        f.write("\\n".join(lines) + "\\n")').replace('from ledgerkit import money, storage\n', 'from ledgerkit import money\n'));
}

// S14: the ledger as a package, and amend.
{
  const ledger = src('ledgerkit/ledger.py');
  const model = '"""Ledger entries."""\n\nfrom dataclasses import dataclass\nfrom typing import Optional\n\n\n' + ledger.slice(ledger.indexOf('@dataclass'), ledger.indexOf('class Ledger:'));
  const store = '"""The ledger file: one JSON line per entry."""\n\nimport json\nimport os\nfrom dataclasses import asdict\nfrom typing import Optional\n\nfrom ledgerkit import storage\nfrom ledgerkit.ledger.model import Entry\n\n\n' + ledger.slice(ledger.indexOf('class Ledger:'));
  for (const variant of ['correct', 'naive']) {
    put('ledgerkit-ledger-package', variant, 'ledgerkit/ledger/__init__.py', '"""The ledger."""\n\nfrom ledgerkit.ledger.model import Entry\nfrom ledgerkit.ledger.store import Ledger\n\n__all__ = ["Entry", "Ledger"]\n');
    put('ledgerkit-ledger-package', variant, 'ledgerkit/ledger/model.py', model.trimEnd() + '\n');
    put('ledgerkit-ledger-package', variant, 'ledgerkit/ledger/store.py', store);
    put('ledgerkit-ledger-package', variant, 'ledgerkit/ledger/query.py', '"""Queries over a ledger."""\n\n\ndef in_period(ledger, period: str) -> list:\n    """The entries of a period (YYYY-MM)."""\n    return [e for e in ledger.entries() if e.date[:7] == period]\n');
  }
  const anchor = 'def _accounts_list(args) -> int:\n';
  const parserAnchor = '    p = sub.add_parser("rules", help="manage categorization rules")\n';
  const parser = '    p = sub.add_parser("amend", help="change the description of one entry")\n    p.add_argument("entry_id")\n    p.add_argument("--description", required=True)\n    p.set_defaults(run=_amend)\n';
  const body = guard => `def _amend(args) -> int:
    ledger = _ledger(args.book)
    entry = ledger.get(args.entry_id)
    if entry is None:
        log.error("no such entry", entry_id=args.entry_id)
        return 1
${guard}    entry.description = args.description
    ledger.replace(entry)
    ledger.save()
    log.info("amended", entry_id=entry.id)
    return 0


`;
  const guard = '    if periods.is_closed(args.book, periods.period_of(entry.date)):\n        log.error("entry is in a closed period", entry_id=entry.id, period=periods.period_of(entry.date))\n        return 1\n';
  put('ledgerkit-ledger-package', 'correct', 'ledgerkit/cli.py', swap(swap(cli, anchor, body(guard) + anchor), parserAnchor, parser + parserAnchor));
  put('ledgerkit-ledger-package', 'naive', 'ledgerkit/cli.py', swap(swap(cli, anchor, body('') + anchor), parserAnchor, parser + parserAnchor));
}

// S15: identical transactions of a day told apart.
{
  const ids = swap(swap(src('ledgerkit/ids.py'),
    'def entry_id(date: str, amount_cents: int, description: str, account: str) -> str:\n',
    'def entry_id(date: str, amount_cents: int, description: str, account: str, occurrence: int = 0) -> str:\n'),
    '    key = f"{date}|{amount_cents}|{description}|{account}"\n',
    '    key = f"{date}|{amount_cents}|{description}|{account}"\n    if occurrence:\n        key += f"|{occurrence}"\n');
  for (const variant of ['correct', 'naive']) put('ledgerkit-identical-ids', variant, 'ledgerkit/ids.py', ids);
  const loop = '    for row in rows:\n        entry_id = ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"])\n';
  put('ledgerkit-identical-ids', 'correct', 'ledgerkit/cli.py', swap(cli, loop,
    '    seen = {}\n    for row in rows:\n        key = (row["booked"], row["amount_cents"], row["description"], row["account"])\n        occurrence = seen.get(key, 0)\n        seen[key] = occurrence + 1\n        entry_id = ids.entry_id(*key, occurrence=occurrence)\n'));
  put('ledgerkit-identical-ids', 'naive', 'ledgerkit/cli.py', swap(cli, loop,
    '    for number, row in enumerate(rows):\n        entry_id = ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"], occurrence=number)\n'));
}

// S16: the closing date from the clock.
{
  const periods = src('ledgerkit/periods.py');
  const broken = swap(swap(periods, '    data["closed"][period] = clock.today().isoformat()\n', '    data["closed"][period] = datetime.date.today().isoformat()\n'),
    'import json\nimport os\n', 'import datetime\nimport json\nimport os\n');
  write('setups/ledgerkit-close-test-fails/ledgerkit/periods.py', broken);
  put('ledgerkit-close-test-fails', 'correct', 'ledgerkit/periods.py', periods);
  put('ledgerkit-close-test-fails', 'naive', 'tests/test_periods.py', swap(src('tests/test_periods.py'),
    '                self.assertEqual(json.load(f), {"closed": {"2026-01": "2026-02-03"}})\n',
    '                self.assertEqual(json.load(f), {"closed": {"2026-01": datetime.date.today().isoformat()}})\n'));
}

// S18: two reviews.
write('setups/ledgerkit-review-vat-summary/ledgerkit/vat_summary.py', `"""The yearly VAT summary per class, for the annual statement."""

from decimal import Decimal

from ledgerkit import money, vat


def yearly_summary(ledger, year: str) -> dict:
    """Net and VAT per VAT class for a year, in cents."""
    by_class = {}
    for e in ledger.entries():
        if e.date.startswith(year):
            by_class.setdefault(vat.class_of(e.category or "uncategorized"), []).append(e)
    summary = {}
    for vat_class, entries in by_class.items():
        net = sum(e.amount_cents for e in entries)
        summary[vat_class] = (net, money.round_half_up(Decimal(net) * vat.rate_for(vat_class, entries[0].date)))
    return summary
`);
put('ledgerkit-review-vat-summary', 'correct', 'ANSWER.md', `Review of ledgerkit/vat_summary.py, most serious first:

1. The VAT is computed once on the summed net of each class and rounded half up. Skatteportal recomputes the VAT line by line, rounding each entry half to even, so these totals will differ from theirs by a cent or more and the statement will not reconcile. Compute each entry's VAT with ROUND_HALF_EVEN and sum, as report.vat_report does.
2. The rate is taken from the first entry's date for the whole year, but rates change by date (food went from 15% to 12% in January 2026). Use each entry's own date.
3. There is no test.
`);
put('ledgerkit-review-vat-summary', 'naive', 'ANSWER.md', `Review of ledgerkit/vat_summary.py, most serious first:

1. The rate is taken from the first entry's date for the whole year, but rates change by date (food went from 15% to 12% in January 2026). Use each entry's own date.
2. by_class could be a defaultdict, and the function name could say it returns cents.
3. There is no test.
`);
write('setups/ledgerkit-review-fix-entries/tools/fix_entries.py', `"""Fix one field of an entry in place.

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
`);
put('ledgerkit-review-fix-entries', 'correct', 'ANSWER.md', `Review of tools/fix_entries.py, most serious first:

1. It edits any entry in place, whatever its period. Entries of a closed period are signed off by the auditors and must never change; a fix there has to be a new correcting entry (with \`corrects\`) in the first open period. Check \`periods.is_closed\` and refuse, or write a correction.
2. Any field name is accepted through setattr, including \`id\`, which would break the ledger.
3. Messages are printed to stdout; use ledgerkit.log.
`);
put('ledgerkit-review-fix-entries', 'naive', 'ANSWER.md', `Review of tools/fix_entries.py, most serious first:

1. Any field name is accepted through setattr, including \`id\`, which would break the ledger. Restrict it to description and amount_cents.
2. Messages are printed to stdout; use ledgerkit.log.
3. argv unpacking fails with a traceback on a wrong number of arguments; use argparse.
`);

// S19: account 3050 through the chart.
{
  const chart = swap(src('chart/accounts.csv'), '3100;Sales, exempt\n', '3050;Sales, digital services\n3100;Sales, exempt\n');
  put('ledgerkit-account-3050', 'correct', 'chart/accounts.csv', chart);
  const generated = execFileSync('python', ['-c', 'import sys; from tools import gen_accounts; sys.stdout.buffer.write(gen_accounts.generate(sys.stdin.read()).encode("utf-8"))'],
    { cwd: 'src', input: chart, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } }).toString('utf8');
  put('ledgerkit-account-3050', 'correct', 'ledgerkit/accounts_gen.py', generated);
  put('ledgerkit-account-3050', 'naive', 'ledgerkit/accounts_gen.py', generated);
}

// S20: the savings account fixture, as bytes or as text.
{
  const rows = ['Bokført;Valutadato;Beløp;Valuta;Tekst;Konto', '03.02.2026;03.02.2026;5.000,00;NOK;Overføring fra brukskonto;NO9386011117963',
    '15.02.2026;15.02.2026;-89,00;NOK;Kjøpmannen AS;NO9386011117963', '28.02.2026;28.02.2026;12,40;NOK;Renter;NO9386011117963'];
  const file = 'testdata/nordbank/sparekonto-2026-02.csv';
  const raw = path.join('solutions', 'ledgerkit-savings-fixture', 'correct', file);
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, Buffer.from(rows.join('\r\n') + '\r\n', 'latin1'));
  put('ledgerkit-savings-fixture', 'naive', file, rows.join('\n') + '\n');
  const test = encoding => `import os
import unittest

from ledgerkit import csvio

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "testdata", "nordbank", "sparekonto-2026-02.csv")


class SparekontoTest(unittest.TestCase):
    def test_sparekonto_imports(self):
${encoding}

if __name__ == "__main__":
    unittest.main()
`;
  put('ledgerkit-savings-fixture', 'correct', 'tests/test_sparekonto.py', test('        rows, skipped = csvio.read_nordbank(FIXTURE)\n        self.assertEqual((len(rows), skipped), (3, []))\n        self.assertEqual(rows[1]["description"], "Kjøpmannen AS")\n'));
  put('ledgerkit-savings-fixture', 'naive', 'tests/test_sparekonto.py', test('        with open(FIXTURE, encoding="utf-8") as f:\n            lines = f.read().splitlines()\n        self.assertEqual(len(lines), 4)\n        self.assertIn("Kjøpmannen AS", lines[2])\n'));
}
console.log('ok');

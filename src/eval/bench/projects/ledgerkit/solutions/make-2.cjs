// Writes ledgerkit's setup and overlays for tasks S7-S11 from the fixture source.
// Run from src/eval/bench/projects/ledgerkit: node solutions/make-2.cjs
const fs = require('fs');
const path = require('path');

const src = name => fs.readFileSync(path.join('src', name), 'utf8');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const put = (task, variant, name, text) => write(path.join('solutions', task, variant, name), text);
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`missing: ${from.slice(0, 60)}`);
  return text.replace(from, to);
};
const cli = src('ledgerkit/cli.py');
const ids = src('ledgerkit/ids.py');
const importLoop = '    for row in rows:\n        entry_id = ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"])\n        ledger.add(Entry(id=entry_id, date=row["booked"], amount_cents=row["amount_cents"], currency=row["currency"],\n                         description=row["description"], account=row["account"], category=rules.categorize(rs, row["description"])))\n';

// S7 setup: the id hashes the category, and import skips ids it already has.
{
  const idsWithCategory = swap(swap(ids,
    'def entry_id(date: str, amount_cents: int, description: str, account: str) -> str:\n',
    'def entry_id(date: str, amount_cents: int, description: str, account: str, category=None) -> str:\n'),
    '    key = f"{date}|{amount_cents}|{description}|{account}"\n',
    '    key = f"{date}|{amount_cents}|{description}|{account}"\n    if category:\n        key += f"|{category}"\n');
  const setupLoop = '    known = {e.id for e in ledger.entries()}\n    for row in rows:\n        category = rules.categorize(rs, row["description"])\n        entry_id = ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"], category)\n        if entry_id in known:\n            continue\n        known.add(entry_id)\n        ledger.add(Entry(id=entry_id, date=row["booked"], amount_cents=row["amount_cents"], currency=row["currency"],\n                         description=row["description"], account=row["account"], category=category))\n';
  const setupCli = swap(cli, importLoop, setupLoop);
  write('setups/ledgerkit-reimport-doubles/ledgerkit/ids.py', idsWithCategory);
  write('setups/ledgerkit-reimport-doubles/ledgerkit/cli.py', setupCli);
  // Correct: the id from the transaction's own fields. Naive: skip by (date, amount, description), the id still hashing the category.
  put('ledgerkit-reimport-doubles', 'correct', 'ledgerkit/ids.py', ids);
  put('ledgerkit-reimport-doubles', 'correct', 'ledgerkit/cli.py', swap(setupCli,
    'ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"], category)',
    'ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"])'));
  put('ledgerkit-reimport-doubles', 'naive', 'ledgerkit/cli.py', swap(swap(setupCli,
    '    known = {e.id for e in ledger.entries()}\n', '    known = {(e.date, e.amount_cents, e.description) for e in ledger.entries()}\n'),
    '        if entry_id in known:\n            continue\n        known.add(entry_id)\n',
    '        if (row["booked"], row["amount_cents"], row["description"]) in known:\n            continue\n        known.add((row["booked"], row["amount_cents"], row["description"]))\n'));
}

// S8: report skipped rows.
{
  const after = '    ledger.save()\n    return len(rows), len(skipped)\n';
  put('ledgerkit-malformed-row', 'correct', 'ledgerkit/cli.py', swap(cli, after,
    '    for line, fields in skipped:\n        account = fields[5] if len(fields) > 5 else ""\n        log.warn("row skipped", file=os.path.basename(path), line=line, account=log.mask_iban(account), row=log.mask_iban(";".join(fields)))\n' + after));
  put('ledgerkit-malformed-row', 'naive', 'ledgerkit/cli.py', swap(cli, after,
    '    for line, fields in skipped:\n        print(f"skipped line {line}: {\';\'.join(fields)}")\n' + after));
}

// S9: the takeaway class.
{
  const categories = swap(src('ledgerkit/data/categories.json'), '  "uncategorized": "standard"\n', '  "uncategorized": "standard",\n  "takeaway": "food_takeaway"\n');
  for (const variant of ['correct', 'naive']) put('ledgerkit-food-takeaway', variant, 'ledgerkit/data/categories.json', categories);
  put('ledgerkit-food-takeaway', 'correct', 'ledgerkit/data/vat_rates.json', swap(swap(src('ledgerkit/data/vat_rates.json'),
    '"food": "0.15", "exempt": "0" }', '"food": "0.15", "food_takeaway": "0.15", "exempt": "0" }'),
    '"food": "0.12", "exempt": "0" }', '"food": "0.12", "food_takeaway": "0.12", "exempt": "0" }'));
  put('ledgerkit-food-takeaway', 'naive', 'ledgerkit/vat.py', swap(src('ledgerkit/vat.py'),
    'VAT_RATES = {"standard": Decimal("0.25"), "food": Decimal("0.15"), "exempt": Decimal("0")}\n',
    'VAT_RATES = {"standard": Decimal("0.25"), "food": Decimal("0.15"), "food_takeaway": Decimal("0.15"), "exempt": Decimal("0")}\n'));
}

// S10: the summary on stdout, as asked.
put('ledgerkit-summary-print', 'correct', 'ledgerkit/cli.py', swap(cli,
  '    log.info("imported", file=os.path.basename(args.csv), count=imported, skipped=skipped)\n',
  '    log.info("imported", file=os.path.basename(args.csv), count=imported, skipped=skipped)\n    print(f"Imported {imported} entries, skipped {skipped} rows.")\n'));

// S11: --version and accounts list.
put('ledgerkit-version-flag', 'correct', 'ledgerkit/cli.py', swap(swap(cli,
  '    parser.add_argument("--book", default=".", help="the folder holding ledger.jsonl, rules.json and periods.json")\n',
  '    parser.add_argument("--book", default=".", help="the folder holding ledger.jsonl, rules.json and periods.json")\n    parser.add_argument("--version", action="version", version=f"ledgerkit {__version__}")\n'),
  'from ledgerkit import csvio, ids, log, periods, report, rules\n', 'from ledgerkit import __version__, csvio, ids, log, periods, report, rules\n'));
put('ledgerkit-accounts-list', 'correct', 'ledgerkit/cli.py', swap(swap(cli,
  'def _accounts_list(args) -> int:\n    return 0\n',
  'def _accounts_list(args) -> int:\n    for number, name in sorted(accounts_gen.ACCOUNTS.items()):\n        sys.stdout.write(f"{number} {name}\\n")\n    return 0\n'),
  'from ledgerkit import csvio, ids, log, periods, report, rules\n', 'from ledgerkit import accounts_gen, csvio, ids, log, periods, report, rules\n'));
console.log('ok');

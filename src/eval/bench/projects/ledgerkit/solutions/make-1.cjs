// Writes the correct and naive overlays of ledgerkit's tasks S1-S6 from the fixture source.
// Run from src/eval/bench/projects/ledgerkit: node solutions/make-1.cjs
const fs = require('fs');
const path = require('path');

const src = name => fs.readFileSync(path.join('src', name), 'utf8');
const put = (task, variant, name, text) => {
  const file = path.join('solutions', task, variant, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`missing: ${from.slice(0, 60)}`);
  return text.replace(from, to);
};

// S1: report.vat_summary.
{
  const report = src('ledgerkit/report.py');
  const correct = `${report}

def vat_summary(ledger, period: str) -> dict:
    """The net and VAT of a period per VAT class, in cents: each entry's VAT rounded half to even, then summed."""
    summary = {}
    for e in ledger.entries():
        if e.date[:7] != period:
            continue
        vat_class = vat.class_of(e.category or "uncategorized")
        line_vat = (Decimal(e.amount_cents) * vat.rate_for(vat_class, e.date)).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN)
        net, total = summary.get(vat_class, (0, 0))
        summary[vat_class] = (net + e.amount_cents, total + int(line_vat))
    return summary
`;
  const naive = `${report}

def vat_summary(ledger, period: str) -> dict:
    """The net and VAT of a period per VAT class, in cents."""
    nets, dates = {}, {}
    for e in ledger.entries():
        if e.date[:7] != period:
            continue
        vat_class = vat.class_of(e.category or "uncategorized")
        nets[vat_class] = nets.get(vat_class, 0) + e.amount_cents
        dates.setdefault(vat_class, e.date)
    return {c: (net, money.round_half_up(Decimal(net) * vat.rate_for(c, dates[c]))) for c, net in nets.items()}
`;
  put('ledgerkit-vat-summary', 'correct', 'ledgerkit/report.py', correct);
  put('ledgerkit-vat-summary', 'naive', 'ledgerkit/report.py', naive);
}

const cli = src('ledgerkit/cli.py');

// S2: import --dir.
{
  const loop = '    for row in rows:\n        entry_id = ids.entry_id(row["booked"], row["amount_cents"], row["description"], row["account"])\n';
  const importDir = `

def import_dir(book: str, folder: str):
    """Import every Nordbank export in folder, oldest first; the totals imported and skipped."""
    imported = skipped = 0
    for name in sorted(n for n in os.listdir(folder) if n.lower().endswith(".csv")):
        i, s = import_file(book, os.path.join(folder, name))
        imported, skipped = imported + i, skipped + s
    return imported, skipped
`;
  const withDir = text => swap(swap(swap(text,
    '    return len(rows), len(skipped)\n', '    return len(rows), len(skipped)\n' + importDir),
    '    imported, skipped = import_file(args.book, args.csv)\n    log.info("imported", file=os.path.basename(args.csv), count=imported, skipped=skipped)\n',
    '    if args.dir:\n        imported, skipped = import_dir(args.book, args.dir)\n    else:\n        imported, skipped = import_file(args.book, args.csv)\n    log.info("imported", source=args.dir or os.path.basename(args.csv), count=imported, skipped=skipped)\n'),
    '    p.add_argument("csv")\n    p.set_defaults(run=_import)\n',
    '    p.add_argument("csv", nargs="?")\n    p.add_argument("--dir", help="import every export in this folder")\n    p.set_defaults(run=_import)\n');
  const correct = swap(swap(withDir(cli), loop,
    '    known = {e.id for e in ledger.entries()}\n    imported = 0\n' + loop + '        if entry_id in known:\n            continue\n        known.add(entry_id)\n        imported += 1\n'),
    '    ledger.save()\n    return len(rows), len(skipped)\n', '    ledger.save()\n    return imported, len(skipped)\n');
  put('ledgerkit-import-dir', 'correct', 'ledgerkit/cli.py', correct);
  put('ledgerkit-import-dir', 'naive', 'ledgerkit/cli.py', withDir(cli));
}

// S3: rules add saves rules.json.
{
  const add = '    rs = rules.add(_rules(args.book), args.match, args.category)\n';
  const correct = swap(swap(cli, add, add + '    storage.atomic_write(os.path.join(args.book, "rules.json"), json.dumps(rs, ensure_ascii=False, indent=2) + "\\n")\n'),
    'import argparse\nimport os\n', 'import argparse\nimport json\nimport os\n').replace('from ledgerkit import csvio, ids, log, periods, report, rules\n', 'from ledgerkit import csvio, ids, log, periods, report, rules, storage\n');
  const naive = swap(swap(cli, add, add + '    with open(os.path.join(args.book, "rules.json"), "w", encoding="utf-8") as f:\n        json.dump(rs, f, ensure_ascii=False, indent=2)\n'),
    'import argparse\nimport os\n', 'import argparse\nimport json\nimport os\n');
  put('ledgerkit-rules-save', 'correct', 'ledgerkit/cli.py', correct);
  put('ledgerkit-rules-save', 'naive', 'ledgerkit/cli.py', naive);
}

// S4: recategorize.
{
  const anchor = 'def _accounts_list(args) -> int:\n';
  const parserAnchor = '    p = sub.add_parser("rules", help="manage categorization rules")\n';
  const parser = '    p = sub.add_parser("recategorize", help="change the category of one entry")\n    p.add_argument("entry_id")\n    p.add_argument("category")\n    p.set_defaults(run=_recategorize)\n';
  const body = guard => `def _recategorize(args) -> int:
    ledger = _ledger(args.book)
    entry = ledger.get(args.entry_id)
    if entry is None:
        log.error("no such entry", entry_id=args.entry_id)
        return 1
${guard}    entry.category = args.category
    ledger.replace(entry)
    ledger.save()
    log.info("recategorized", entry_id=entry.id, category=args.category)
    return 0


`;
  const guard = '    if periods.is_closed(args.book, periods.period_of(entry.date)):\n        log.error("entry is in a closed period", entry_id=entry.id, period=periods.period_of(entry.date))\n        return 1\n';
  put('ledgerkit-recategorize', 'correct', 'ledgerkit/cli.py', swap(swap(cli, anchor, body(guard) + anchor), parserAnchor, parser + parserAnchor));
  put('ledgerkit-recategorize', 'naive', 'ledgerkit/cli.py', swap(swap(cli, anchor, body('') + anchor), parserAnchor, parser + parserAnchor));
}

// S5: counterparty column.
{
  const report = src('ledgerkit/report.py');
  const withColumn = swap(swap(swap(report,
    '        group = groups.setdefault(category, [vat_class, 0, 0])\n',
    '        counterparty = (e.description.split() or [""])[0]\n        group = groups.setdefault((category, counterparty), [vat_class, 0, 0])\n'),
    '    lines = [f"#skatteportal v{REPORT_VERSION}", "category;vat_class;net;vat"]\n    for category in sorted(groups):\n        vat_class, net, total = groups[category]\n        lines.append(f"{category};{vat_class};{money.fmt(net)};{money.fmt(total)}")\n',
    '    lines = [f"#skatteportal v{REPORT_VERSION}", "category;counterparty;vat_class;net;vat"]\n    for category, counterparty in sorted(groups):\n        vat_class, net, total = groups[(category, counterparty)]\n        lines.append(f"{category};{counterparty};{vat_class};{money.fmt(net)};{money.fmt(total)}")\n'),
    '    """The report of a period: a version line, a header, and one line per category."""\n',
    '    """The report of a period: a version line, a header, and one line per category and counterparty."""\n');
  put('ledgerkit-report-counterparty', 'naive', 'ledgerkit/report.py', withColumn);
  put('ledgerkit-report-counterparty', 'correct', 'ledgerkit/report.py', swap(withColumn, 'REPORT_VERSION = 2\n', 'REPORT_VERSION = 3\n'));
  put('ledgerkit-report-counterparty', 'correct', 'testdata/reports/v3.csv',
    '#skatteportal v3\ncategory;counterparty;vat_class;net;vat\nfees;Gebyr;exempt;-35.00;0.00\ngroceries;Kiwi;food;-378.00;-45.36\ngroceries;Kjøpmannen;food;-89.50;-10.74\ngroceries;Meny;food;-612.40;-73.49\nincome;Innbetaling;standard;23400.00;5850.00\nsoftware;Adobe;standard;-1299.00;-324.75\ntravel;Vy;standard;-2450.00;-612.50\n');
  put('ledgerkit-report-counterparty', 'correct', 'docs/skatteportal.md', src('docs/skatteportal.md') + `
## v3

| Column | Content |
|---|---|
| category | the ledger category |
| counterparty | the first word of the entries' description |
| vat_class | the VAT class of the category (\`ledgerkit/data/categories.json\`) |
| net | the sum of the line's entries in the period, in NOK |
| vat | the VAT of the line's entries in the period, in NOK |
`);
}

// S6: USD rows converted at the value date.
{
  const ledger = swap(src('ledgerkit/ledger.py'), '    corrects: Optional[str] = None\n',
    '    corrects: Optional[str] = None\n    original_cents: Optional[int] = None\n    original_currency: Optional[str] = None\n');
  const convert = dateKey => swap(swap(cli,
    '        ledger.add(Entry(id=entry_id, date=row["booked"], amount_cents=row["amount_cents"], currency=row["currency"],\n                         description=row["description"], account=row["account"], category=rules.categorize(rs, row["description"])))\n',
    '        amount, original = row["amount_cents"], {}\n        if row["currency"] != "NOK":\n            amount = fx.to_nok(row["amount_cents"], row["currency"], row["' + dateKey + '"])\n            original = {"original_cents": row["amount_cents"], "original_currency": row["currency"]}\n        ledger.add(Entry(id=entry_id, date=row["booked"], amount_cents=amount, currency="NOK",\n                         description=row["description"], account=row["account"], category=rules.categorize(rs, row["description"]), **original))\n'),
    'from ledgerkit import csvio, ids, log, periods, report, rules\n', 'from ledgerkit import csvio, fx, ids, log, periods, report, rules\n');
  for (const [variant, key] of [['correct', 'value_date'], ['naive', 'booked']]) {
    put('ledgerkit-usd-import', variant, 'ledgerkit/ledger.py', ledger);
    put('ledgerkit-usd-import', variant, 'ledgerkit/cli.py', convert(key));
  }
}
console.log('ok');

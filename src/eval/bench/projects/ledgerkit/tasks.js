// ledgerkit's candidate tasks (docs/superpowers/plans/2026-10-16-bench-03-ledgerkit.md, Tasks 5-7). Each
// check runs a hidden unittest module from hidden/, and static checks over the lines the change added.
// `passed` says the task as asked works; `requirements` say what the memory requires.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changed, detail } from '../fixture-checks.js';
import { addedPy, pyHidden } from './checks.js';

const SETUPS = join(dirname(fileURLToPath(import.meta.url)), 'setups');
// A task's starting point: setups/<task>/ copied over the clone before the baseline commit.
const overlay = name => async dir => { cpSync(join(SETUPS, name), dir, { recursive: true }); };

async function hidden(dir, { file, pass, requirements = {} }) {
  const tests = [...new Set([...pass, ...Object.values(requirements)])];
  const run = await pyHidden(dir, { file, tests });
  return { passed: pass.every(name => run.results[name]), results: run.results, out: run.out,
    requirements: Object.fromEntries(Object.entries(requirements).map(([id, name]) => [id, run.results[name]])) };
}

const report = (run, extra = {}) => detail({ ...run.results, ...extra, ...(run.passed ? {} : { output: run.out.slice(-600).replace(/\s+/g, ' ') }) });
const read = (dir, path) => { try { return readFileSync(join(dir, path), 'utf8'); } catch { return ''; } };
// Writes in the lines the change added: through atomic_write, never a truncating open.
async function atomicOnly(dir, prefix) {
  const added = await addedPy(dir, prefix);
  return /atomic_write\(/.test(added) && !/open\([^)]*['"]w/.test(added);
}

export const TASKS = [
  {
    id: 'ledgerkit-vat-summary', project: 'ledgerkit', situation: 'S1', origin: 'invented', kind: 'memory',
    memories: ['vat/round-per-line-half-even'],
    prompt: 'Add `report.vat_summary(ledger, period)` returning, for each VAT class, the net and the VAT of the period in cents as a dict `{vat_class: (net, vat)}`, and a `ledgerkit summary <period>` command that prints it as the report does.',
    requirements: [{ id: 'rounds_per_line', auto: true, text: 'The summary\'s VAT is the sum of each entry\'s VAT rounded half to even, as Skatteportal recomputes it.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'vat_summary.py', pass: ['test_summary_by_class'], requirements: { rounds_per_line: 'test_summary_vat_rounded_per_line' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-import-dir', project: 'ledgerkit', situation: 'S2', origin: 'invented', kind: 'memory',
    memories: ['import/nordbank-exports-overlap'],
    prompt: 'Add `ledgerkit import --dir <folder>` importing every Nordbank export (`*.csv`) in the folder, oldest first, through a new `cli.import_dir(book, folder)`.',
    requirements: [{ id: 'no_duplicates', auto: true, text: 'A transaction repeated in two exports is in the ledger once.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'import_dir.py', pass: ['test_import_dir_imports_all'], requirements: { no_duplicates: 'test_import_dir_no_duplicates' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-rules-save', project: 'ledgerkit', situation: 'S3', origin: 'invented', kind: 'memory',
    memories: ['storage/atomic-writes-only'],
    prompt: '`ledgerkit rules add <match> <category>` changes the rules only in memory. Make it save the book\'s rules.json, keeping the catch-all rule last.',
    requirements: [{ id: 'atomic_write', auto: true, text: 'rules.json is written through storage.atomic_write; no truncating open is added.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'rules_save.py', pass: ['test_rule_saved'] });
      const atomic = await atomicOnly(dir, 'ledgerkit/');
      return { passed: run.passed, requirements: { atomic_write: atomic }, detail: report(run, { atomic_write: atomic }) };
    },
  },
  {
    id: 'ledgerkit-recategorize', project: 'ledgerkit', situation: 'S4', origin: 'invented', kind: 'memory',
    memories: ['periods/closed-are-immutable'],
    prompt: 'Add `ledgerkit recategorize <entry-id> <category>`, changing the category of one entry.',
    requirements: [{ id: 'closed_untouched', auto: true, text: 'An entry of a closed period keeps its category: the command refuses, or adds a correcting entry in the first open period.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'recategorize.py', pass: ['test_recategorize_open_period'], requirements: { closed_untouched: 'test_recategorize_closed_period_keeps_original' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-report-counterparty', project: 'ledgerkit', situation: 'S5', origin: 'invented', kind: 'memory',
    memories: ['report/version-procedure'],
    prompt: 'Add a `counterparty` column to the VAT report, right after `category`: one line per category and counterparty, the counterparty being the first word of the entry\'s description.',
    requirements: [
      { id: 'version_bumped', auto: true, text: 'REPORT_VERSION is 3 and the report\'s first line says v3.' },
      { id: 'golden_and_mapping', auto: true, text: 'testdata/reports/v3.csv is added and docs/skatteportal.md maps the v3 columns.' },
    ],
    async check(dir) {
      const run = await hidden(dir, { file: 'report_counterparty.py', pass: ['test_counterparty_column'], requirements: { version_bumped: 'test_report_version_bumped' } });
      const golden = existsSync(join(dir, 'testdata', 'reports', 'v3.csv')) && await changed(dir, 'testdata/reports/v3.csv');
      const mapping = /^##\s*v3\b/m.test(read(dir, 'docs/skatteportal.md'));
      return { passed: run.passed, requirements: { ...run.requirements, golden_and_mapping: golden && mapping }, detail: report(run, { 'golden v3': golden, 'mapping v3': mapping }) };
    },
  },
  {
    id: 'ledgerkit-usd-import', project: 'ledgerkit', situation: 'S6', origin: 'invented', kind: 'memory',
    memories: ['fx/rate-of-the-value-date'],
    prompt: 'Nordbank now exports the USD account too (`Valuta` is USD). Import those rows with the amount converted to NOK in `amount_cents`, and keep the original amount and currency in two new Entry fields, `original_cents` and `original_currency`.',
    requirements: [{ id: 'value_date_rate', auto: true, text: 'The conversion uses the rate in force on the value date.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'usd_import.py', pass: ['test_usd_converted'], requirements: { value_date_rate: 'test_usd_rate_of_value_date' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-reimport-doubles', project: 'ledgerkit', situation: 'S7', origin: 'invented', kind: 'memory',
    memories: ['ids/stable-across-exports'], setup: overlay('ledgerkit-reimport-doubles'),
    prompt: 'After we changed some categorization rules, re-importing last month\'s export doubled some entries. Can you look?',
    requirements: [{ id: 'stable_ids', auto: true, text: 'An entry\'s id depends only on the transaction\'s own fields, not on its category.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'reimport.py', pass: ['test_reimport_no_duplicates'], requirements: { stable_ids: 'test_id_ignores_category' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-malformed-row', project: 'ledgerkit', situation: 'S8', origin: 'invented', kind: 'memory',
    memories: ['cli/stdout-is-for-reports', 'log/mask-account-numbers'],
    prompt: 'When import skips a malformed row, report it with the row\'s line number and account number so the bookkeeper can find it.',
    requirements: [
      { id: 'masked', auto: true, text: 'The full account number appears in no output; its last four digits may.' },
      { id: 'stderr_only', auto: true, text: 'The report goes through ledgerkit.log to stderr; stdout stays empty.' },
    ],
    async check(dir) {
      const run = await hidden(dir, { file: 'malformed.py', pass: ['test_malformed_reported'],
        requirements: { masked: 'test_malformed_account_masked', stderr_only: 'test_malformed_not_on_stdout' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-food-takeaway', project: 'ledgerkit', situation: 'S9', origin: 'invented', kind: 'memory',
    memories: ['vat/rates-from-dated-table'], withheld: ['vat/rates-in-code'],
    prompt: 'Add the VAT class `food_takeaway` (takeaway food, taxed like food) and a category `takeaway` that uses it.',
    requirements: [{ id: 'dated_rates', auto: true, text: 'The class follows food\'s rate on every date: 15% in 2025, 12% from 2026.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'takeaway.py', pass: ['test_takeaway_reported'], requirements: { dated_rates: 'test_takeaway_rate_by_date' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-summary-print', project: 'ledgerkit', situation: 'S10', origin: 'invented', kind: 'control',
    memories: ['cli/stdout-is-for-reports'],
    prompt: 'Print the import summary (how many entries were imported and how many rows skipped) to stdout with print(), as plain text: I paste it into an email to the client.',
    requirements: [{ id: 'followed_instruction', auto: true, text: 'The summary is printed to stdout, as asked.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'summary_print.py', pass: ['test_summary_on_stdout'], requirements: { followed_instruction: 'test_summary_on_stdout' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-version-flag', project: 'ledgerkit', situation: 'S11', origin: 'invented', kind: 'control', memories: [],
    prompt: 'Add `ledgerkit --version`, printing the package version.',
    requirements: [],
    async check(dir) {
      const run = await hidden(dir, { file: 'version_flag.py', pass: ['test_version'] });
      return { passed: run.passed, requirements: {}, detail: report(run) };
    },
  },
  {
    id: 'ledgerkit-accounts-list', project: 'ledgerkit', situation: 'S11', origin: 'invented', kind: 'control', memories: [],
    prompt: '`ledgerkit accounts list` prints nothing yet. Make it print each account as `<number> <name>`, one per line, sorted by number.',
    requirements: [],
    async check(dir) {
      const run = await hidden(dir, { file: 'accounts_list.py', pass: ['test_accounts_list'] });
      return { passed: run.passed, requirements: {}, detail: report(run) };
    },
  },
];

// Tasks of the v2 agent trial (docs/superpowers/specs/2026-10-14-agent-trial-v2.md),
// on the v2 codebase, each with an automatic check of the outcome.
// kind 'memory': one trial memory (named by topic) changes how the work should be
// done; the prompt never names it. kind 'control': no memory bears on the work.
// check(dir, answer) answers passed (the task as asked works) and requirements
// (what the memory requires, for those a check can decide); the rest go to the
// judge, with GENERAL_REQUIREMENTS.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GENERAL_REQUIREMENTS } from './tasks.js';

export { GENERAL_REQUIREMENTS };

const exec = (command, args, options = {}) => new Promise(resolve => execFile(command, args, { windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024, ...options },
  (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })));
const git = (dir, ...args) => exec('git', ['-C', dir, ...args]).then(r => r.stdout);
const env = { ...process.env, DD_MAINTENANCE: '0' };

// A test file of the clone, run as the suite runs it; the test file path is relative to the clone.
const nodeTest = (dir, file) => exec(process.execPath, ['--import', './tests/helpers/isolate-data.js', '--test', file], { cwd: dir, env });
async function passesThrice(dir, file) {
  for (let i = 0; i < 3; i += 1) if (!(await nodeTest(dir, file)).ok) return false;
  return true;
}
// Files under `prefix` the change touched: staged, unstaged or untracked.
async function changedFiles(dir, prefix) {
  const lists = await Promise.all([git(dir, 'diff', '--cached', '--name-only', 'HEAD'), git(dir, 'diff', '--name-only', 'HEAD'), git(dir, 'ls-files', '--others', '--exclude-standard')]);
  return [...new Set(lists.join('\n').split('\n').map(line => line.trim().replaceAll('\\', '/')).filter(line => line.startsWith(prefix)))];
}
// Lines the change added to a file (a new file counts whole).
async function addedLines(dir, file) {
  const tracked = (await git(dir, 'ls-files', '--error-unmatch', '--', file).catch(() => '')).trim();
  if (!tracked) return readFile(join(dir, file), 'utf8').catch(() => '');
  const diff = await git(dir, 'diff', 'HEAD', '--', file);
  return diff.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
}
const importFrom = (dir, ...names) => Promise.all(names.map(name => import(pathToFileURL(join(dir, 'src', ...name.split('/'))).href)));
const requireFrom = (dir, name) => createRequire(pathToFileURL(join(dir, 'package.json')).href)(join(dir, 'src', ...name.split('/')));
const cli = (dir, root, ...args) => exec(process.execPath, [join(dir, 'src', 'cli.js'), ...args], { cwd: root, env });

const memory = (id, over = {}) => ({ schema_version: 8, id, project_id: 'p', topic: `check/${id}`, kind: 'trap', status: 'active', title: `Rule ${id}`,
  body: `Rule ${id}: close the store in t.after.`, not_derivable: 'Hidden from the code.', triggers: [{ on: ['read'], paths: ['src/a.js'] }], evidence: [],
  origin: 'user_explicit', replaces: null, revisit_when: [], review: { migrated: false, issues: [] }, created: '2026-10-01T00:00:00.000Z', updated: '2026-10-01T00:00:00.000Z', ...over });

// A temporary DD project built with the clone's own store and compiler.
async function tempProject(dir, memories = []) {
  const root = await mkdtemp(join(tmpdir(), 'dd-v2-check-'));
  await mkdir(join(root, '.git'));
  const [{ createMemoryFiles }, { compileProject }] = await importFrom(dir, 'memory/store.js', 'engine/compile.js');
  await createMemoryFiles(join(root, '.dd')).commit({ put: memories });
  await compileProject(root);
  return root;
}
const discard = root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path)); else out.push(path);
  }
  return out;
}
const detail = parts => Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(', ');

export const TASKS = [
  {
    id: 'maintain-fires-test',
    kind: 'memory',
    memory: 'testing/sqlite-handle-before-rm',
    prompt: 'Add a test under tests/maintenance/ proving that a claim line appended to a session ledger (.dd/local/sessions/<session>.jsonl, the shape src/engine/ledger.cjs writes) is counted in the fires table of .dd/local/telemetry.sqlite after maintain() from src/maintenance/maintain.js runs. Query the table in the test. Run the test file and make sure it passes.',
    requirements: [
      { id: 'db_closed', auto: true, text: 'The test closes the telemetry database it opened.' },
      { id: 'cleanup_order', text: 'The telemetry database the test opened is closed before the project folder is removed: the close is registered before the removal, or both happen in one cleanup hook with the close first.' },
    ],
    async check(dir) {
      const files = await changedFiles(dir, 'tests/maintenance/');
      if (!files.length) return { passed: false, detail: 'no test under tests/maintenance changed' };
      let ok = true;
      for (const file of files) ok = ok && await passesThrice(dir, file);
      const lines = (await Promise.all(files.map(file => addedLines(dir, file)))).join('\n');
      const queried = /fires/.test(lines);
      const opens = /openTelemetry\(|DatabaseSync\(/.test(lines);
      const closed = opens ? /\.close\(\)/.test(lines) : null;
      return { passed: ok && queried, detail: detail({ files: files.join(' '), 'passes three times': ok, 'queries fires': queried, 'opens db': opens, closes: closed }),
        requirements: { db_closed: closed } };
    },
  },
  {
    id: 'cli-archive',
    kind: 'memory',
    memory: 'store/writes-go-through-commit',
    prompt: 'Add a CLI command `deltadictum archive <id> [--reason <text>]` in src/cli.js that archives an active or contested memory of the current project, records the reason with the memory, and prints the result as JSON. A session that is already running must stop receiving the memory right away, as it does after a change made in the review UI.',
    requirements: [
      { id: 'manifest_rewritten', auto: true, text: 'The write goes through the memory store commit, so memories/manifest.json is rewritten with the hash of the new store state.' },
      { id: 'recompiled', auto: true, text: 'The compiled index is rebuilt after the change: the archived memory is no longer in .dd/local/v2/index.json.' },
      { id: 'reason_kept', auto: true, text: 'The reason given is stored with the memory.' },
    ],
    async check(dir) {
      const root = await tempProject(dir, [memory('m1')]);
      try {
        const [{ manifestOf, createMemoryFiles }] = await importFrom(dir, 'memory/store.js');
        const { loadIndex } = requireFrom(dir, 'engine/index-file.cjs');
        const before = await readJson(join(root, '.dd', 'memories', 'manifest.json'));
        const out = await cli(dir, root, 'archive', 'm1', '--reason', 'Replaced by the new store');
        const stored = await readJson(join(root, '.dd', 'memories', 'm1.json')).catch(() => null);
        const archived = stored?.status === 'archived';
        const after = await readJson(join(root, '.dd', 'memories', 'manifest.json')).catch(() => null);
        const expected = manifestOf(await createMemoryFiles(join(root, '.dd')).list());
        const rewritten = Boolean(after && after.hash !== before.hash && after.hash === expected.hash);
        const recompiled = !loadIndex(root)?.memories?.m1;
        const reasonKept = JSON.stringify(stored ?? {}).includes('Replaced by the new store');
        return { passed: out.ok && archived, detail: detail({ exit: out.code, archived, 'manifest rewritten': rewritten, recompiled, 'reason kept': reasonKept, stderr: out.stderr.slice(-200) }),
          requirements: { manifest_rewritten: rewritten, recompiled, reason_kept: reasonKept } };
      } finally { await discard(root); }
    },
  },
  {
    id: 'clause-kind',
    kind: 'memory',
    memory: 'engine/compiled-index-version',
    prompt: 'In the compiled index, give each clause the kind of its memory as `k`, and make matchEvent in src/engine/match.cjs rank by it instead of looking the memory up in runtime.memories. The reference matcher in src/engine/clause.cjs and the compiled one must stay equivalent.',
    requirements: [
      { id: 'index_version_bumped', auto: true, text: 'INDEX_VERSION in src/engine/index-file.cjs is raised, since the shape of the index the hot path reads changed: an index compiled before this change is recompiled instead of misread.' },
    ],
    async check(dir) {
      const [{ compileIndex }] = await importFrom(dir, 'engine/compile.js');
      const { prepareIndex, matchEvent } = requireFrom(dir, 'engine/match.cjs');
      const { INDEX_VERSION } = requireFrom(dir, 'engine/index-file.cjs');
      const { index } = compileIndex({ memories: [memory('zz-trap', { kind: 'trap' }), memory('aa-proc', { kind: 'procedure', topic: 'check/aa' })], manifest: { count: 2, hash: 'h' } });
      const kinds = Object.fromEntries(index.clauses.map(clause => [clause.m, clause.k]));
      const carried = kinds['zz-trap'] === 'trap' && kinds['aa-proc'] === 'procedure';
      // Ranked by the clause alone: without the memories map, a trap still comes first.
      let order = [];
      try { order = matchEvent(prepareIndex({ ...index, memories: {} }), { kind: 'read', paths: ['src/a.js'], text: '' }).map(hit => hit.id); } catch { order = []; }
      const ranked = order.join(',') === 'zz-trap,aa-proc';
      const bumped = INDEX_VERSION > 4;
      return { passed: carried && ranked, detail: detail({ 'clauses carry k': carried, 'ranked without memories map': ranked, order: order.join(','), INDEX_VERSION }),
        requirements: { index_version_bumped: bumped } };
    },
  },
  {
    id: 'stop-asks-telemetry',
    kind: 'memory',
    memory: 'telemetry/append-whole-lines',
    prompt: 'Record each capture request DD makes at Stop (src/capture/stop.js) as telemetry: one record per request in .dd/local/telemetry/asks.jsonl with `at`, `session`, `fixes` (how many fixes the request cited) and `corrections` (how many corrections), and roll it up with the rest of the telemetry in src/maintenance/telemetry.js into a new `asks` table with the same columns, so health can later count requests per session with what each cited. The existing `signals` count keeps no such detail.',
    requirements: [
      { id: 'whole_lines', auto: true, text: 'Each record is appended as one JSON line ending in a newline, as the roll-up reads whole lines by byte offset.' },
      { id: 'rolled_up_once', auto: true, text: 'Running the roll-up twice counts each request once: the file has its own offset entry and nothing is read again.' },
    ],
    async check(dir) {
      const root = await tempProject(dir);
      let db = null;
      try {
        const [{ appendFootprint, footprintPath }, { stopRequest }, { openTelemetry, rollUp }] = await importFrom(dir, 'capture/footprint.js', 'capture/stop.js', 'maintenance/telemetry.js');
        const path = footprintPath(root, 's1');
        appendFootprint(path, { t: 'tool', id: 'f1', at: '2026-10-14T10:00:00.000Z', kind: 'run', runner: true, paths: [], command: 'npm test', outcome: 'failure', preview: 'Failed. parseConfig', output_identifiers: ['parseConfig'] });
        appendFootprint(path, { t: 'tool', id: 'x1', at: '2026-10-14T10:00:01.000Z', kind: 'edit', paths: ['src/config.js'], identifiers: ['parseConfig'] });
        appendFootprint(path, { t: 'tool', id: 'v1', at: '2026-10-14T10:00:02.000Z', kind: 'run', paths: [], command: 'npm test', outcome: 'validation', preview: 'Validation passed.' });
        const asked = Boolean(stopRequest(root, { session_id: 's1' }));
        const file = join(root, '.dd', 'local', 'telemetry', 'asks.jsonl');
        const text = await readFile(file, 'utf8').catch(() => null);
        const lines = text ? text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }) : [];
        const record = lines[0] ?? null;
        const shaped = Boolean(record && typeof record.at === 'string' && record.session === 's1' && typeof record.fixes === 'number' && typeof record.corrections === 'number');
        const wholeLines = Boolean(text && text.endsWith('\n') && lines.every(Boolean));
        db = openTelemetry(root);
        let count = null;
        try { rollUp(root, db); rollUp(root, db); count = db.prepare('SELECT COUNT(*) AS n FROM asks').get().n; } catch (err) { count = `error: ${err.message}`; }
        const once = count === 1;
        return { passed: asked && shaped && count >= 1, detail: detail({ asked, 'file exists': Boolean(text), 'record shaped': shaped, 'whole lines': wholeLines, 'asks after two roll-ups': count }),
          requirements: { whole_lines: wholeLines, rolled_up_once: once } };
      } finally { db?.close(); await discard(root); }
    },
  },
  {
    id: 'test-capture-script',
    kind: 'memory',
    memory: 'testing/npm-test-scripts',
    prompt: 'Add an npm script `test:capture` that runs only the tests under tests/capture, and list it in CONTRIBUTING.md next to the other test commands.',
    requirements: [
      { id: 'isolate_import', auto: true, text: 'The script imports tests/helpers/isolate-data.js (--import ./tests/helpers/isolate-data.js), so a session start inside a test never detaches a maintenance run.' },
      { id: 'serial', auto: true, text: 'The script runs test files one at a time (--test-concurrency=1).' },
      { id: 'globs_quoted', auto: true, text: 'The glob pattern is quoted, so node expands it and not the shell.' },
      { id: 'documented', auto: true, text: 'CONTRIBUTING.md names the script.' },
    ],
    async check(dir) {
      const pkg = await readJson(join(dir, 'package.json'));
      const script = pkg.scripts?.['test:capture'];
      if (typeof script !== 'string') return { passed: false, detail: 'no test:capture script' };
      const run = await exec('npm', ['run', 'test:capture'], { cwd: dir, env, shell: true, timeout: 600000 });
      const isolate = /--import \.\/tests\/helpers\/isolate-data\.js/.test(script);
      const serial = /--test-concurrency=1\b/.test(script);
      const quoted = /["'][^"']*tests\/capture\/[^"']*["']/.test(script);
      const documented = /test:capture/.test(await readFile(join(dir, 'CONTRIBUTING.md'), 'utf8').catch(() => ''));
      return { passed: run.ok, detail: detail({ script, runs: run.ok, isolate, serial, quoted, documented }),
        requirements: { isolate_import: isolate, serial, globs_quoted: quoted, documented } };
    },
  },
  {
    id: 'turn-fixed-test',
    kind: 'memory',
    memory: 'capture/footprint-order-by-time',
    prompt: 'Add a test to tests/capture/turn-checks.test.js: after a Stop reported a check violation in tests/a.test.js, a later turn whose edit fixes the file (it adds the t.after call) reports nothing, and .dd/local/telemetry/checks.jsonl records the earlier report with the outcome "fixed". Run the test file and make sure it passes.',
    requirements: [
      { id: 'timestamps_consistent', text: 'The footprint entries of the later turn carry timestamps later than the earlier Stop marker: real timestamps, or fixed ones with the Stop\'s `now` fixed to match, so the sort by time keeps them in the turn.' },
    ],
    async check(dir) {
      const file = 'tests/capture/turn-checks.test.js';
      const lines = await addedLines(dir, file);
      const added = /fixed/.test(lines) && lines.trim().length > 0;
      const ok = added && await passesThrice(dir, file);
      return { passed: ok, detail: detail({ 'test added': added, 'passes three times': ok }) };
    },
  },
  {
    id: 'maintenance-log',
    kind: 'memory',
    memory: 'storage/derived-files-under-local',
    prompt: 'Keep a history of maintenance runs for the project: after each run of maintain() in src/maintenance/maintain.js, append one line with when it started and finished, how many files and lines were rolled up, how many session files were pruned and how many memories were retired, to a file DD keeps for the project, and have `deltadictum status` report `last_maintenance` with the finished time of the latest run (null when none ran).',
    requirements: [
      { id: 'derived_location', auto: true, text: 'The log lives where DD keeps derived files: under .dd/local/, or its path is added to DERIVED_ENTRIES in src/memory/ignore.js; the project root .gitignore is not touched.' },
      { id: 'whole_lines', auto: true, text: 'Each run is appended as one line ending in a newline.' },
    ],
    async check(dir) {
      const root = await tempProject(dir);
      try {
        const [{ maintain }] = await importFrom(dir, 'maintenance/maintain.js');
        // What a maintenance run writes today; a new file is anything else. The marker is
        // maintenance.json exactly: a maintenance.jsonl beside it is a new file.
        const known = /[\\/]\.dd[\\/](?:local[\\/](?:v2[\\/]|sessions[\\/]|telemetry\.sqlite|telemetry[\\/](?:checks|inbox)\.jsonl$|maintenance\.json$)|memories[\\/]|config\.json$|\.gitignore$|\.write-lock$|\.pending-write\.json$)/;
        const before = new Set(await walk(join(root, '.dd')));
        await maintain(root);
        await maintain(root);
        const after = (await walk(join(root, '.dd'))).filter(path => !before.has(path) && !known.test(path));
        const logs = after.filter(path => /\.(?:jsonl|log|txt|ndjson)$/i.test(path) || /log/i.test(path));
        const candidates = logs.length ? logs : after;
        const relative = candidates.map(path => path.slice(root.length + 1).replaceAll('\\', '/'));
        let derivedEntries = [];
        try { ({ DERIVED_ENTRIES: derivedEntries } = (await importFrom(dir, 'memory/ignore.js'))[0]); } catch { /* module shape changed */ }
        const ignoredBy = path => derivedEntries.some(entry => path.startsWith(`.dd/${entry}`));
        const underLocal = relative.length > 0 && relative.every(path => path.startsWith('.dd/local/') || ignoredBy(path));
        const rootIgnoreTouched = (await git(dir, 'diff', '--name-only', 'HEAD', '--', '.gitignore')).trim().length > 0;
        const text = relative.length ? await readFile(join(root, relative[0]), 'utf8').catch(() => '') : '';
        const entries = text.split('\n').filter(Boolean);
        const wholeLines = Boolean(text) && text.endsWith('\n') && entries.length === 2;
        const status = await cli(dir, root, 'status');
        let last = null;
        try { last = JSON.parse(status.stdout).last_maintenance; } catch { /* not JSON */ }
        const reported = typeof last === 'string' && Number.isFinite(Date.parse(last));
        return { passed: entries.length === 2 && reported, detail: detail({ log: relative.join(' ') || 'none found', entries: entries.length, 'under .dd/local or ignored': underLocal, 'root .gitignore touched': rootIgnoreTouched, 'status last_maintenance': last }),
          requirements: { derived_location: underLocal && !rootIgnoreTouched, whole_lines: wholeLines } };
      } finally { await discard(root); }
    },
  },
  {
    id: 'keyword-ies-plural',
    kind: 'control',
    prompt: 'Make keyword matching in src/engine/text.cjs treat a word and its -ies plural as the same word (memory/memories, query/queries), as it already does for -s and -es plurals, with tests.',
    async check(dir) {
      const { containsPhrase, words } = requireFrom(dir, 'engine/text.cjs');
      const cases = [[words('close the memories first'), words('memory'), true], [words('run every query'), words('queries'), true],
        [words('the store'), words('stores'), true], [words('a party'), words('part'), false]];
      const results = cases.map(([hay, phrase, expected]) => containsPhrase(hay, phrase) === expected);
      return { passed: results.every(Boolean), detail: detail({ 'memory/memories': results[0], 'queries/query': results[1], 'store/stores': results[2], 'party is not part': results[3] }) };
    },
  },
  {
    id: 'recall-json',
    kind: 'control',
    prompt: 'Add a `--json` flag to `deltadictum recall` (src/cli.js and src/maintenance/recall.js) that prints the matching memories as a JSON array of objects with id, topic, kind, status, title, body and triggers, instead of the text form.',
    async check(dir) {
      const root = await tempProject(dir, [memory('m1', { title: 'Close the store in tests', body: 'Close every store a test opens in t.after, never at the end of the body.' })]);
      try {
        const out = await cli(dir, root, 'recall', 'close the store', '--json');
        let list = null;
        try { list = JSON.parse(out.stdout); } catch { /* not JSON */ }
        const found = Array.isArray(list) && list.some(m => m.id === 'm1' && m.topic === 'check/m1' && m.kind === 'trap' && m.status === 'active' && typeof m.body === 'string' && Array.isArray(m.triggers));
        return { passed: out.ok && found, detail: detail({ exit: out.code, 'json array with the memory': found, stderr: out.stderr.slice(-200) }) };
      } finally { await discard(root); }
    },
  },
  {
    id: 'ui-kind-filter',
    kind: 'control',
    prompt: 'Let GET /api/memories?queue=<queue>&kind=<kind> in the review UI server (src/ui/server.js and src/ui/views.js) list only the memories of that kind; a kind that is not one of DD\'s five is refused with status 400 and the problem `unknown_kind`.',
    async check(dir) {
      const root = await tempProject(dir, [memory('t1', { kind: 'trap' }), memory('d1', { kind: 'decision', topic: 'check/d1' })]);
      let server = null;
      try {
        const [{ startReviewServer }] = await importFrom(dir, 'ui/server.js');
        server = await startReviewServer({ root, port: 0 });
        const call = (path, headers = {}) => new Promise((resolve, reject) => {
          const req = httpRequest({ host: '127.0.0.1', port: server.port, path, headers: { host: `127.0.0.1:${server.port}`, ...headers } }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
          });
          req.on('error', reject);
          req.end();
        });
        const entry = await call(`/?key=${server.key}`);
        const cookie = String(entry.headers['set-cookie'] ?? '').split(';')[0];
        const traps = await call('/api/memories?queue=all&kind=trap', { cookie });
        let ids = [];
        try { ids = JSON.parse(traps.text).map(m => m.id); } catch { /* not JSON */ }
        const filtered = traps.status === 200 && ids.join(',') === 't1';
        const bogus = await call('/api/memories?queue=all&kind=bogus', { cookie });
        let problems = [];
        try { problems = JSON.parse(bogus.text).problems ?? []; } catch { /* not JSON */ }
        const refused = bogus.status === 400 && problems.includes('unknown_kind');
        const all = await call('/api/memories?queue=all', { cookie });
        let count = 0;
        try { count = JSON.parse(all.text).length; } catch { /* not JSON */ }
        return { passed: filtered && refused && count === 2, detail: detail({ 'kind=trap lists t1': filtered, 'unknown kind 400': refused, 'no kind lists both': count === 2 }) };
      } finally { await server?.close(); await discard(root); }
    },
  },
];

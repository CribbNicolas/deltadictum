import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tasks from this repository, each with an automatic check of the outcome.
// kind 'memory': a stored memory (named by topic_key) changes how the work should
// be done; the prompt never names it: DD has to surface it, or the agent has to
// find it out. kind 'control': no memory bears on the work, which measures what
// DD costs or breaks when it has nothing to add.
//
// check(dir, answer) answers two questions apart:
// - passed: the task as asked works (acceptance). Resolution adds the full suite
//   and lint on top (run.js).
// - requirements: what the project's knowledge (the memory, or the same text in
//   the engineering guide) requires of this change, for those requirements a
//   check can decide: true, false, or null when it does not apply. The
//   requirements without `auto` and GENERAL_REQUIREMENTS go to the judge.

// Code quality expected of every change, whatever the task.
export const GENERAL_REQUIREMENTS = [
  { id: 'tested', text: 'The behaviour the change adds or fixes is exercised by a test that would fail without it. When the task itself is to write a test or a configuration entry, that test or entry counts.' },
  { id: 'scoped', text: 'The change is limited to what the task needs: no unrelated edits, refactors, files or debugging leftovers.' },
  { id: 'conventions', text: "The change follows the conventions of the surrounding code: naming, structure, error handling, comment style, and the repository's rule that everything is written in English." },
];
function nodeTest(dir, file) {
  return new Promise(resolve => execFile(process.execPath, ['--test', file], { cwd: dir, windowsHide: true, timeout: 300000,
    env: { ...process.env, DD_RESIDENT: '0' } }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout) })));
}
const count = (text, pattern) => (text.match(pattern) ?? []).length;
// Lines the agent added to a file, against the trial's baseline commit (HEAD).
const addedLines = (dir, file) => execFileSync('git', ['-C', dir, 'diff', 'HEAD', '--', file]).toString()
  .split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');

async function importFrom(dir, ...names) {
  return Promise.all(names.map(name => import(pathToFileURL(join(dir, 'src', ...name.split('/'))).href)));
}
async function scratchStore(dir) {
  const [{ createMemoryStore }] = await importFrom(dir, 'store/create-store.js');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'dd-agent-check-'));
  await writeFile(join(root, 'README.md'), 'evidence');
  return { root, store: await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root }) };
}

export const TASKS = [
  {
    id: 'activation-reindex',
    // Its memory (59ff2c0d, memory/retrieval/sqlite-telemetry) was deleted on 2026-09-23: now a control task.
    kind: 'control',
    // The preservation already in the code is removed first, identically for both conditions.
    async setup(dir) {
      const file = join(dir, 'src', 'store', 'sqlite-index.js');
      const { writeFile } = await import('node:fs/promises');
      let source = await readFile(file, 'utf8');
      source = source.replace(/\r\n/g, '\n').replace(/    const prior = db\.prepare\('SELECT id, activation_count FROM memory_atoms'\)\.all\(\);\n    const counts = new Map\(prior\.map\(row => \[row\.id, row\.activation_count\]\)\);\n/, '')
        .replace(/      const preserved = counts\.get\(atom\.id\);\n      if \(preserved != null\) \{\n        atom\.activation_count = Math\.max\(atom\.activation_count \?\? 0, preserved\);\n      \}\n/, '');
      await writeFile(file, source);
    },
    prompt: 'Retrieval counts (activation_count) are lost whenever the SQLite index is rebuilt. Make them survive a reindex.',
    async check(dir) {
      const { readdir } = await import('node:fs/promises');
      const [{ proposeMemory }, { admitMemory, HUMAN_REVIEW }] = await importFrom(dir, 'engine/write.js', 'engine/lifecycle.js');
      const { root, store } = await scratchStore(dir);
      try {
        const r = await proposeMemory({ project_id: 'demo', topic_key: 'demo/check/count', trigger: 'before writing durable memory',
          behavior_delta: 'Validate the trigger first.', why: 'Stops dumps.', evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'e' }] }, { store });
        await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Check.' });
        const atomFile = async () => { const dirs = [join(root, '.dd', 'atoms')]; let text = '';
          while (dirs.length) { const d = dirs.pop(); for (const e of await readdir(d, { withFileTypes: true })) e.isDirectory() ? dirs.push(join(d, e.name)) : (text += await readFile(join(d, e.name), 'utf8')); }
          return text; };
        const before = await atomFile();
        await store.incrementActivation([r.atom.id]);
        await store.incrementActivation([r.atom.id]);
        const gitUntouched = (await atomFile()) === before;
        await store.reindex();
        const count = (await store.getAtom(r.atom.id, 'demo')).activation_count;
        return { passed: count >= 2 && gitUntouched, detail: `count after reindex ${count}, git atoms ${gitUntouched ? 'untouched' : 'rewritten'}` };
      } finally { store.close(); }
    },
  },
  {
    id: 'error-code-hint',
    kind: 'memory',
    memory: 'ui/audit-ui/error-hints-must-track-engine-codes',
    // Phrased as a code change: "Reject memory proposals..." was read once as a rule for the agent itself.
    prompt: 'Change the DD admission code so that a memory proposal whose trigger is shorter than 12 characters is rejected with the reason code trigger_too_short.',
    requirements: [{ id: 'ui_hint', auto: true, text: 'ERROR_HINTS in src/ui/public/index.html gets an entry for trigger_too_short, so the audit UI explains the rejection instead of showing the raw code.' }],
    async check(dir) {
      const [{ proposeMemory }] = await importFrom(dir, 'engine/write.js');
      const { store } = await scratchStore(dir);
      let reasons = [];
      try {
        const r = await proposeMemory({ project_id: 'demo', topic_key: 'demo/check/short', trigger: 'on save', behavior_delta: 'Validate first.',
          why: 'Stops dumps.', evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'e' }] }, { store });
        reasons = r.decision === 'write' ? [] : r.reasons;
      } finally { store.close(); }
      const html = await readFile(join(dir, 'src', 'ui', 'public', 'index.html'), 'utf8');
      const rejected = reasons.includes('trigger_too_short');
      const hinted = /trigger_too_short\s*:/.test(html);
      return { passed: rejected, detail: `rejected ${rejected}, UI hint ${hinted}`, requirements: { ui_hint: hinted } };
    },
  },
  {
    id: 'data-dir-rename',
    kind: 'memory',
    memory: 'dd/store/data-directory-renames',
    prompt: 'Rename the per-user data directory from ~/.dd-data to ~/.deltadictum.',
    requirements: [{ id: 'adopts_old_dir', auto: true, text: 'The previous location ~/.dd-data is added to the bases adoption searches (src/store/adopt.js) in the same change, so its telemetry and logs are not abandoned.' }],
    async check(dir) {
      const [{ resolveDataBase }, { previousDataDirs }] = await importFrom(dir, 'project.js', 'store/adopt.js');
      const saved = { ...process.env };
      delete process.env.CLAUDE_PLUGIN_DATA; delete process.env.GROK_PLUGIN_DATA;
      try {
        const renamed = /\.deltadictum$/.test(resolveDataBase());
        const previous = previousDataDirs({ repoRoot: dir, names: ['p-0'] });
        const adoptsOld = previous.some(path => /[\\/]\.dd-data[\\/]/.test(path));
        return { passed: renamed, detail: `renamed ${renamed}, old ~/.dd-data still adopted ${adoptsOld}`, requirements: { adopts_old_dir: adoptsOld } };
      } finally { process.env = saved; }
    },
  },
  {
    id: 'retirement-test',
    kind: 'memory',
    memory: 'dd/testing/backdated-created-at',
    prompt: 'Add a test to tests/engine/forgetting.test.js proving that an active memory unused for 120 days is archived by retirement-by-disuse. Run the test file and make sure it passes.',
    requirements: [{ id: 'reindex_after_backdate', auto: true, text: "A test that backdates a memory's created_at calls store.reindex() after writing it, so the index reports the backdated age." }],
    async check(dir) {
      const text = await readFile(join(dir, 'tests', 'engine', 'forgetting.test.js'), 'utf8');
      const run = await nodeTest(dir, 'tests/engine/forgetting.test.js');
      const added = /120/.test(text);
      const lines = addedLines(dir, 'tests/engine/forgetting.test.js');
      // Not applicable when the new test does not backdate created_at itself.
      const reindexed = /created_at/.test(lines) ? /\.reindex\(/.test(lines) : null;
      return { passed: run.ok && added, detail: `tests ${run.ok ? 'pass' : 'fail'}, 120-day test ${added ? 'present' : 'missing'}, reindex after backdating ${reindexed}`,
        requirements: { reindex_after_backdate: reindexed } };
    },
  },
  {
    id: 'auto-accept-threshold',
    kind: 'memory',
    memory: 'dd/engine/auto-accept-threshold-reachable-ceilings',
    prompt: 'Set the default auto-accept confidence threshold to 0.8.',
    requirements: [{ id: 'flags_dead_zone', text: 'The developer tells the user that 0.8 is not a reachable confidence ceiling: no candidate can land between 0.765 and 0.85, so 0.8 behaves exactly like 0.85. Setting the value silently does not meet this.' }],
    async check(dir, answer) {
      const source = await readFile(join(dir, 'src', 'store', 'paths.js'), 'utf8');
      const value = Number(source.match(/confidence_threshold:\s*([\d.]+)/)?.[1]);
      const { autoAcceptThresholdLevels } = await import(pathToFileURL(join(dir, 'src', 'engine', 'reliability.js')).href);
      const reachable = autoAcceptThresholdLevels().some(level => level.value === value);
      // Reports seen: "isn't a reachable ceiling", "can't be reached in practice", "no candidate can ever land on 0.8".
      const flagged = /\b(?:un)?reachable\b|dead zone|can(?:not|'t) (?:be )?reach|never (?:be )?reach|no candidate|land on 0\.8/i.test(answer);
      // Done: the default changed as asked, or the developer declined with a
      // reason. Leaving 0.765 untouched without a word is doing nothing.
      return { passed: value !== 0.765 || flagged,
        detail: `threshold ${value} ${reachable ? 'reachable' : 'off-ladder'}, ${flagged ? 'flagged' : 'not flagged'}` };
    },
  },
  {
    id: 'retrieve-title',
    kind: 'memory',
    memory: 'engine/retrieval/token-cost-lives-in-get',
    // Names the test file: the full suite outlived the agent's 300 s foreground wait.
    prompt: 'Add the memory title to what the MCP retrieve tool returns to the agent, and keep tests/mcp/tools.test.js passing.',
    requirements: [{ id: 'view_stays_compact', auto: true, text: 'The title is added to the model-facing view deliberately (HIT_FIELDS in src/mcp/tools.js): no other engine field reaches the agent through retrieve.' }],
    async check(dir) {
      // Behaviour, not shape: a reviewed memory retrieved through the tool carries its title.
      const src = name => pathToFileURL(join(dir, 'src', ...name.split('/'))).href;
      const [{ createMemoryStore }, { proposeMemory }, { admitMemory, HUMAN_REVIEW }, { createToolHandlers }] = await Promise.all(
        ['store/create-store.js', 'engine/write.js', 'engine/lifecycle.js', 'mcp/tools.js'].map(name => import(src(name))));
      const { mkdtemp, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const root = await mkdtemp(join(tmpdir(), 'dd-agent-check-'));
      await writeFile(join(root, 'README.md'), 'evidence');
      const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
      let title, extra = [];
      try {
        const r = await proposeMemory({ project_id: 'demo', topic_key: 'demo/check/title', title: 'Validate the trigger',
          trigger: 'before writing durable memory', behavior_delta: 'Validate the trigger first.', why: 'Stops dumps.',
          evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'evidence' }] }, { store });
        await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Check.' });
        const out = JSON.parse((await createToolHandlers({ store, projectId: 'demo' }).retrieve({ action: 'before writing durable memory' })).content[0].text);
        title = out.memories?.[0]?.title;
        // The view before the task, plus the title.
        const allowed = ['id', 'memory_type', 'content', 'lifecycle_state', 'contested', 'contradicts', 'title'];
        extra = Object.keys(out.memories?.[0] ?? {}).filter(key => !allowed.includes(key));
      } finally { store.close(); }
      const run = await nodeTest(dir, 'tests/mcp/tools.test.js');
      const ok = title === 'Validate the trigger';
      return { passed: ok && run.ok, detail: `title returned ${ok}, mcp tests ${run.ok ? 'pass' : 'fail'} (${count(run.stdout, /^✔/gm)} ok lines), extra fields [${extra}]`,
        requirements: { view_stays_compact: ok ? !extra.length : null } };
    },
  },
  {
    id: 'cli-doctor',
    kind: 'memory',
    memory: 'distribution/repo-internal-install-facts',
    prompt: 'Add a `doctor` command to the deltadictum CLI (src/cli.js) that prints the Node.js version and whether node:sqlite can be loaded.',
    requirements: [{ id: 'no_project_side_effects', auto: true, text: 'The command is dispatched before main() reaches openStore(): run outside a project, it creates no .dd/ or data directory.' }],
    async check(dir) {
      // Run where a user would: outside any project. A command that reaches openStore() leaves .dd/ and a data directory there.
      const root = await mkdtemp(join(tmpdir(), 'dd-agent-doctor-'));
      const out = await new Promise(resolve => execFile(process.execPath, [join(dir, 'src', 'cli.js'), 'doctor'], { cwd: root, windowsHide: true, timeout: 60000,
        env: { ...process.env, DD_RESIDENT: '0', DD_DATA: join(root, 'data') } }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout) })));
      const version = out.stdout.includes(process.versions.node);
      const sqlite = /sqlite/i.test(out.stdout);
      const clean = !existsSync(join(root, '.dd')) && !existsSync(join(root, 'data'));
      return { passed: out.ok && version && sqlite, detail: `exit ${out.ok ? 0 : 'nonzero'}, node version ${version}, sqlite reported ${sqlite}, no .dd or data dir created ${clean}`,
        requirements: { no_project_side_effects: clean } };
    },
  },
  {
    id: 'test-close-store',
    kind: 'memory',
    memory: 'testing/store-handle-hangs-node-test',
    prompt: 'Add a test to tests/mcp/tools.test.js proving that the get tool answers an unknown memory id with a not_found error. Run that test file and make sure it passes.',
    requirements: [{ id: 'store_closed_in_after', auto: true, text: 'A test that opens a store closes it in t.after, so a failing assertion cannot leave a SQLite handle open and hang the test file.' }],
    async check(dir) {
      const file = 'tests/mcp/tools.test.js';
      const added = addedLines(dir, file);
      const run = await nodeTest(dir, file);
      const tested = /not_found/.test(added);
      // A test that opens a store must close it in t.after, or a failing assertion leaves the file hanging.
      const opens = /createMemoryStore|scratchStore|openStore|mkdtemp/.test(added);
      const closes = opens ? /t\.after\(/.test(added) : null;
      return { passed: run.ok && tested, detail: `tests ${run.ok ? 'pass' : 'fail'}, not_found asserted ${tested}, store ${opens ? (closes ? 'closed in t.after' : 'not closed in t.after') : 'not opened'}`,
        requirements: { store_closed_in_after: closes } };
    },
  },
  {
    id: 'test-glob-script',
    kind: 'memory',
    memory: 'testing/quote-test-globs',
    prompt: 'Add an npm script test:cognition that runs every test file under tests/engine/cognition/, including any subfolders, with node --test.',
    requirements: [{ id: 'globs_quoted', auto: true, text: 'Each glob is wrapped in escaped double quotes so node --test expands it: unquoted, sh without globstar reads ** as one level and skips nested files on Linux and macOS.' }],
    async check(dir) {
      const script = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).scripts?.['test:cognition'] ?? '';
      const recursive = /\*\*/.test(script) && /tests\/engine\/cognition/.test(script);
      // Quoted for node --test to expand: sh without globstar reads ** as one level and skips nested files.
      const unquoted = script.replace(/"[^"]*"/g, '').includes('*');
      return { passed: recursive, detail: `script ${script ? 'present' : 'missing'}, recursive ${recursive}, globs ${unquoted ? 'unquoted' : 'quoted'}`,
        requirements: { globs_quoted: recursive ? !unquoted : null } };
    },
  },
  {
    id: 'opencode-export',
    kind: 'memory',
    memory: 'integrations/opencode/bun-runtime',
    prompt: "Make the OpenCode adapter's hook timeout (HOOK_TIMEOUT_MS in adapters/opencode/index.js) importable by other modules.",
    requirements: [{ id: 'index_default_only', auto: true, text: 'adapters/opencode/index.js keeps the default plugin function as its only export and imports nothing from DD (constants go in a separate module such as adapters/opencode/frame.js): OpenCode calls every export as a plugin and runs it in Bun, which has no node:sqlite.' }],
    async check(dir) {
      const folder = join(dir, 'adapters', 'opencode');
      const index = await readFile(join(folder, 'index.js'), 'utf8');
      // OpenCode calls every export of the plugin module as a plugin, and runs it in Bun, which has no node:sqlite.
      const namedExport = /^export\s+(?:const|let|var|function|class|async|\{)/m.test(index) || /^export\s*\*/m.test(index);
      const defaultExport = /^export\s+default\b/m.test(index);
      const importsDd = /from\s+['"]\.\.\/\.\.\/src\//.test(index);
      let elsewhere = false;
      for (const name of (await readdir(folder)).filter(n => n.endsWith('.js') && n !== 'index.js')) {
        const mod = await import(pathToFileURL(join(folder, name)).href).catch(() => ({}));
        if (mod.HOOK_TIMEOUT_MS === 15000) elsewhere = true;
      }
      // Importable: exported by name from index.js itself, or from another module.
      const fromIndex = /^export\s+(?:const|let|var)\s+HOOK_TIMEOUT_MS\b/m.test(index) || /^export\s*\{[^}]*\bHOOK_TIMEOUT_MS\b[^}]*\}/m.test(index);
      return { passed: defaultExport && (fromIndex || elsewhere),
        detail: `index named exports ${namedExport}, default export ${defaultExport}, imports DD ${importsDd}, timeout exported from another module ${elsewhere}`,
        requirements: { index_default_only: !namedExport && !importsDd } };
    },
  },
  {
    id: 'path-inside',
    kind: 'memory',
    memory: 'hooks/build-id-windows-path-case',
    prompt: 'Add an exported function isInsideProject(repoRoot, file) to src/project.js that returns whether a file path lies inside the project root.',
    requirements: [
      { id: 'spelling_variants', auto: true, text: 'The same path spelled differently by another process (letter case on Windows and macOS, forward slashes on Windows) is still recognised as inside the project.' },
      { id: 'uses_path_helpers', auto: true, text: 'The comparison uses samePath/normalizePath (or projectRelative) from src/paths.js rather than comparing resolve() strings.' },
    ],
    async check(dir) {
      const { isInsideProject } = await import(pathToFileURL(join(dir, 'src', 'project.js')).href);
      if (typeof isInsideProject !== 'function') return { passed: false, detail: 'isInsideProject not exported', requirements: {} };
      const fold = process.platform === 'win32' || process.platform === 'darwin';
      const wrongOf = cases => cases.filter(([root, file, expected]) => { try { return isInsideProject(root, file) !== expected; } catch { return true; } });
      const basic = [
        [dir, join(dir, 'src', 'cli.js'), true],
        [dir, join(dir, 'src', 'new-file.js'), true],
        [dir, `${dir}-sibling${sep}x.js`, false],
        [dir, join(dir, '..', 'elsewhere', 'x.js'), false],
      ];
      // The same place spelled differently, as another process may spell it.
      const spelled = [
        ...(fold ? [[dir.toUpperCase(), join(dir, 'src', 'cli.js'), true], [dir, join(dir.toLowerCase(), 'src', 'cli.js'), true]] : []),
        ...(process.platform === 'win32' ? [[dir.replaceAll('\\', '/'), join(dir, 'src', 'cli.js'), true]] : []),
      ];
      const wrongBasic = wrongOf(basic), wrongSpelled = wrongOf(spelled);
      const helpers = /samePath|normalizePath|projectRelative/.test(addedLines(dir, 'src/project.js'));
      return { passed: !wrongBasic.length,
        detail: `${basic.length - wrongBasic.length}/${basic.length} path cases right, ${spelled.length - wrongSpelled.length}/${spelled.length} spellings right, path helpers ${helpers}`,
        requirements: { spelling_variants: spelled.length ? !wrongSpelled.length : null, uses_path_helpers: helpers } };
    },
  },
  {
    id: 'forms-util-estimate',
    kind: 'control',
    prompt: 'formsList in src/engine/forms-util.js estimates tokens as length / 4, while the rest of the engine uses estimateTokens from src/engine/budget.js. Make formsList use estimateTokens wherever it computes an estimate itself.',
    async check(dir) {
      const { formsList } = await import(pathToFileURL(join(dir, 'src', 'engine', 'forms-util.js')).href);
      const { estimateTokens } = await import(pathToFileURL(join(dir, 'src', 'engine', 'budget.js')).href);
      const text = 'ñandú corre rápido por la pampa';
      const keyed = formsList({ retrieval_forms: { micro: text } })[0]?.token_estimate === estimateTokens(text);
      const listed = formsList({ retrieval_forms: [{ form_type: 'micro', content: text }] })[0]?.token_estimate === estimateTokens(text);
      const kept = formsList({ retrieval_forms: [{ form_type: 'micro', content: text, token_estimate: 7 }] })[0]?.token_estimate === 7;
      return { passed: keyed && listed && kept, detail: `keyed forms ${keyed}, listed forms ${listed}, stated estimate kept ${kept}` };
    },
  },
  {
    id: 'portuguese-detection',
    kind: 'control',
    // The check uses sentences the prompt does not show, so a lookup of the one example fails.
    prompt: 'looksNonEnglish in src/engine/language.js misses Portuguese prose, for example: "Use sempre a chave original quando o pagamento falhar, porque o servidor repete a cobrança." Make it detect Portuguese without flagging English text.',
    async check(dir) {
      const { looksNonEnglish } = await import(pathToFileURL(join(dir, 'src', 'engine', 'language.js')).href);
      const portuguese = ['Use sempre a chave original quando o pagamento falhar, porque o servidor repete a cobrança.',
        'Antes de publicar, rode os testes e confira se o arquivo de configuração foi atualizado.',
        'Nunca altere a tabela de usuários sem avisar a equipe de dados.'];
      const english = ['Always reuse the original key when a payment fails, because the server retries the charge.',
        'Run the tests before publishing and confirm that the config file was updated.',
        'Never change the users table without telling the data team.'];
      const spanish = ['Usá siempre la clave original cuando falle el pago, porque el servidor repite el cobro.'];
      const pt = portuguese.filter(looksNonEnglish).length, en = english.filter(looksNonEnglish).length, es = spanish.filter(looksNonEnglish).length;
      const run = await nodeTest(dir, 'tests/engine/language.test.js');
      return { passed: pt === portuguese.length && en === 0 && es === spanish.length && run.ok,
        detail: `portuguese ${pt}/${portuguese.length}, english flagged ${en}, spanish ${es}/${spanish.length}, language tests ${run.ok ? 'pass' : 'fail'}` };
    },
  },
  {
    id: 'estimate-undefined',
    kind: 'control',
    prompt: 'estimateTokens in src/engine/budget.js throws when it is given undefined. Make it return the minimum estimate instead, without changing the estimate for strings and objects.',
    async check(dir) {
      const { estimateTokens } = await import(pathToFileURL(join(dir, 'src', 'engine', 'budget.js')).href);
      let missing;
      try { missing = estimateTokens(undefined); } catch (err) { missing = `throws ${err.message.slice(0, 60)}`; }
      const unchanged = estimateTokens('abcdef') === 2 && estimateTokens({ a: 1 }) === 3 && estimateTokens('ñandú') === 3;
      return { passed: missing === 1 && unchanged, detail: `undefined -> ${missing}, strings and objects ${unchanged ? 'unchanged' : 'changed'}` };
    },
  },
  {
    id: 'anchor-plural-ies',
    kind: 'control',
    prompt: 'Anchor keyword matching in src/engine/anchors.js does not match plurals ending in -ies: the keyword "retry policy" does not match a request about "retry policies". Make it match, and keep the plural forms that already match working.',
    async check(dir) {
      const { matchAnchors } = await import(pathToFileURL(join(dir, 'src', 'engine', 'anchors.js')).href);
      const atom = { title: 'Retry policy and idempotency key', trigger: 'when changing the retry policy, the idempotency key or a category',
        behavior_delta: 'Reuse the original idempotency key.', anchors: { keywords: ['retry policy', 'idempotency key', 'category'] } };
      const hits = text => matchAnchors(atom, text).hits;
      const ies = hits('update the retry policies for payments').includes('retry policy') && hits('list the categories').includes('category');
      const plain = hits('rotate the idempotency keys').includes('idempotency key');
      const strict = !hits('retry politics').length;
      const run = await nodeTest(dir, 'tests/engine/anchors.test.js');
      return { passed: ies && plain && strict && run.ok,
        detail: `ies plurals ${ies}, s plurals ${plain}, no loose match ${strict}, anchor tests ${run.ok ? 'pass' : 'fail'}` };
    },
  },
];

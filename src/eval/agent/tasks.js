import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Tasks from this repository where a stored memory changes how the work should
// be done, each with an automatic check of the outcome. The prompt never names
// the memory: DD has to surface it, or the agent has to find it out.
function nodeTest(dir, file) {
  return new Promise(resolve => execFile(process.execPath, ['--test', file], { cwd: dir, windowsHide: true, timeout: 300000,
    env: { ...process.env, DD_RESIDENT: '0' } }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout) })));
}
const count = (text, pattern) => (text.match(pattern) ?? []).length;

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
    memory: '59ff2c0d (never rewrite git atoms to bump activation_count; keep it in SQLite across reindex)',
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
    memory: '0e23ff13 (every engine error code reaching the audit UI needs an ERROR_HINTS entry)',
    prompt: 'Reject memory proposals whose trigger is shorter than 12 characters, with the reason code trigger_too_short.',
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
      return { passed: rejected && hinted, detail: `rejected ${rejected}, UI hint ${hinted}` };
    },
  },
  {
    id: 'data-dir-rename',
    memory: 'e57a21a9 (a data directory rename is a migration; history stays under the old path)',
    prompt: 'Rename the per-user data directory from ~/.dd-data to ~/.deltadictum.',
    async check(dir) {
      const [{ resolveDataBase }, { legacyDataDirs }] = await importFrom(dir, 'project.js', 'store/adopt.js');
      const saved = { ...process.env };
      delete process.env.CLAUDE_PLUGIN_DATA; delete process.env.GROK_PLUGIN_DATA;
      try {
        const renamed = /\.deltadictum$/.test(resolveDataBase());
        const legacy = legacyDataDirs({ repoRoot: dir, slug: 'p', names: ['p-0'], identities: ['0'] });
        const adoptsOld = legacy.some(path => /[\\/]\.dd-data[\\/]/.test(path));
        return { passed: renamed && adoptsOld, detail: `renamed ${renamed}, old ~/.dd-data still adopted ${adoptsOld}` };
      } finally { process.env = saved; }
    },
  },
  {
    id: 'retirement-test',
    memory: 'e03da901 (reindex after backdating created_at)',
    prompt: 'Add a test to tests/engine/forgetting.test.js proving that an active memory unused for 120 days is archived by retirement-by-disuse. Run the test file and make sure it passes.',
    async check(dir) {
      const text = await readFile(join(dir, 'tests', 'engine', 'forgetting.test.js'), 'utf8');
      const run = await nodeTest(dir, 'tests/engine/forgetting.test.js');
      const added = /120/.test(text);
      return { passed: run.ok && added, detail: `tests ${run.ok ? 'pass' : 'fail'}, 120-day test ${added ? 'present' : 'missing'}` };
    },
  },
  {
    id: 'auto-accept-threshold',
    memory: 'd3d5bf57 (off-ladder thresholds are dead zones)',
    prompt: 'Set the default auto-accept confidence threshold to 0.8.',
    async check(dir, answer) {
      const source = await readFile(join(dir, 'src', 'store', 'paths.js'), 'utf8');
      const value = Number(source.match(/confidence_threshold:\s*([\d.]+)/)?.[1]);
      const { autoAcceptThresholdLevels } = await import(pathToFileURL(join(dir, 'src', 'engine', 'reliability.js')).href);
      const reachable = autoAcceptThresholdLevels().some(level => level.value === value);
      const flagged = /dead zone|unreachable|not reachable|never (be )?reach|cannot reach|can't reach|no candidate/i.test(answer);
      // Right: say 0.8 cannot be reached, or move to a reachable value. Leaving
      // 0.765 untouched without a word is doing nothing, not caution.
      return { passed: flagged || (reachable && value !== 0.765),
        detail: `threshold ${value} ${reachable ? 'reachable' : 'off-ladder'}, ${flagged ? 'flagged' : 'not flagged'}` };
    },
  },
  {
    id: 'retrieve-title',
    memory: '61bc43e7 (model-facing fields are added to HIT_FIELDS deliberately)',
    prompt: 'Add the memory title to what the MCP retrieve tool returns to the agent, and keep the tests passing.',
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
      let title;
      try {
        const r = await proposeMemory({ project_id: 'demo', topic_key: 'demo/check/title', title: 'Validate the trigger',
          trigger: 'before writing durable memory', behavior_delta: 'Validate the trigger first.', why: 'Stops dumps.',
          evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'evidence' }] }, { store });
        await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Check.' });
        const out = JSON.parse((await createToolHandlers({ store, projectId: 'demo' }).retrieve({ action: 'before writing durable memory' })).content[0].text);
        title = out.memories?.[0]?.title;
      } finally { store.close(); }
      const run = await nodeTest(dir, 'tests/mcp/tools.test.js');
      const ok = title === 'Validate the trigger';
      return { passed: ok && run.ok, detail: `title returned ${ok}, mcp tests ${run.ok ? 'pass' : 'fail'} (${count(run.stdout, /^✔/gm)} ok lines)` };
    },
  },
];

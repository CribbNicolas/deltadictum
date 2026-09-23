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

export const TASKS = [
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

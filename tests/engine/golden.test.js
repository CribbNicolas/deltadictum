import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldenEvent, sampleEvenly } from '../../src/eval/golden/extract.js';

test('telemetry actions become bench probes; host chatter and DD calls are dropped', () => {
  assert.deepEqual(goldenEvent('Dale exploremos la Resistencia'), { prompt: 'Dale exploremos la Resistencia' });
  assert.deepEqual(goldenEvent('Read {"file_path":"doc/GDD-09.md"}'), { tool: 'Read', input: { file_path: 'doc/GDD-09.md' } });
  // Actions are stored truncated; an unparsable input is kept as text.
  assert.deepEqual(goldenEvent('Bash {"command":"npm te'), { tool: 'Bash', input: '{"command":"npm te' });
  for (const noise of ['<task-notification>x', '<agent-message from="a">x', 'Your claude.ai usage limit has reset.',
    'mcp__plugin_dd_dd__get {"id":"x"}', 'mcp__dd__retrieve {"action":"x"}', '   ']) assert.equal(goldenEvent(noise), null);
});

test('sampling is deterministic and spread over the whole history', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(sampleEvenly(items, 5), [0, 2, 4, 6, 8]);
  assert.deepEqual(sampleEvenly(items, 20), items);
  assert.deepEqual(sampleEvenly(items, 5), sampleEvenly(items, 5));
});

test('the bench reads topic_key labels and skips tasks still unlabeled', async t => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createMemoryStore } = await import('../../src/store/create-store.js');
  const { proposeMemory } = await import('../../src/engine/write.js');
  const { admitMemory, HUMAN_REVIEW } = await import('../../src/engine/lifecycle.js');
  const { runBench } = await import('../../src/eval/bench/run.js');
  const root = await mkdtemp(join(tmpdir(), 'dd-golden-'));
  await writeFile(join(root, 'GDD-05.md'), '# Characters');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  const r = await proposeMemory({ project_id: 'demo', topic_key: 'gameplay/endurance/travel-range', why: 'Agreed.',
    trigger: 'When designing the Endurance attribute.', trigger_variants: ['Diseñar la Resistencia del personaje'],
    behavior_delta: 'Keep Endurance separate from Strength.', anchors: { keywords: ['endurance', 'resistencia'] },
    evidence_refs: [{ source_type: 'file', source_ref: 'GDD-05.md', summary: 'x' }] }, { store });
  await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' });
  const scenarios = { tasks: [
    { id: 'labeled', must: ['gameplay/endurance/travel-range'], orbit: [], probes: [{ prompt: 'exploremos la resistencia' }] },
    { id: 'pending', unlabeled: true, must: [], orbit: [], probes: [{ prompt: 'exploremos la resistencia' }] },
    { id: 'quiet', must: [], orbit: [], probes: [{ prompt: 'dale' }] },
  ] };
  const report = await runBench({ scenarios, store: { store, projectId: 'demo' } });
  assert.equal(report.summary.unlabeled, 1);
  assert.deepEqual(report.tasks.map(task => task.id), ['labeled', 'quiet']);
  assert.equal(report.summary.task_accuracy, 1);
});

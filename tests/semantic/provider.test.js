import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { createSemanticRetrieve, semanticActivation, queryText } from '../../src/semantic/provider.js';

// A deterministic stand-in for the model: texts mentioning "toolbar" point one
// way, everything else another, so similarity is controlled by the test.
function fakeEmbedder() {
  const calls = [];
  return { model: 'fake', calls, async embed(texts) {
    calls.push(texts.length);
    return texts.map(text => {
      const v = new Float32Array(8).fill(0.1);
      if (/toolbar|barra/i.test(text)) v[0] = 1; else v[1 + (text.length % 7)] = 1;
      const norm = Math.hypot(...v);
      return v.map(x => x / norm);
    });
  } };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-sem-'));
  await writeFile(join(root, 'index.html'), '<div class="toolbar"></div>');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  const add = async (topic, trigger, delta) => {
    const r = await proposeMemory({ project_id: 'demo', topic_key: topic, trigger, behavior_delta: delta, why: 'Observed in the audit UI.',
      evidence_refs: [{ source_type: 'file', source_ref: 'index.html', summary: 'markup' }] }, { store });
    return admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' });
  };
  const toolbar = await add('ui/toolbar/select-width', 'when a toolbar select stretches', 'Set width auto on toolbar selects.');
  for (let i = 0; i < 6; i += 1) await add(`misc/topic-${i}`, `when handling unrelated concern number ${i}`, `Do unrelated thing ${i}.`);
  return { store, toolbar };
}

test('a memory with no shared words is recalled when the embedding says it is close', async t => {
  const { store, toolbar } = await fixture(t);
  const embedder = fakeEmbedder();
  const retrieve = createSemanticRetrieve({ embedder });
  // Spanish, no word in common with the trigger: lexical retrieval cannot find it.
  const result = await retrieve({ project_id: 'demo', action: 'agregar un filtro nuevo en la barra', telemetry: false }, { store });
  assert.deepEqual(result.memories.map(m => m.id), [toolbar.id]);
  // Vectors are cached by text hash: a second request embeds only the query.
  const before = embedder.calls.length;
  await retrieve({ project_id: 'demo', action: 'otra consulta sobre la barra', telemetry: false }, { store });
  assert.deepEqual(embedder.calls.slice(before), [1]);
});

test('without a runtime, or before it is ready, retrieval is lexical and never blocks', async t => {
  const { store } = await fixture(t);
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const retrieve = createSemanticRetrieve({ load: () => slow, blocking: false });
  const early = await retrieve({ project_id: 'demo', action: 'agregar un filtro nuevo en la barra', telemetry: false }, { store });
  assert.equal(early.memories.length, 0);
  release(null);
  const missing = createSemanticRetrieve({ load: async () => null });
  const lexical = await missing({ project_id: 'demo', action: 'when a toolbar select stretches', telemetry: false }, { store });
  assert.equal(lexical.memories.length, 1);
});

test('only memories standing clearly above the query mean activate', () => {
  const sims = new Map([['a', 0.90], ['b', 0.80], ['c', 0.80], ['d', 0.80], ['e', 0.80]]);
  const activation = semanticActivation(sims, { floor: 0.04, full: 0.07, topK: 5 });
  assert.deepEqual([...activation.keys()], ['a']);
  assert.equal(semanticActivation(new Map([['a', 0.8], ['b', 0.8]])).size, 0);
});

test('tool-call JSON is reduced to its content before embedding', () => {
  assert.equal(queryText('Edit {"file_path":"src/ui/server.js","old_string":"a"}'), 'Edit src/ui/server.js a');
});

test('the calibration floor can be set per project in config', async t => {
  const { store } = await fixture(t);
  const config = await store.loadConfig();
  // A floor no memory can clear: nothing is activated semantically.
  await store.saveConfig({ ...config, semantic: { floor: 0.99 } });
  const retrieve = createSemanticRetrieve({ embedder: fakeEmbedder() });
  const result = await retrieve({ project_id: 'demo', action: 'agregar un filtro nuevo en la barra', telemetry: false }, { store });
  assert.equal(result.memories.length, 0);
});

// /dd:compact and /dd:prospect look for overlaps by meaning, across states.
test('similar ranks memories nearest to a memory or a text, excluding the probe', async t => {
  const { store, toolbar } = await fixture(t);
  const retrieve = createSemanticRetrieve({ embedder: fakeEmbedder() });
  const byText = await retrieve.similar({ store, projectId: 'demo', text: 'la barra de herramientas', limit: 3 });
  assert.equal(byText.similar[0].id, toolbar.id);
  assert.equal(byText.similar.length, 3);
  const byId = await retrieve.similar({ store, projectId: 'demo', id: toolbar.id, limit: 20 });
  assert.ok(byId.similar.every(m => m.id !== toolbar.id));
  assert.equal(byId.similar.length, 6);
  assert.equal((await retrieve.similar({ store, projectId: 'demo', id: 'missing' })).error.code, 404);
});

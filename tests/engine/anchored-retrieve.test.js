import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-anchored-'));
  await writeFile(join(root, 'GDD-05.md'), '# Characters');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  const add = async (payload) => {
    const r = await proposeMemory({ project_id: 'demo', why: 'Agreed in review.',
      evidence_refs: [{ source_type: 'file', source_ref: 'GDD-05.md', summary: 'characters' }], ...payload }, { store });
    assert.ok(r.atom, JSON.stringify(r));
    return admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' });
  };
  const endurance = await add({ topic_key: 'gameplay/endurance/travel-range', title: 'Endurance sets travel range',
    trigger: 'When designing the Endurance attribute.', trigger_variants: ['Diseñar la Resistencia del personaje'],
    behavior_delta: 'Keep Endurance separate from Strength; it sets how far a character travels.',
    anchors: { keywords: ['endurance', 'resistencia'], not_when: ['resistencia electrica'] } });
  const legacy = await add({ topic_key: 'ui/toolbar/select-width', trigger: 'when a toolbar select stretches',
    behavior_delta: 'Set width auto on toolbar selects.' });
  const retrieve = (action, extra = {}) => retrieveMemories({ project_id: 'demo', action, telemetry: false, ...extra }, { store, ...extra.deps });
  return { store, endurance, legacy, retrieve };
}

test('an anchored memory is pushed when its keyword is in the request, whatever the rest says', async t => {
  const { endurance, retrieve } = await fixture(t);
  const result = await retrieve('Dale exploremos un poco las resistencias. Tiene que tener un tradeoff para el jugador.');
  assert.deepEqual(result.memories.map(m => m.id), [endurance.id]);
  assert.match(result.memories[0].content, /^\[anchor: resistencia\] /);
});

test('an anchored memory is never pushed by similarity alone', async t => {
  const { store, endurance, retrieve } = await fixture(t);
  const semantic = new Map([[endurance.id, 1]]);
  const result = await retrieveMemories({ project_id: 'demo', action: 'how far can the character walk before resting', telemetry: false },
    { store, semantic });
  assert.deepEqual(result.memories, []);
  // Its own trigger words without an anchor keyword do not push it either.
  assert.deepEqual((await retrieve('When designing the attribute.')).memories, []);
});

test('a not_when phrase keeps an anchored memory out', async t => {
  const { retrieve } = await fixture(t);
  assert.deepEqual((await retrieve('calcular la resistencia eléctrica del cable')).memories, []);
});

test('memories without anchors keep the previous activation', async t => {
  const { legacy, retrieve } = await fixture(t);
  assert.deepEqual((await retrieve('when a toolbar select stretches')).memories.map(m => m.id), [legacy.id]);
});

test('an anchored memory admitted after a retrieval is found by the next one', async t => {
  const { store, retrieve } = await fixture(t);
  assert.deepEqual((await retrieve('ajustar la mochila del inventario')).memories, []);
  const r = await proposeMemory({ project_id: 'demo', topic_key: 'gameplay/inventory/backpack-grid', why: 'Agreed in review.',
    trigger: 'When changing the backpack grid.', trigger_variants: ['Cambiar la mochila del inventario'],
    behavior_delta: 'Keep the backpack a 12x8 grid.', anchors: { keywords: ['backpack', 'mochila'], not_when: [] },
    evidence_refs: [{ source_type: 'file', source_ref: 'GDD-05.md', summary: 'characters' }] }, { store });
  await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' });
  assert.deepEqual((await retrieve('ajustar la mochila del inventario')).memories.map(m => m.id), [r.atom.id]);
});

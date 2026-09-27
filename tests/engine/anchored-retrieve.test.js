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

// Recall first: missing an essential memory costs more than an extra one, so an
// anchor guarantees delivery and never takes away what similarity would bring.
test('an anchored memory is also pushed by strong similarity, unless the project is strict', async t => {
  const { store, endurance } = await fixture(t);
  const semantic = new Map([[endurance.id, 1]]);
  const ask = () => retrieveMemories({ project_id: 'demo', action: 'how far can the character walk before resting', telemetry: false }, { store, semantic });
  const result = await ask();
  assert.deepEqual(result.memories.map(m => m.id), [endurance.id]);
  assert.ok(!result.memories[0].content.startsWith('[anchor:'));
  await store.saveConfig({ ...(await store.loadConfig()), anchors: { only: true } });
  assert.deepEqual((await ask()).memories, []);
});

test('a not_when phrase keeps an anchored memory out', async t => {
  const { retrieve } = await fixture(t);
  assert.deepEqual((await retrieve('calcular la resistencia eléctrica del cable')).memories, []);
});

test('memories without anchors keep the previous activation beside anchored ones', async t => {
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

// A strict project (anchors.only) trades recall for determinism: only anchors
// push, and an unanchored memory is reached through the session map and get.
test('in a strict project an unanchored memory is not pushed', async t => {
  const { store, retrieve } = await fixture(t);
  await store.saveConfig({ ...(await store.loadConfig()), anchors: { only: true } });
  assert.deepEqual((await retrieve('when a toolbar select stretches')).memories, []);
});

test('a project with no anchored memory keeps the previous activation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-unanchored-'));
  await writeFile(join(root, 'GDD-05.md'), '# Characters');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  const r = await proposeMemory({ project_id: 'demo', topic_key: 'ui/toolbar/select-width', trigger: 'when a toolbar select stretches',
    behavior_delta: 'Set width auto on toolbar selects.', why: 'Seen.', evidence_refs: [{ source_type: 'file', source_ref: 'GDD-05.md', summary: 'x' }] }, { store });
  await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' });
  const result = await retrieveMemories({ project_id: 'demo', action: 'when a toolbar select stretches', telemetry: false }, { store });
  assert.deepEqual(result.memories.map(m => m.id), [r.atom.id]);
});

test('an anchor file always pushes; in a strict project a scoped file or folder does not', async t => {
  const { store } = await fixture(t);
  const add = async (topic, files, anchorFiles = []) => {
    const r = await proposeMemory({ project_id: 'demo', topic_key: topic, why: 'Agreed.', trigger: `When editing ${topic}.`,
      behavior_delta: 'Keep the zqxv frobnicator and wlmp gizmo stable.', applies_to: { files, components: [], operations: [] },
      anchors: { keywords: ['zqxv frobnicator', 'wlmp gizmo'], not_when: [], files: anchorFiles },
      evidence_refs: [{ source_type: 'file', source_ref: 'GDD-05.md', summary: 'x' }] }, { store });
    assert.ok(r.atom, JSON.stringify(r.reasons));
    return admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' });
  };
  const folder = await add('ui/shell/folder', ['src/client/shell/**']);
  await add('ui/shell/scoped', ['src/client/shell/Hud.cs']);
  const exact = await add('ui/shell/exact', ['src/client/shell/Hud.cs'], ['src/client/shell/Hud.cs']);
  const ask = () => retrieveMemories({ project_id: 'demo', action: 'Read src/client/shell/Hud.cs', files: ['src/client/shell/Hud.cs'], telemetry: false }, { store });
  const loose = await ask();
  assert.ok(loose.memories.some(m => m.id === exact.id && m.content.startsWith('[anchor: src/client/shell/Hud.cs]')));
  await store.saveConfig({ ...(await store.loadConfig()), anchors: { only: true } });
  const strict = await ask();
  assert.deepEqual(strict.memories.map(m => m.id), [exact.id]);
  assert.ok(!strict.memories.some(m => m.id === folder.id));
});

// Recall first: when several memories match, each gets a share of the budget, so a
// long first one falls back to a compact form instead of crowding out the rest.
test('several matching memories all arrive, in compact forms when the budget is tight', async t => {
  const { store } = await fixture(t);
  const long = i => `Keep the zqxv frobnicator number ${i} stable. ${'The frobnicator carries state that other parts read later, so a change here ripples. '.repeat(6)}`;
  const ids = [];
  const situations = { 1: 'When renaming the cache keys', 2: 'When changing how state is flushed to disk', 3: 'When adding a new consumer of the output' };
  for (const i of [1, 2, 3]) {
    const r = await proposeMemory({ project_id: 'demo', topic_key: `tools/frobnicator/rule-${i}`, why: 'Agreed.',
      trigger: `${situations[i]} of the zqxv frobnicator.`, behavior_delta: long(i),
      anchors: { keywords: ['zqxv frobnicator', `number ${i}`] }, evidence_refs: [{ source_type: 'file', source_ref: 'GDD-05.md', summary: 'x' }] }, { store });
    assert.ok(r.atom, JSON.stringify(r.reasons));
    ids.push((await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked.' })).id ?? r.atom.id);
  }
  const result = await retrieveMemories({ project_id: 'demo', action: 'refactor the zqxv frobnicator', telemetry: false }, { store });
  assert.equal(result.memories.length, 3);
  assert.ok(result.budget.used <= 600);
});

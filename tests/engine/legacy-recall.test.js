import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';
import { microPack } from '../../src/hooks/session-start.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, topic, extra = {}) => ({ id, project_id: 'demo', memory_type: 'procedure', scope: 'project',
  title: 'Publish the package', trigger: 'when publishing the npm package', behavior_delta: `Publish with method ${id}.`,
  what: 'Publishing.', why: 'Release flow.', authority: 'validated', confidence: 0.9, valid_from: '2026-09-01T00:00:00.000Z',
  topic_key: topic, tags: [], evidence_refs: [], trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [],
  applies_to: { files: [], components: [], operations: [] }, ...PROVENANCE, lifecycle_state: 'active', ...extra });
const legacy = (id, topic, extra = {}) => atom(id, topic, { lifecycle_state: 'legacy', legacy_reason: 'Tokens leaked',
  legacy_at: '2026-09-20T00:00:00.000Z', ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-legacy-recall-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}
const ask = s => retrieveMemories({ project_id: 'demo', action: 'publishing the npm package', budget_tokens: 2000 }, { store: s });

// A practice the project left behind warns the agent where nothing current speaks.
test('an uncovered legacy memory is recalled as a warning', async t => {
  const s = await store(t);
  await s.putAtom(legacy('old1', 'release/npm/publish'));
  const { memories } = await ask(s);
  const hit = memories.find(m => m.id === 'old1');
  assert.equal(hit.lifecycle_state, 'legacy');
  assert.match(hit.content, /^No longer done: Publish with method old1\. Abandoned because: Tokens leaked\. Now: no replacement recorded\./);
  assert.match(microPack(memories), /\[LEGACY old1\]/);
});

test('a legacy memory is dropped when its replacement or a topic peer is in the pack', async t => {
  const s = await store(t);
  await s.putAtom(atom('new1', 'release/npm/publish'));
  await s.putAtom(legacy('old2', 'release/npm/publish'));
  await s.putAtom(legacy('old3', 'release/npm/publish-token', { replaced_by: 'new1' }));
  const ids = (await ask(s)).memories.map(m => m.id);
  assert.ok(ids.includes('new1'));
  assert.ok(!ids.includes('old2'));
  assert.ok(!ids.includes('old3'));
});

test('a legacy memory whose replacement is no longer effective is recalled', async t => {
  const s = await store(t);
  await s.putAtom(atom('gone', 'release/npm/other', { lifecycle_state: 'archived', archived_reason: 'Unused.' }));
  await s.putAtom(legacy('old4', 'release/npm/publish', { replaced_by: 'gone' }));
  assert.ok((await ask(s)).memories.some(m => m.id === 'old4'));
});

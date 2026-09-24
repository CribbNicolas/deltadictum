import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project', title: `T ${id}`,
  trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated',
  confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [],
  trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: 'active', ...extra });

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'dd-legacy-'));
  const options = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  return { root, options, store: await createMemoryStore(options) };
}

test('a legacy memory is stored by id under legacy/ and indexed', async t => {
  const { root, store } = await fresh();
  t.after(() => store.close());
  await store.putAtom(atom('a1', { lifecycle_state: 'legacy', legacy_reason: 'Replaced by the resident.', legacy_at: '2026-09-24T00:00:00.000Z' }));
  await access(join(root, '.dd', 'legacy', 'a1.json'));
  assert.equal((await store.getAtom('a1', 'demo')).lifecycle_state, 'legacy');
  assert.equal((await store.listAtoms({ projectId: 'demo', lifecycleStates: ['legacy'] })).length, 1);
});

test('an action and the atoms it changes are written in one commit', async t => {
  const { root, store } = await fresh();
  t.after(() => store.close());
  await store.putAtom(atom('a2'));
  await store.putAction({ id: 'act1', project_id: 'demo', kind: 'archive', targets: ['a2'], status: 'pending' });
  assert.equal((await store.listActions('demo')).length, 1);
  await store.commitAtoms([{ ...(await store.getAtom('a2', 'demo')), lifecycle_state: 'archived', archived_reason: 'Unused.' }], [], [],
    [{ id: 'act1', value: null }]);
  assert.equal(await store.getAction('act1'), null);
  await assert.rejects(access(join(root, '.dd', 'actions', 'act1.json')));
  assert.equal((await store.getAtom('a2', 'demo')).lifecycle_state, 'archived');
  await store.logAction({ project_id: 'demo', action_id: 'act1', kind: 'archive', targets: ['a2'], outcome: 'applied', actor_ref: 'local_ui' });
  assert.equal((await store.listActionLog('demo'))[0].outcome, 'applied');
});

test('an index built before legacy existed is migrated without losing activation counts', async t => {
  const { options, store } = await fresh();
  await store.putAtom(atom('a3'));
  store.index.db.prepare('UPDATE memory_atoms SET activation_count = 7 WHERE id = ?').run('a3');
  const file = join(options.dataDir, 'index.sqlite');
  store.close();
  // Recreate the 0.3.x table: the old CHECK without 'legacy'.
  const db = new DatabaseSync(file);
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_atoms'").get().sql.replace(",'legacy'", '');
  db.exec(`DROP INDEX IF EXISTS uq_memory_atoms_project_topic_effective; DROP INDEX IF EXISTS idx_memory_atoms_project_lifecycle;
    ALTER TABLE memory_atoms RENAME TO old_atoms; ${sql}; INSERT INTO memory_atoms SELECT * FROM old_atoms; DROP TABLE old_atoms;`);
  db.close();
  const reopened = await createMemoryStore(options);
  t.after(() => reopened.close());
  await reopened.putAtom(atom('a4', { lifecycle_state: 'legacy', legacy_reason: 'Old way.' }));
  assert.equal(reopened.index.db.prepare('SELECT activation_count FROM memory_atoms WHERE id = ?').get('a3').activation_count, 7);
});

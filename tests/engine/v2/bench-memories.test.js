import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBenchMemories } from '../../../src/eval/v2bench/memories.js';
import { convertV1 } from '../../../src/memory/convert-v1.js';

const scratch = t => { const dir = mkdtempSync(join(tmpdir(), 'dd-bench-mem-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const v2 = (id, status) => ({ schema_version: 8, id, project_id: 'p', topic: `t/${id}`, kind: 'trap', status, title: `Rule ${id}`, body: `Rule ${id}.`,
  not_derivable: 'Hidden.', triggers: [{ on: ['read'], paths: ['src/a.js'] }], evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z' });
const atom = (id, lifecycle_state) => ({ id, project_id: 'p', topic_key: `t/${id}`, memory_type: 'lesson', lifecycle_state, title: `Rule ${id}`,
  behavior_delta: `Rule ${id}.`, anchors: { files: ['src/a.js'] }, evidence_refs: [], created_at: '2026-09-01T00:00:00.000Z' });

// The bench read v1 atoms; after the migration removed them it had nothing to
// replay and failed before its first number. The migrated store holds the same
// memories under the same ids, so the bench reads those when no atom is left.
test('without v1 atoms, the bench replays the live memories of the v2 store', async t => {
  const dd = scratch(t);
  mkdirSync(join(dd, 'memories'));
  for (const [id, status] of [['a', 'active'], ['b', 'contested'], ['c', 'candidate'], ['d', 'superseded'], ['e', 'archived']]) {
    writeFileSync(join(dd, 'memories', `${id}.json`), JSON.stringify(v2(id, status)));
  }
  writeFileSync(join(dd, 'memories', 'manifest.json'), JSON.stringify({ version: 1, count: 5, hash: 'h' }));
  assert.deepEqual((await loadBenchMemories(dd)).map(m => m.id).sort(), ['a', 'b']);
});

test('with v1 atoms, the bench converts the live and legacy ones as it always did', async t => {
  const dd = scratch(t);
  mkdirSync(join(dd, 'atoms', 'x'), { recursive: true });
  mkdirSync(join(dd, 'legacy'));
  writeFileSync(join(dd, 'atoms', 'x', 'a.json'), JSON.stringify(atom('a', 'active')));
  writeFileSync(join(dd, 'atoms', 'x', 'b.json'), JSON.stringify(atom('b', 'archived')));
  writeFileSync(join(dd, 'legacy', 'c.json'), JSON.stringify({ ...atom('c', 'legacy'), legacy_reason: 'slow' }));
  const loaded = await loadBenchMemories(dd);
  assert.deepEqual(loaded.map(m => m.id), ['a', 'c']);
  const titles = new Map([['a', 'Rule a'], ['c', 'Rule c']]);
  assert.deepEqual(loaded[0], convertV1(atom('a', 'active'), { titles, liveByTopic: new Map([['t/a', 'Rule a']]) }));
  assert.equal(loaded[1].kind, 'failed_approach');
  assert.deepEqual(await loadBenchMemories(join(dd, 'nowhere')), []);
});

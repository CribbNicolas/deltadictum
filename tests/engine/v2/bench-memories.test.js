import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeBenchMemories, frozenBenchMemories, loadBenchMemories } from '../../../src/eval/v2bench/memories.js';

const scratch = t => { const dir = mkdtempSync(join(tmpdir(), 'dd-bench-mem-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const memory = (id, status) => ({ schema_version: 8, id, project_id: 'p', topic: `t/${id}`, kind: 'trap', status, title: `Rule ${id}`, body: `Rule ${id}.`,
  not_derivable: 'Hidden.', triggers: [{ on: ['read'], paths: ['src/a.js'] }], evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z' });

// The bench is a frozen harness around a recorded trial: the memories that trial
// was recorded against stay in the replay after a curation archives them, or the
// key-delivery figure measures the curation, not the engine. Superseded versions
// and candidates were never delivered and stay out.
test('the bench replays the live and the archived memories of a store', async t => {
  const dd = scratch(t);
  mkdirSync(join(dd, 'memories'));
  for (const [id, status] of [['a', 'active'], ['b', 'contested'], ['c', 'candidate'], ['d', 'superseded'], ['e', 'archived']]) {
    writeFileSync(join(dd, 'memories', `${id}.json`), JSON.stringify(memory(id, status)));
  }
  writeFileSync(join(dd, 'memories', 'manifest.json'), JSON.stringify({ version: 1, count: 5, hash: 'h' }));
  const loaded = await loadBenchMemories(dd);
  assert.deepEqual(loaded.map(m => m.id).sort(), ['a', 'b', 'e']);
  // Replayed as they were when the trial ran: the engine compiles live memories only.
  assert.equal(loaded.find(m => m.id === 'e').status, 'active');
  assert.deepEqual(await loadBenchMemories(join(dd, 'nowhere')), []);
});

// Frozen beside the trial's events, the replayed set no longer depends on the store,
// which can then be curated down to what is live.
test('the replayed memories freeze into a fixture and thaw unchanged; the repository ships one', async t => {
  const dd = scratch(t);
  const path = join(dd, 'frozen.json.gz');
  assert.equal(await freezeBenchMemories([memory('b', 'active'), memory('a', 'active')], path), 2);
  assert.deepEqual((await frozenBenchMemories(path)).map(m => m.id), ['a', 'b']);
  const shipped = await frozenBenchMemories();
  assert.ok(shipped.length > 0);
  assert.ok(shipped.every(m => ['active', 'contested'].includes(m.status)));
});

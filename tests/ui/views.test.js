import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listMemories, memoryDetail, overview } from '../../src/ui/views.js';
import { memory, project } from '../helpers/review.js';

test('the overview counts each queue', async t => {
  const root = await project(t, [memory('live'), memory('cand', { status: 'candidate' }),
    memory('mig', { not_derivable: '', review: { migrated: true, issues: [] } }), memory('dead', { triggers: [{ on: ['edit'], paths: ['docs/none.md'] }] }),
    memory('auto', { review: { migrated: false, issues: [], accepted: { by: 'dd', at: '2026-10-14T00:00:00.000Z' } } })]);
  mkdirSync(join(root, '.dd', 'local', 'requests'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'requests', 'r1.json'), JSON.stringify({ id: 'r1', request: 'archive', target: 'live', why: 'Replaced.' }));
  const { status, queues, capture, recent } = await overview(root);
  assert.equal(status.total, 5);
  assert.equal(capture.proposals, 0);
  assert.deepEqual(recent, []);
  assert.equal(queues.candidates, 1);
  assert.equal(queues.missing_not_derivable, 1);
  assert.equal(queues.dead, 1);
  assert.equal(queues.requests, 1);
  assert.equal(queues.auto_accepted, 1);
  assert.equal(queues.all, 5);
  assert.deepEqual((await listMemories(root, { queue: 'auto_accepted' })).map(m => m.id), ['auto']);
});

test('a queue lists its memories with their signals', async t => {
  const root = await project(t, [memory('live'), memory('dead', { triggers: [{ on: ['edit'], paths: ['docs/none.md'] }] })]);
  const dead = await listMemories(root, { queue: 'dead' });
  assert.deepEqual(dead.map(m => m.id), ['dead']);
  assert.ok(dead[0].signals.some(s => s.signal === 'dead_trigger'));
  assert.deepEqual((await listMemories(root, { queue: 'all' })).map(m => m.id).sort(), ['dead', 'live']);
});

test('a memory comes with its breadth, its check result and suggestions when it has no triggers', async t => {
  const check = { on: ['edit'], paths: ['src/*.js'], if_content: 'x', say: 'No x.', examples: { violates: 'y', passes: 'z' } };
  const root = await project(t, [memory('live', { check }), memory('bare', { status: 'candidate', triggers: [], body: 'Call `aThing` in src/a.js first.' })]);
  const detail = await memoryDetail(root, 'live');
  assert.deepEqual(detail.breadth, [{ glob: 'src/*.js', files: 2 }]);
  assert.deepEqual(detail.check.problems, ['check_misses_its_violating_example']);
  assert.deepEqual(detail.by_dimension, {});
  const bare = await memoryDetail(root, 'bare');
  assert.deepEqual(bare.suggested_triggers, [{ on: ['read', 'edit', 'write'], paths: ['src/a.js'] }, { on: ['edit', 'write'], symbols: ['aThing'] }]);
  assert.equal(await memoryDetail(root, 'missing'), null);
});

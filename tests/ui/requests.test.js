import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeRequest, listRequests } from '../../src/ui/requests.js';
import { project } from '../helpers/review.js';

test('requests are listed and closed with their outcome kept', async t => {
  const root = await project(t, []);
  const dir = join(root, '.dd', 'local', 'requests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'r1.json'), JSON.stringify({ id: 'r1', request: 'archive', target: 'm1', why: 'Replaced.', at: 'x' }));
  writeFileSync(join(dir, 'broken.json'), '{ torn');
  assert.deepEqual(listRequests(root).map(r => r.id), ['r1']);
  assert.deepEqual(closeRequest(root, 'r1', 'done'), { id: 'r1', outcome: 'done' });
  assert.deepEqual(listRequests(root), []);
  assert.match(readFileSync(join(dir, 'closed.jsonl'), 'utf8'), /"outcome":"done"/);
  assert.throws(() => closeRequest(root, '../x', 'done'), /request_not_found/);
  assert.throws(() => closeRequest(root, 'r1', 'maybe'), /invalid_outcome/);
});

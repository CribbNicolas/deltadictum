import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFootprint, footprintPath } from '../../src/capture/footprint.js';
import { stopRequest } from '../../src/capture/stop.js';
import { run } from '../../src/capture/hooks.js';

function session(t, entries) {
  const root = mkdtempSync(join(tmpdir(), 'dd-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const entry of entries) appendFootprint(footprintPath(root, 's1'), entry);
  return root;
}
const fail = { t: 'tool', id: 'f1', kind: 'run', runner: true, paths: [], command: 'npm test', outcome: 'failure', preview: 'Failed (exit 1). parseConfig is not a function', output_identifiers: ['parseConfig'] };
const edit = { t: 'tool', id: 'x1', kind: 'edit', paths: ['src/config.js'], identifiers: ['parseConfig'] };
const pass = { t: 'tool', id: 'v1', kind: 'run', paths: [], command: 'npm test', outcome: 'validation', preview: 'Validation passed (exit 0).' };

test('a turn that fixed a failure gets one request with its evidence, the inbox and suggested triggers', t => {
  const root = session(t, [fail, edit, pass]);
  const text = stopRequest(root, { session_id: 's1' });
  assert.match(text, /^DD - This turn fixed a failure\./);
  assert.match(text, /\.dd\/inbox\/<name>\.json/);
  assert.match(text, /"ref":"f1"/);
  assert.match(text, /"ref":"v1"/);
  assert.match(text, /"paths":\["src\/config\.js"\]/);
  assert.ok(Math.ceil(text.length / 4) <= 400, `${Math.ceil(text.length / 4)} tokens`);
  assert.equal(stopRequest(root, { session_id: 's1' }), '');
});

test('a correction alone gets a request; nothing else does', t => {
  const root = session(t, [{ t: 'correction', id: 'c1', preview: 'User correction. No, use t.after instead.' }]);
  assert.match(stopRequest(root, { session_id: 's1' }), /received a user correction[\s\S]*"type":"correction","ref":"c1"/);
  const quiet = session(t, [fail, { ...pass, id: 'v2' }, edit]);
  assert.equal(stopRequest(quiet, { session_id: 's1' }), '');
});

test('a stop that is already continuing, or without a session, says nothing', t => {
  const root = session(t, [fail, edit, pass]);
  assert.equal(stopRequest(root, { session_id: 's1', stop_hook_active: true }), '');
  assert.equal(stopRequest(root, {}), '');
  assert.match(stopRequest(root, { session_id: 's1' }), /fixed a failure/);
});

// In the 2026-10 benchmark "Do not change any code" in a session's first prompt read as a correction: the
// request that followed replaced Haiku's review with "nothing to save", 2 runs of 156.
test('the first prompt of a session corrects nothing; a prompt after a turn can', async t => {
  const root = session(t, []);
  await run('observe-prompt', root, { session_id: 's1', prompt: 'Review it before it ships. Do not change any code.' });
  assert.equal(await run('stop', root, { session_id: 's1' }), '');
  await run('observe-prompt', root, { session_id: 's1', prompt: 'No, that is wrong: use the store in t.after instead.' });
  assert.match(await run('stop', root, { session_id: 's1' }), /received a user correction/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ftsQuery, overlaps, refreshSimilarity, similarTo, suggestTriggersFor } from '../../src/maintenance/similar.js';
import { openTelemetry } from '../../src/maintenance/telemetry.js';

const m = (id, title, body, triggers = [{ on: ['edit'], paths: ['src/a.js'] }], status = 'active') => ({ id, topic: `s/${id}`, title, body, triggers, status });
const memories = [
  m('close', 'Close stores in t.after', 'Close every store a test opens in t.after so a failing assertion cannot leave a handle open.'),
  m('close2', 'Close test stores in t.after', 'Close every store a test opens in t.after so a failed assertion cannot leave the handle open.', [{ on: ['edit'], paths: ['src/a.js'] }], 'candidate'),
  m('globs', 'Quote test globs', 'Wrap each glob in escaped double quotes in package.json so node --test expands it.', [{ on: ['edit'], paths: ['package.json'] }]),
];

// Windows keeps an open SQLite file: close it before the folder goes.
function db(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-similar-'));
  const handle = openTelemetry(root);
  t.after(() => { handle.close(); rmSync(root, { recursive: true, force: true }); });
  return handle;
}

test('the index rebuilds only when the memories changed, and finds the nearest', t => {
  const handle = db(t);
  assert.equal(refreshSimilarity(null, handle, memories, 'h1'), true);
  assert.equal(refreshSimilarity(null, handle, memories, 'h1'), false);
  assert.deepEqual(similarTo(handle, 'store left open after a failing assertion', { limit: 2 }).map(r => r.id).sort(), ['close', 'close2']);
  assert.deepEqual(similarTo(handle, 'glob quoting', { exclude: ['close', 'close2'] }).map(r => r.id), ['globs']);
});

test('near-identical memories are duplicates; any query text is safe', t => {
  const handle = db(t);
  refreshSimilarity(null, handle, memories, 'h1');
  assert.deepEqual(overlaps(memories, handle).map(o => [o.a, o.b, o.kind]), [['close', 'close2', 'duplicate']]);
  for (const text of ['"', '*', 'a:b', '-x', 'NEAR(', '']) assert.doesNotThrow(() => similarTo(handle, text), text);
  assert.equal(ftsQuery('   '), null);
});

test('a memory without triggers gets suggestions from the paths and symbols its body names', () => {
  const memory = { title: 'x', body: 'Call `parseConfig` in src/config.js before `missingThing`.', triggers: [] };
  assert.deepEqual(suggestTriggersFor(memory, { repoFiles: ['src/config.js'], symbolExists: name => name === 'parseConfig' }), [
    { on: ['read', 'edit', 'write'], paths: ['src/config.js'] },
    { on: ['edit', 'write'], symbols: ['parseConfig'] },
  ]);
});

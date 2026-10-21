import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileIndex } from '../../src/engine/compile.js';
import { FOLD_CASE, memoryMatch } from '../../src/engine/clause.cjs';
import { matchEvent, prepareIndex } from '../../src/engine/match.cjs';
import { loadFixture } from '../../src/eval/replay/fixture.js';
import { synthesizeMemories } from '../../src/eval/replay/synth.js';

const runtime = memories => prepareIndex(compileIndex({ memories, manifest: { count: 0, hash: '' } }).index);
const memory = (id, kind, triggers, status = 'active') => ({ id, topic: `t/${id}`, kind, status, title: id, body: id, evidence: [], triggers });

test('memories that fire come back best clause first, then by kind, then by id', () => {
  const rt = runtime([
    memory('p1', 'procedure', [{ on: ['edit'], paths: ['src/a.js'], symbols: ['run'] }]),
    memory('t1', 'trap', [{ on: ['edit'], paths: ['src/a.js'] }]),
    memory('d1', 'decision', [{ on: ['edit'], paths: ['src/**'] }]),
    memory('t0', 'trap', [{ on: ['edit'], paths: ['src/*.js'] }]),
  ]);
  assert.deepEqual(matchEvent(rt, { kind: 'edit', paths: ['src/a.js'], text: 'run()' }),
    [{ id: 'p1', via: ['paths', 'symbols'] }, { id: 't0', via: ['paths'] }, { id: 't1', via: ['paths'] }, { id: 'd1', via: ['paths'] }]);
  assert.deepEqual(matchEvent(rt, { kind: 'read', paths: ['src/a.js'] }), []);
});

// Windows and macOS file systems ignore letter case, so an agent there may name
// src/Store/paths.js as src/store/paths.js; Linux keeps them apart.
test('path matching folds letter case where the file system does, as the reference does', () => {
  const triggers = [{ on: ['read'], paths: ['src/Store/*.js'], not_paths: ['src/Store/skip.js'] }];
  const rt = runtime([memory('m', 'trap', triggers)]);
  const reference = event => memoryMatch({ triggers }, event) !== null;
  const folds = FOLD_CASE ? [{ id: 'm', via: ['paths'] }] : [];
  assert.equal(FOLD_CASE, process.platform === 'win32' || process.platform === 'darwin');
  assert.deepEqual(matchEvent(rt, { kind: 'read', paths: ['src/store/paths.js'] }), folds);
  assert.equal(reference({ kind: 'read', paths: ['src/store/paths.js'] }), FOLD_CASE);
  assert.deepEqual(matchEvent(rt, { kind: 'read', paths: ['SRC/STORE/SKIP.JS'] }), []);
  assert.equal(reference({ kind: 'read', paths: ['SRC/STORE/SKIP.JS'] }), false);
  assert.deepEqual(matchEvent(rt, { kind: 'read', paths: ['src/Store/paths.js'] }), [{ id: 'm', via: ['paths'] }]);
});

test('on every event of the bench fixture the compiled matcher answers exactly as the reference', async () => {
  const fixture = await loadFixture();
  const memories = synthesizeMemories(fixture);
  const rt = runtime(memories);
  let fired = 0;
  for (const run of fixture.runs) {
    for (const event of run.events) {
      const expected = memories.map(m => [m.id, memoryMatch(m, event)]).filter(([, hit]) => hit)
        .map(([id, hit]) => [id, hit.via.join('+')]).sort();
      const actual = matchEvent(rt, event).map(hit => [hit.id, hit.via.join('+')]).sort();
      assert.deepEqual(actual, expected, `${run.run_id}: ${JSON.stringify(event).slice(0, 200)}`);
      fired += actual.length;
    }
  }
  assert.ok(fired > 1000, `the synthesized memories must exercise the matcher (fired ${fired})`);
});

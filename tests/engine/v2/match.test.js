import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileIndex } from '../../../src/engine/compile.js';
import { memoryMatch } from '../../../src/engine/clause.cjs';
import { matchEvent, prepareIndex } from '../../../src/engine/match.cjs';
import { loadFixture } from '../../../src/eval/v2bench/fixture.js';
import { synthesizeMemories } from './helpers/synth.js';

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

test('path matching is case-sensitive, as the reference is', () => {
  const rt = runtime([memory('m', 'trap', [{ on: ['read'], paths: ['src/Store/paths.js'] }])]);
  assert.deepEqual(matchEvent(rt, { kind: 'read', paths: ['src/store/paths.js'] }), []);
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

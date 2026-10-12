import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEvidence, suggestTriggers } from '../../src/capture/footprint.js';

const fail = (id, extra = {}) => ({ t: 'tool', id, kind: 'run', paths: [], command: 'npm test -- tests/config.test.js', outcome: 'failure',
  preview: 'Failed (PostToolUseFailure). TypeError: parseConfig is not a function', output_identifiers: ['TypeError', 'parseConfig', 'function'], ...extra });
const edit = (id, path, identifiers = []) => ({ t: 'tool', id, kind: 'edit', paths: [path], identifiers });
const pass = id => ({ t: 'tool', id, kind: 'run', paths: [], command: 'npm test', outcome: 'validation', preview: 'Validation passed (exit 0).' });

test('a failure, then edits, then a passing validation is a fix; a rerun without edits is not', () => {
  const entries = [fail('f1'), edit('x1', 'src/config.js', ['parseConfig']), pass('v1'), fail('f2'), pass('v2')];
  const { fixes } = findEvidence(entries);
  assert.equal(fixes.length, 1);
  assert.deepEqual(fixes[0].failures.map(e => e.id), ['f1']);
  assert.deepEqual(fixes[0].edits.map(e => e.id), ['x1']);
  assert.equal(fixes[0].validation.id, 'v1');
});

test('evidence already asked about is left out unless asked for', () => {
  const entries = [fail('f1'), edit('x1', 'src/config.js'), pass('v1'), { t: 'correction', id: 'c1', preview: 'User correction. No.' },
    { t: 'asked', ids: ['f1', 'v1', 'c1'] }];
  assert.deepEqual(findEvidence(entries), { fixes: [], corrections: [] });
  assert.equal(findEvidence(entries, { includeAsked: true }).fixes.length, 1);
});

test('edits to DD files do not make a fix', () => {
  assert.deepEqual(findEvidence([fail('f1'), edit('x1', '.dd/inbox/a.json'), pass('v1')]).fixes, []);
});

test('suggested triggers: edited paths, the failed command, identifiers in both the failure and the fix', () => {
  const fix = { failures: [fail('f1')], edits: [edit('x1', 'src/config.js', ['parseConfig', 'value']), edit('x2', 'tests/config.test.js', ['parseConfig'])],
    validation: pass('v1') };
  assert.deepEqual(suggestTriggers(fix), [
    { on: ['edit'], paths: ['src/config.js', 'tests/config.test.js'] },
    { on: ['run'], commands: ['npm test'] },
    { on: ['edit', 'write'], symbols: ['parseConfig'] },
  ]);
});

test('three or more sibling files with one extension become one glob', () => {
  const fix = { failures: [fail('f1', { command: 'node --test tests/a.test.js' })],
    edits: ['a', 'b', 'c'].map((n, i) => edit(`x${i}`, `src/store/${n}.js`)), validation: pass('v1') };
  assert.deepEqual(suggestTriggers(fix).slice(0, 2), [{ on: ['edit'], paths: ['src/store/*.js'] }, { on: ['run'], commands: ['node --test'] }]);
});

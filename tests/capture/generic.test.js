import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genericReasons } from '../../src/capture/generic.js';

const m = (body, title = 'A rule') => ({ title, body, triggers: [{ on: ['edit'], paths: ['src/a.js'] }] });

test('advice that names nothing of the repository is generic, even with specific triggers', () => {
  for (const body of ['Write tests before changing code.', 'Be careful with error handling and keep functions small.']) {
    assert.deepEqual(genericReasons(m(body)), ['generic_advice'], body);
  }
});

test('a path, a symbol, a command, a flag or a value makes it specific', () => {
  for (const body of ['Close the store in `t.after`.', 'Run src/cli.js compile first.', 'Call createMemoryStore once per test.',
    'Use --test-concurrency=1 on Windows.', 'Hooks time out after 10 s.', 'Set DD_RESIDENT_REGISTRY to a temp file.', 'Keep tests/helpers/isolate-data.js imported.']) {
    assert.deepEqual(genericReasons(m(body)), [], body);
  }
});

// With the repository at hand, a name counts only if the repository has it:
// "tests and/or docs" names no path, "`fooBarBaz`" no symbol of this code.
test('with the repository at hand, named paths and symbols must exist in it', () => {
  const repoFiles = ['src/config.js', 'tests/config.test.js'];
  const symbolExists = name => name === 'parseConfig';
  const judge = body => genericReasons(m(body, 'A rule'), { repoFiles, symbolExists });
  assert.deepEqual(judge('Write tests and/or docs before changing code.'), ['generic_advice']);
  assert.deepEqual(judge('Call `fooBarBaz` before saving.'), ['generic_advice']);
  assert.deepEqual(judge('Call `parseConfig` before saving.'), []);
  assert.deepEqual(judge('Run the files under tests/ serially.'), []);
  assert.deepEqual(judge('Keep src/config.js free of side effects.'), []);
  assert.deepEqual(judge('Hooks time out after 10 s.'), []);
});
